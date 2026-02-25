import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question, mode, voiceId: customVoiceId, frame } = await req.json();
    // mode: "full" (default) or "blast" (15-second tactical)
    
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not configured");

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch brain data in parallel
    const [
      { data: kbItems },
      { data: principles },
      { data: chunks },
    ] = await Promise.all([
      supabase.from("knowledge_base_items").select("id, title, type").eq("user_id", user.id),
      supabase.from("sales_brain")
        .select("principle_name, what_i_learned, how_to_apply, source_name, category, source_id")
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(60),
      supabase.from("knowledge_chunks")
        .select("content, category, source_id")
        .eq("user_id", user.id).is("workspace_id", null)
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false })
        .limit(40),
    ]);

    const kbMap: Record<string, string> = {};
    (kbItems || []).forEach((k: any) => { kbMap[k.id] = k.title; });

    const hasKnowledge = (principles?.length || 0) + (chunks?.length || 0) > 0;

    // Build context
    const brainContext = hasKnowledge ? [
      "PRINCIPLES:\n" + (principles || []).slice(0, 30).map((p: any) => {
        const src = p.source_id && kbMap[p.source_id] ? kbMap[p.source_id] : p.source_name;
        return `• ${p.principle_name} (${src}): ${p.what_i_learned}`;
      }).join("\n"),
      "CHUNKS:\n" + (chunks || []).slice(0, 20).map((c: any) => {
        const src = c.source_id && kbMap[c.source_id] ? kbMap[c.source_id] : "upload";
        return `[${src}] ${c.content.substring(0, 300)}`;
      }).join("\n"),
    ].join("\n\n") : "";

    const visionDirective = frame
      ? "\n\nCRITICAL VISION RULES — YOU MUST FOLLOW THESE:\n1. An image frame from the user's camera or screen IS attached to this message as an image_url.\n2. You ABSOLUTELY CAN see this image. You have full vision/multimodal capability.\n3. ALWAYS start your response by describing what you see in the image BEFORE giving advice.\n4. NEVER say 'I cannot see', 'I'm a voice assistant', 'I only process audio', or anything similar.\n5. If the image is blurry or unclear, say exactly what parts are unclear and ask for a steadier frame.\n6. Analyze text, UI elements, faces, objects, screens — everything visible in the frame."
      : "";

    const isBlast = mode === "blast";
    const systemPrompt = isBlast
      ? `You are \"The Brain\" voice assistant in BLAST mode. Give a punchy, 2-3 sentence tactical answer ONLY from uploaded knowledge.${visionDirective} ${!hasKnowledge ? 'Brain is empty. Say: "Nothing in my brain yet. Upload videos or PDFs first."' : `Use ONLY this knowledge:\n${brainContext}`}`
      : `You are \"The Brain\" voice assistant. Give concise, strategic advice ONLY from uploaded knowledge. Keep answers under 4 sentences for voice clarity. Reference source titles naturally.${visionDirective} ${!hasKnowledge ? 'Brain is empty. Say: "Nothing in my brain yet. Upload videos or PDFs first."' : `Use ONLY this knowledge:\n${brainContext}`}`;

    // Build user message — support vision frame
    const userContent: any = frame
      ? [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: frame } },
        ]
      : question;

    // Get AI response
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) throw new Error(`AI error: ${aiResponse.status}`);
    const aiData = await aiResponse.json();
    const textReply = aiData.choices?.[0]?.message?.content || "0 - Nothing in my knowledge base yet.";

    // Generate TTS via ElevenLabs
    const voiceId = customVoiceId || "JBFqnCBsd6RMkjVDRZzb"; // User-selected or George default
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: textReply,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.6,
            similarity_boost: 0.8,
            style: 0.3,
            use_speaker_boost: true,
            speed: isBlast ? 1.1 : 1.0,
          },
        }),
      }
    );

    if (!ttsResponse.ok) {
      console.error("ElevenLabs TTS error:", ttsResponse.status);
      // Return text-only if TTS fails
      return new Response(JSON.stringify({ text: textReply, audio: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const audioBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = base64Encode(audioBuffer);

    return new Response(JSON.stringify({ text: textReply, audio: audioBase64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("voice-brain error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
