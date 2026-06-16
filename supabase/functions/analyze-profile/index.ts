import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";


function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

async function scrapeUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return `[Could not fetch ${url}: HTTP ${res.status}]`;
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 8000);
  } catch (e) {
    return `[Error fetching ${url}: ${e instanceof Error ? e.message : "timeout"}]`;
  }
}

// (embedding helper moved to shared util — see imports above)



serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId } = await req.json();
    if (!workspaceId) throw new Error("workspaceId required");

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

    const { data: workspace, error: wsError } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .eq("user_id", user.id)
      .single();

    if (wsError || !workspace) {
      return new Response(JSON.stringify({ error: "Workspace not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scrape all available URLs
    const scrapedParts: string[] = [];
    const urls = [
      { label: "Instagram", url: workspace.instagram_url },
      { label: "TikTok", url: workspace.tiktok_url },
      { label: "Store/Website", url: workspace.store_url },
    ];

    for (const { label, url } of urls) {
      if (url) {
        const content = await scrapeUrl(url);
        scrapedParts.push(`--- ${label} (${url}) ---\n${content}`);
      }
    }

    if (scrapedParts.length === 0 && !workspace.niche_description && !workspace.custom_framework) {
      return new Response(JSON.stringify({ error: "No URLs, description, or framework to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let chat;
    try {
      chat = await resolveUserChatTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }


    // ===== STEP 1: Profile Analysis (existing) =====
    const prompt = `Analyze this business/creator profile and provide:
1. A concise profile analysis (2-3 sentences about what they do, their niche, and target audience)
2. Products/services detected (comma-separated list)

Workspace name: ${workspace.name}
Workspace type: ${workspace.workspace_type || "friend"}
Niche description: ${workspace.niche_description || "Not provided"}
${workspace.custom_framework ? `Custom Framework: ${workspace.custom_framework.substring(0, 1000)}` : ""}
${workspace.target_audience ? `Target Audience: ${workspace.target_audience}` : ""}
${workspace.business_model ? `Business Model: ${workspace.business_model}` : ""}

Scraped content from their profiles:
${scrapedParts.join("\n\n")}

Return JSON: { "profile_analysis": "...", "products_detected": "..." }`;

    const aiResponse = await userChat(chat, {
      model: chat.models.reasoning,
      messages: [
        { role: "system", content: "You are a business profile analyzer. Return valid JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });


    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted, please add funds" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let profileAnalysis = "Analysis completed";
    let productsDetected = "None detected";

    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        profileAnalysis = parsed.profile_analysis || profileAnalysis;
        productsDetected = parsed.products_detected || productsDetected;
      }
    } catch {
      profileAnalysis = aiContent.substring(0, 500);
    }

    await supabase
      .from("workspaces")
      .update({ profile_analysis: profileAnalysis, products_detected: productsDetected })
      .eq("id", workspaceId);

    // ===== STEP 2: Extract & Save Structured Persona (workspace_persona) =====
    const personaPrompt = `Based on this business profile, create a structured persona object for this workspace.

Workspace name: ${workspace.name}
Workspace type: ${workspace.workspace_type || "friend"}
Niche description: ${workspace.niche_description || "Not provided"}
Profile Analysis: ${profileAnalysis}
Products: ${productsDetected}
${workspace.target_audience ? `Target Audience: ${workspace.target_audience}` : ""}
${workspace.business_model ? `Business Model: ${workspace.business_model}` : ""}
${workspace.positioning ? `Market Positioning: ${workspace.positioning}` : ""}

${workspace.custom_framework ? `CUSTOM CONVERSATION FRAMEWORK (this is the user's primary reply guide — the persona MUST reflect this framework's tone, style, and approach):\n${workspace.custom_framework}\n` : ""}

Scraped content from their profiles:
${scrapedParts.join("\n\n")}

IMPORTANT: If a custom framework was provided above, the persona's tone, energy, positioning, and close style MUST align with that framework. Extract the tone and approach directly from the framework text.

Return a JSON object with these exact fields:
{
  "workspace_name": "short persona name derived from niche + framework style, e.g. 'Digital Mom Friend' or 'Fitness Authority Coach'",
  "tone": "extracted from the custom framework if provided, otherwise inferred from content. e.g. Warm, relatable / Professional, authoritative",
  "audience": "extracted from niche description + content. e.g. Beginner moms / Aspiring entrepreneurs",
  "positioning": "derived from framework + niche. e.g. Peer who succeeded / Authority expert",
  "energy": "derived from framework tone. e.g. Calm, encouraging / High-energy, motivational",
  "allowed_close_style": "derived from framework close strategy. e.g. Soft invitation / Direct ask",
  "niche_detected": "the specific niche detected from description + content",
  "audience_type": "the type of audience (beginner/intermediate/advanced)",
  "key_themes": "3-5 main themes from their content + framework, comma-separated",
  "framework_summary": "1-2 sentence summary of the custom framework's core approach, or 'No custom framework' if none provided"
}

Return ONLY the JSON object.`;

    const personaResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a persona analyzer. Return valid JSON only." },
          { role: "user", content: personaPrompt },
        ],
        temperature: 0.3,
      }),
    });

    let personaData: any = null;
    if (personaResponse.ok) {
      const pData = await personaResponse.json();
      const pContent = pData.choices?.[0]?.message?.content || "";
      try {
        const pMatch = pContent.match(/\{[\s\S]*\}/);
        if (pMatch) personaData = JSON.parse(pMatch[0]);
      } catch {
        console.error("Failed to parse persona JSON");
      }
    }

    // Save persona to sales_brain as workspace_persona
    if (personaData) {
      // Delete existing workspace_persona entries for this workspace
      await supabase
        .from("sales_brain")
        .delete()
        .eq("user_id", user.id)
        .eq("workspace_id", workspaceId)
        .eq("source_type", "workspace_persona");

      const personaSummary = `Workspace Persona: ${personaData.workspace_name || workspace.name}
Tone: ${personaData.tone || "Not detected"}
Audience: ${personaData.audience || "Not detected"}
Positioning: ${personaData.positioning || "Not detected"}
Energy: ${personaData.energy || "Not detected"}
Close Style: ${personaData.allowed_close_style || "Not detected"}
Niche: ${personaData.niche_detected || "Not detected"}
Audience Type: ${personaData.audience_type || "Not detected"}
Key Themes: ${personaData.key_themes || "Not detected"}
Framework Approach: ${personaData.framework_summary || "No custom framework"}
Workspace Type: ${workspace.workspace_type || "friend"}`;

      const embedding = await generateEmbedding(personaSummary, LOVABLE_API_KEY);

      await supabase.from("sales_brain").insert({
        user_id: user.id,
        workspace_id: workspaceId,
        principle_name: `Workspace Persona: ${personaData.workspace_name || workspace.name}`,
        what_i_learned: personaSummary,
        how_to_apply: `Use this persona when chatting with prospects in the ${workspace.name} workspace. Match the tone (${personaData.tone}), target the audience (${personaData.audience}), and use the close style (${personaData.allowed_close_style}).`,
        source_name: workspace.name,
        source_type: "workspace_persona",
        brain_type: "both",
        category: "general",
        metadata: personaData,
        embedding,
      });

      console.log("Saved workspace persona to sales_brain");
    }

    return new Response(JSON.stringify({ success: true, profileAnalysis, productsDetected, persona: personaData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-profile error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
