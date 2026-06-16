import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";


function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, frameworkText } = await req.json();
    if (!workspaceId || !frameworkText) throw new Error("workspaceId and frameworkText required");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify workspace ownership
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("id, name, workspace_type")
      .eq("id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (!workspace) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const parsePrompt = `You are a conversation framework parser. Analyze this custom conversation framework and extract ALL structured rules into a JSON object.

FRAMEWORK TEXT:
${frameworkText.substring(0, 15000)}

Extract and return this EXACT JSON structure:
{
  "voice_style": "description of the voice/tone (e.g. calm, empathetic, protective, energetic)",
  "identity_mode": "how the persona positions themselves (e.g. guide, friend, mentor, coach, authority)",
  "tone_rules": ["list of specific tone instructions found in the text"],
  "never_rules": ["list of things the framework says to NEVER do"],
  "always_rules": ["list of things the framework says to ALWAYS do"],
  "step_flow": [
    {"step": 1, "name": "step name", "description": "what to do in this step", "triggers": "when to use"}
  ],
  "objection_map": {
    "objection_category": "how to handle it"
  },
  "emotional_hooks": ["list of emotional hooks or triggers mentioned"],
  "cta_style": "how CTAs are positioned (soft, direct, invitation, etc.)",
  "funnel_positioning": "how the funnel entry is described",
  "tag_triggers": {
    "trigger_phrase_or_situation": "response or action"
  },
  "canned_scripts": [
    {"situation": "when to use", "script": "the script or template"}
  ],
  "pricing_scripts": ["any pricing-related scripts or rules"],
  "urgency_phrasing": ["urgency phrases or techniques"],
  "followup_cadence": "follow-up timing rules if mentioned",
  "forbidden_behaviors": ["specific behaviors to avoid"],
  "mandatory_behaviors": ["required behaviors in every interaction"],
  "summary": "1-2 sentence summary of the framework's core approach"
}

RULES:
- Extract EVERYTHING you can find. If a field has no data, use empty array [] or null
- For step_flow, extract the exact steps defined (could be 3, 5, 7 steps - whatever they defined)
- never_rules should include any "don't", "never", "avoid", "do not" instructions
- always_rules should include any "always", "must", "every time", "make sure" instructions
- Be thorough — this structured data will be used to enforce rules on every generated reply
- Return ONLY the JSON object, no other text`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a framework parser. Return valid JSON only." },
          { role: "user", content: parsePrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI parsing failed");
    }

    const aiData = await response.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let parsedFramework: any = null;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsedFramework = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse framework JSON");
      return new Response(JSON.stringify({ error: "Failed to parse framework" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save parsed framework and raw text to workspace
    await supabase.from("workspaces").update({
      custom_framework: frameworkText,
      parsed_framework: parsedFramework,
    }).eq("id", workspaceId);

    return new Response(JSON.stringify({ success: true, parsedFramework }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("parse-framework error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
