import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

async function generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.substring(0, 8000),
        dimensions: 768,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

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

    if (scrapedParts.length === 0 && !workspace.niche_description) {
      return new Response(JSON.stringify({ error: "No URLs or description to analyze" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // ===== STEP 1: Profile Analysis (existing) =====
    const prompt = `Analyze this business/creator profile and provide:
1. A concise profile analysis (2-3 sentences about what they do, their niche, and target audience)
2. Products/services detected (comma-separated list)

Workspace name: ${workspace.name}
Niche description: ${workspace.niche_description || "Not provided"}

Scraped content from their profiles:
${scrapedParts.join("\n\n")}

Return JSON: { "profile_analysis": "...", "products_detected": "..." }`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a business profile analyzer. Return valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
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
Niche description: ${workspace.niche_description || "Not provided"}
Profile Analysis: ${profileAnalysis}
Products: ${productsDetected}

Scraped content:
${scrapedParts.join("\n\n")}

Return a JSON object with these exact fields:
{
  "workspace_name": "short persona name, e.g. 'Digital Mom Friend'",
  "tone": "e.g. Warm, relatable / Professional, authoritative / Energetic, motivational",
  "audience": "e.g. Beginner moms / Aspiring entrepreneurs / Fitness enthusiasts",
  "positioning": "e.g. Peer who succeeded / Authority expert / Relatable mentor",
  "energy": "e.g. Calm, encouraging / High-energy, motivational / Direct, no-nonsense",
  "allowed_close_style": "e.g. Soft invitation / Direct ask / Consultative close",
  "niche_detected": "the specific niche detected",
  "audience_type": "the type of audience (beginner/intermediate/advanced)",
  "key_themes": "3-5 main themes from their content, comma-separated"
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
Key Themes: ${personaData.key_themes || "Not detected"}`;

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
