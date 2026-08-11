import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";


function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://[::1]:");
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

function safeObject(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function syncApprovedFriendPersona(supabase: any, userId: string, workspace: any) {
  if (workspace.workspace_type !== "friend") throw new Error("Only Friend workspaces use the Friend Persona engine");
  if (workspace.friend_persona_status !== "approved") throw new Error("Review and approve the Friend persona before syncing it");

  const persona = safeObject(workspace.friend_persona);
  const offer = safeObject(workspace.offer_truth);
  const stories = Array.isArray(workspace.approved_stories) ? workspace.approved_stories : [];
  const { data: proofAssets } = await supabase
    .from("workspace_proof_assets")
    .select("title, result_type, result_value, result_date, description")
    .eq("user_id", userId)
    .eq("workspace_id", workspace.id)
    .eq("approved_for_ai", true)
    .order("created_at", { ascending: false })
    .limit(20);

  const personaSummary = [
    `Approved Friend Persona: ${persona.display_name || workspace.name}`,
    persona.role ? `Role: ${persona.role}` : "",
    persona.voice_notes ? `Voice: ${persona.voice_notes}` : "",
    persona.instagram_bio ? `Instagram bio: ${persona.instagram_bio}` : "",
    persona.behavior_guidelines ? `Friend behavior: ${persona.behavior_guidelines}` : "",
    persona.conversation_examples ? `Approved conversation style examples: ${String(persona.conversation_examples).substring(0, 12000)}` : "",
    persona.strategy_name ? `Strategy used: ${persona.strategy_name}` : "",
    persona.strategy_description ? `Strategy experience: ${persona.strategy_description}` : "",
    persona.strategy_website ? `Strategy website: ${persona.strategy_website}` : "",
    workspace.audience_description ? `Audience: ${workspace.audience_description}` : "",
    workspace.pain_points ? `Audience pains: ${workspace.pain_points}` : "",
    workspace.common_objections ? `Common objections: ${workspace.common_objections}` : "",
    workspace.friend_backstory ? `Real backstory: ${workspace.friend_backstory}` : "",
    workspace.transformation ? `Real transformation: ${workspace.transformation}` : "",
    stories.length ? `Approved true stories: ${stories.join(" | ")}` : "",
    offer.name ? `Offer used/recommended: ${offer.name}` : "",
    offer.description ? `Offer description: ${offer.description}` : "",
    offer.personal_experience ? `Genuine product experience: ${offer.personal_experience}` : "",
    offer.course_url ? `Course website: ${offer.course_url}` : "",
    offer.results_summary ? `Approved course result summary: ${offer.results_summary}` : "",
    Array.isArray(offer.courses) && offer.courses.length > 0 ? `Approved courses/products: ${JSON.stringify(offer.courses).substring(0, 16000)}` : "",
    offer.price ? `Verified price: ${offer.price}` : "",
    offer.who_it_is_for ? `Offer fit: ${offer.who_it_is_for}` : "",
    offer.who_it_is_not_for ? `Not a fit: ${offer.who_it_is_not_for}` : "",
    offer.referral_url ? `Approved referral destination: ${offer.referral_url}` : "",
    workspace.expert_description ? `Expert/team: ${workspace.expert_description}` : "",
    persona.expert_name ? `Expert/team name: ${persona.expert_name}` : "",
    persona.expert_reference ? `Refer to expert/team as: ${persona.expert_reference}` : "",
    persona.expert_website ? `Expert/team website: ${persona.expert_website}` : "",
    workspace.referral_triggers ? `Referral triggers: ${workspace.referral_triggers}` : "",
    workspace.forbidden_claims ? `Forbidden claims: ${workspace.forbidden_claims}` : "",
    ...(proofAssets || []).map((proof: any) =>
      `Approved factual result: ${proof.title}${proof.result_value ? ` (${proof.result_value})` : ""}${proof.result_date ? ` on ${proof.result_date}` : ""}${proof.description ? ` — ${proof.description}` : ""}`
    ),
  ].filter(Boolean).join("\n");

  const embedding = await generateEmbedding(personaSummary, supabase, userId);
  if (!embedding) {
    throw new Error("Could not create the 768-dimension Friend persona search embedding");
  }

  // Insert the replacement first. A provider or schema failure must not erase
  // the last working persona index before the replacement is safely stored.
  const { data: inserted, error } = await supabase.from("sales_brain").insert({
    user_id: userId,
    workspace_id: workspace.id,
    principle_name: `Approved Friend Persona: ${persona.display_name || workspace.name}`,
    what_i_learned: personaSummary,
    how_to_apply: "Use only these user-approved identity, story, offer and result facts. Never invent personal experience, income, proof, price or guarantees. Refer only when the configured readiness signals are present.",
    source_name: workspace.name,
    source_type: "workspace_persona",
    brain_type: "friend",
    category: "general",
    relevance_score: 100,
    metadata: {
      persona,
      offer,
      approved_stories: stories,
      approved_proof_count: (proofAssets || []).length,
      persona_version: workspace.friend_persona_version || 1,
      approved_at: workspace.friend_persona_approved_at,
    },
    embedding,
  }).select("id").single();
  if (error) throw new Error(`Could not store Friend persona search index: ${error.message}`);

  const { error: cleanupError } = await supabase.from("sales_brain").delete()
    .eq("user_id", userId)
    .eq("workspace_id", workspace.id)
    .eq("source_type", "workspace_persona")
    .neq("id", inserted.id);
  if (cleanupError) {
    console.warn("Friend persona index was refreshed, but older versions could not be removed:", cleanupError);
  }
  return { approvedProofCount: (proofAssets || []).length };
}

// (embedding helper moved to shared util — see imports above)



serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { workspaceId, profileSnapshot, setupContext, draftOnly, syncApproved } = await req.json();
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

    if (syncApproved) {
      const synced = await syncApprovedFriendPersona(supabase, user.id, workspace);
      return new Response(JSON.stringify({ success: true, synced: true, ...synced }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A verified scraper snapshot already contains the social profile and
    // recent posts. Re-fetching those pages here is redundant, frequently
    // blocked by the platforms, and can exhaust the Edge Function wall time.
    const scrapedParts: string[] = [];
    const hasVerifiedSnapshot = typeof profileSnapshot === "string" && Boolean(profileSnapshot.trim());
    if (hasVerifiedSnapshot) {
      scrapedParts.push(`--- VERIFIED SCRAPER SNAPSHOT ---\n${profileSnapshot.trim().substring(0, 24000)}`);
    }
    const urls = hasVerifiedSnapshot ? [] : [
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


    const isAutomaticFriendDraft = workspace.workspace_type === "friend" && Boolean(draftOnly);
    const ownerSetup = safeObject(setupContext);
    let profileAnalysis = workspace.profile_analysis || "Analysis completed";
    let productsDetected = workspace.products_detected || "None detected";

    // Expert/manual analysis retains the separate business-summary pass.
    // Automatic Friend setup uses the structured persona pass below as its
    // single AI request so the browser is not left waiting on two generations.
    if (!isAutomaticFriendDraft) {
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
        timeout_ms: 45000,
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

      const { error: summaryError } = await supabase
        .from("workspaces")
        .update({ profile_analysis: profileAnalysis, products_detected: productsDetected })
        .eq("id", workspaceId)
        .eq("user_id", user.id);
      if (summaryError) throw summaryError;
    }

    // ===== STEP 2: Extract & Save Structured Persona (workspace_persona) =====
    const personaPrompt = workspace.workspace_type === "friend"
      ? `Create a REVIEW DRAFT for a Friend Persona from the supplied profile evidence.

Workspace: ${workspace.name}
Niche: ${workspace.niche_description || "Not provided"}
Profile analysis: ${profileAnalysis}
Products detected: ${productsDetected}
Existing audience notes: ${workspace.audience_description || "None"}
Existing framework: ${workspace.custom_framework || "None"}

Profile evidence:
${scrapedParts.join("\n\n")}

OWNER-SUPPLIED SETUP (treat as draft facts supplied by the owner; preserve them accurately for review):
${JSON.stringify(ownerSetup, null, 2).substring(0, 24000)}

TRUTH RULES:
- Infer communication style, audience themes, pains and objections from visible evidence.
- NEVER invent a personal purchase, income, sales result, transformation, testimonial, price, guarantee, mentor relationship or expert endorsement.
- Leave any unsupported factual field as an empty string or empty array.
- Detected products are possibilities, not proof that the user bought or recommends them.
- Stories may only be copied or faithfully summarized when the profile explicitly states that they happened to this person.

Return JSON with exactly this shape:
{
  "friend_persona": {
    "display_name": "short persona name",
    "role": "how this person is positioned relative to friends",
    "voice_notes": "tone, vocabulary, length, emoji and energy observations",
    "audience": "primary audience",
    "instagram_bio": "bio from the verified Instagram snapshot",
    "avatar_url": "verified cached Instagram profile picture URL",
    "conversation_examples": "owner-provided conversation examples, preserved without inventing messages",
    "behavior_guidelines": "adaptive genuine-peer behavior learned from the examples",
    "strategy_name": "owner-provided strategy name",
    "strategy_website": "owner-provided strategy website",
    "strategy_description": "how the owner says the strategy works and helped",
    "expert_name": "owner-provided expert or team name",
    "expert_reference": "the exact owner-selected wording: the team, he, she, the expert, or my mentor",
    "expert_website": "owner-provided expert website",
    "expert_help": "what the expert or team helps with"
  },
  "audience_description": "specific audience and lifestyle",
  "pain_points": ["evidence-supported audience pains"],
  "common_objections": ["likely objections supported by content"],
  "friend_backstory": "only an explicitly stated real first-person backstory, otherwise empty",
  "transformation": "only an explicitly stated real result/transformation, otherwise empty",
  "approved_stories": ["explicit first-person stories found in the evidence; these still require user approval"],
  "expert_description": "only an expert/team explicitly named or endorsed, otherwise empty",
  "referral_triggers": ["observable signals that a friend is asking for relevant help"],
  "offer_truth": {
    "name": "detected product/course name or empty",
    "description": "what visible evidence says it does",
    "personal_experience": "only explicit first-person use, otherwise empty",
    "course_url": "owner-provided course website or empty",
    "results_summary": "owner-provided results, kept as a review claim until proof and approval",
    "courses": [{"name":"course or product name","website":"owner-provided website","description":"what it teaches and who it helps","personal_experience":"owner-provided genuine experience","results_summary":"owner-provided results pending proof and approval"}],
    "price": "only an explicitly visible current price, otherwise empty",
    "who_it_is_for": "evidence-supported fit",
    "who_it_is_not_for": "evidence-supported limitation or empty",
    "referral_url": "explicit product/store URL or empty"
  },
  "forbidden_claims": ["claims that are unsupported and must not be made"],
  "profile_evidence": "concise explanation of what was actually visible",
  "confidence_notes": "what the user must verify before approval"
}

Return JSON only.`
      : `Based on this business profile, create a structured expert persona object.

Workspace name: ${workspace.name}
Niche description: ${workspace.niche_description || "Not provided"}
Profile Analysis: ${profileAnalysis}
Products: ${productsDetected}
Target Audience: ${workspace.target_audience || "Not provided"}
Business Model: ${workspace.business_model || "Not provided"}
Positioning: ${workspace.positioning || "Not provided"}
Custom Framework: ${workspace.custom_framework || "None"}
Profile evidence: ${scrapedParts.join("\n\n")}

Return JSON with: workspace_name, tone, audience, positioning, energy, allowed_close_style, niche_detected, audience_type, key_themes, framework_summary. Return JSON only.`;

    const personaResponse = await userChat(chat, {
      model: chat.models.reasoning,
      messages: [
        { role: "system", content: "You are a persona analyzer. Return valid JSON only." },
        { role: "user", content: personaPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      timeout_ms: 45000,
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

    // Automatic Friend analysis always remains a draft. It cannot influence
    // live conversations until the owner reviews and explicitly approves it.
    if (personaData && workspace.workspace_type === "friend") {
      const inferredOffer = safeObject(personaData.offer_truth);
      profileAnalysis = personaData.profile_evidence || profileAnalysis;
      productsDetected = inferredOffer.name || productsDetected;
      const { error: draftError } = await supabase.from("workspaces").update({
        auto_profile_draft: personaData,
        friend_setup_mode: "auto",
        friend_persona_status: "draft",
        profile_analysis: profileAnalysis,
        products_detected: productsDetected,
      }).eq("id", workspaceId).eq("user_id", user.id);
      if (draftError) throw draftError;
    }

    // Expert workspaces keep the existing generated workspace persona flow.
    if (personaData && workspace.workspace_type !== "friend") {
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

      const embedding = await generateEmbedding(personaSummary, supabase, user.id);

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

    return new Response(JSON.stringify({
      success: true,
      profileAnalysis,
      productsDetected,
      persona: personaData,
      draft: workspace.workspace_type === "friend" ? personaData : null,
      requiresApproval: workspace.workspace_type === "friend" || Boolean(draftOnly),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("analyze-profile error:", error);
    const message = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message || "Unknown error")
        : String(error || "Unknown error");
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
