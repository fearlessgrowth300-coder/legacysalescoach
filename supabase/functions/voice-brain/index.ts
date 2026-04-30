import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import {
  runPipeline, buildSessionContext, buildPrinciplesBlock,
} from "../_shared/brain-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EMPTY_VOICE_RESPONSE = (topic: string) =>
  `Your vault doesn't cover ${topic} yet. Upload a video or PDF on ${topic} to unlock coaching here.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { question, mode, voiceId: customVoiceId, frame, conversation_id } = await req.json();

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not configured");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const session = await buildSessionContext(supabase, conversation_id || null, [{ role: "user", content: question }]);

    // ─── Layers 1+2 (shared with brain-chat) ───
    const pipeline = await runPipeline({
      apiKey: LOVABLE_API_KEY,
      supabaseAdmin: supabase,
      userId: user.id,
      question: String(question || ""),
      session,
    });

    // ─── Empty vault — same fixed response, voice-styled ───
    let textReply: string;
    if (pipeline.debug.empty_vault || pipeline.selected.length === 0) {
      textReply = EMPTY_VOICE_RESPONSE(pipeline.empty_vault_topic || "this topic");
    } else {
      // ─── Step 5: VOICE-SPECIFIC response prompt ───
      const isBlast = mode === "blast";
      const visionDirective = frame
        ? "\nIMAGE CONTEXT: A frame from the user's camera/screen is attached. Briefly mention what you see in 1 short clause before the advice."
        : "";

      const primarySource = pipeline.selected.find((s) => s.tier === "primary")?.source_title || pipeline.selected[0]?.source_title || "your vault";

      const systemPrompt = `You are "The Brain" speaking out loud as a sales coach. You speak ONLY from the principles below — never general knowledge.

DOMINANT FRAMEWORK: ${pipeline.framework_name || "(unspecified)"}

PRINCIPLES (your only allowed sources, with PRIMARY/SUPPORTING tiers):
${buildPrinciplesBlock(pipeline.selected)}

VOICE RULES — NON-NEGOTIABLE:
- Answer in ${isBlast ? "1-2" : "2-3"} sentences. Spoken English. No markdown. No bullet points. No headings.
- DO NOT include citation tokens like [[cite:...]] — those are for text mode.
- You MUST name a source out loud at least once: "According to ${primarySource}, ..." or "${primarySource} teaches that...". Lead with a PRIMARY principle.
- Be direct, confident, specific. Give one concrete tactic or one exact line they can say.
- Optimized for ElevenLabs TTS — natural rhythm, no abbreviations.${visionDirective}`;

      const userContent: any = frame
        ? [{ type: "text", text: question }, { type: "image_url", image_url: { url: frame } }]
        : question;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
          temperature: 0.6,
        }),
      });
      if (!aiResp.ok) throw new Error(`AI error: ${aiResp.status}`);
      const aiData = await aiResp.json();
      textReply = aiData.choices?.[0]?.message?.content || EMPTY_VOICE_RESPONSE(pipeline.empty_vault_topic || "this topic");
    }

    // ─── ElevenLabs TTS ───
    const voiceId = customVoiceId || "JBFqnCBsd6RMkjVDRZzb";
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: textReply,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.6, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true,
          speed: mode === "blast" ? 1.1 : 1.0,
        },
      }),
    });

    const meta = {
      framework_name: pipeline.framework_name,
      selected_principles: pipeline.selected.map((s) => ({
        id: s.id, principle_name: s.principle_name, source_title: s.source_title, source_id: s.source_id, tier: s.tier,
      })),
      empty_vault: pipeline.debug.empty_vault,
    };

    if (!ttsResponse.ok) {
      console.error("ElevenLabs TTS error:", ttsResponse.status);
      return new Response(JSON.stringify({ text: textReply, audio: null, brain_meta: meta }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = base64Encode(audioBuffer);
    return new Response(JSON.stringify({ text: textReply, audio: audioBase64, brain_meta: meta }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("voice-brain error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
