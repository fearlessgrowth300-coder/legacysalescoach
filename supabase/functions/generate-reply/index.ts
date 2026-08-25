import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { generateEmbedding } from "../_shared/embeddings.ts";
import { deduplicateChunks, deduplicatePrinciples, mergeByIdPriority } from "../_shared/dedup.ts";
import {
  buildProspectEvidenceLedger,
  deduplicateConversationTurns,
  formatConversationHistory,
} from "../_shared/conversation-history.ts";
import { resolveUserChatTarget, userChat, NoUserAiKeyError } from "../_shared/user-ai.ts";
import { buildFriendDecisionSearchQuery, buildFriendLearningContext, buildFriendProspectProfile } from "../_shared/friend-learning.ts";
import {
  applyOutcomeAwareStrategyRank,
  loadKnowledgeGraphContext,
  loadProspectDecisionHistory,
  loadStrategyPerformance,
  persistProspectFactLedger,
  persistSalesDecision,
  recordInboundOutcomeSignals,
  traverseSalesKnowledgeGraph,
} from "../_shared/sales-superbrain.ts";
import {
  applyDeterministicCommercialRealityCheck,
  applyDeterministicSalesSignals,
  applyEarliestMissingFriendCheckpoint,
  buildFriendKnowledgeApplicationContract,
  buildDeterministicFriendFallbackMessages,
  buildFriendQualityValidatorPrompt,
  buildFriendStageDirective,
  deriveEvidenceGatedFriendStage,
  deterministicFriendQualityIssues,
  formatFriendKnowledgeApplicationContract,
  hydrateFriendKnowledgeApplication,
  friendStageToDatabase,
  selectRelevantConversationPassages,
} from "../_shared/friend-conversation-engine.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_SOURCE_TYPES = ["core_knowledge", "sales_principle", "content", "video", "pdf"];
const PAGE_SIZE = 1000;
const PRINCIPLE_SELECT = "id, principle_name, what_i_learned, how_to_apply, source_name, category, source_type, source_id, brain_type, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, common_mistake, knowledge_types, objection_types, hidden_causes, buying_stages, psychological_mechanisms, intended_outcomes, techniques, contraindications, language_patterns, extraction_confidence, evidence_mode";
const CHUNK_SELECT = "id, content, category, source_type, trigger_phrases, source_id, brain_type, relevance_score, chunk_kind, chunk_index, locator, metadata";
const MAX_SOURCE_COVERAGE_FILES = 32;

function keepHeadAndLatest(text: string, maxLength: number, headLength = 2000): string {
  if (!text || text.length <= maxLength) return text || "";
  const safeHead = Math.min(headLength, Math.floor(maxLength / 3));
  const tailLength = maxLength - safeHead - 48;
  return `${text.slice(0, safeHead)}\n\n[older middle content omitted]\n\n${text.slice(-tailLength)}`;
}

async function createScreenshotSignedUrl(supabase: any, userId: string, rawPath: unknown): Promise<string | null> {
  if (typeof rawPath !== "string" || !rawPath.startsWith(`${userId}/`)) return null;
  const { data, error } = await supabase.storage.from("chat-screenshots").createSignedUrl(rawPath, 300);
  if (error || !data?.signedUrl) {
    console.warn("[generate-reply] could not sign screenshot", error);
    return null;
  }
  return data.signedUrl;
}

const STOP_TERMS = new Set(["about", "after", "again", "also", "because", "being", "could", "doing", "from", "have", "here", "into", "just", "like", "more", "most", "much", "need", "only", "over", "really", "same", "should", "that", "their", "them", "then", "there", "these", "they", "thing", "this", "those", "through", "very", "want", "were", "what", "when", "where", "which", "with", "would", "your", "youre", "you", "she", "her", "him", "his", "was", "are", "the", "and", "for", "not", "but", "all", "can", "how", "why", "who", "its", "it"]);

function extractMeaningfulTerms(text: string, maxTerms = 48): string[] {
  const counts = new Map<string, number>();
  for (const raw of (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    const term = raw.trim();
    if (term.length < 4 || STOP_TERMS.has(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, maxTerms).map(([term]) => term);
}

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => Promise<{ data: T[] | null; error?: any }>,
  maxRows = 10000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await queryPage(from, to);
    if (error) {
      console.warn("[generate-reply] paged brain fetch failed", error);
      break;
    }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildStyleFingerprint(styleVector: any): string {
  if (!styleVector) return "No style fingerprint available.";
  const parts: string[] = [];
  if (styleVector.avg_message_length) parts.push(`Message Length: ${styleVector.avg_message_length}`);
  if (styleVector.question_density) parts.push(`Question Density: ${styleVector.question_density}`);
  if (styleVector.emoji_pattern) parts.push(`Emoji Usage: ${styleVector.emoji_pattern}`);
  if (styleVector.emoji_favorites?.length) parts.push(`Favorite Emojis: ${styleVector.emoji_favorites.join(" ")}`);
  if (styleVector.emotional_tone) parts.push(`Emotional Tone: ${styleVector.emotional_tone}`);
  if (styleVector.cta_softness) parts.push(`CTA Softness: ${styleVector.cta_softness}`);
  if (styleVector.vocabulary_level) parts.push(`Vocabulary Level: ${styleVector.vocabulary_level}`);
  if (styleVector.opening_style) parts.push(`Opening Style: ${styleVector.opening_style}`);
  if (styleVector.closing_style) parts.push(`Closing Style: ${styleVector.closing_style}`);
  if (styleVector.vulnerability_level) parts.push(`Vulnerability Level: ${styleVector.vulnerability_level}`);
  if (styleVector.power_phrases?.length) parts.push(`Power Phrases: "${styleVector.power_phrases.slice(0, 8).join('", "')}"`);
  if (styleVector.overall_personality) parts.push(`Overall Personality: ${styleVector.overall_personality}`);
  return parts.join("\n") || "No style fingerprint available.";
}

function diversityRerank(items: any[], sourceKey: string, maxPerSource: number) {
  const bySource: Record<string, any[]> = {};
  for (const item of items) {
    const key = item[sourceKey] || "unknown";
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push(item);
  }
  const result: any[] = [];
  let round = 0;
  let added = true;
  while (added) {
    added = false;
    for (const key of Object.keys(bySource)) {
      const startIdx = round * maxPerSource;
      const batch = bySource[key].slice(startIdx, startIdx + maxPerSource);
      if (batch.length > 0) { result.push(...batch); added = true; }
    }
    round++;
  }
  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prospectId, message: rawMessage, threadType, styleModifier, screenshotPath, screenshotContext: rawScreenshotContext } = await req.json();
    const activeThreadType: "friend" | "expert" = threadType === "expert" ? "expert" : "friend";
    let message = typeof rawMessage === "string" ? keepHeadAndLatest(rawMessage, 12000) : "";
    const screenshotContext = typeof rawScreenshotContext === "string" ? keepHeadAndLatest(rawScreenshotContext, 6000, 1000) : "";

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: authError } = await authClient.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (authError || !userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: userId };
    let chat;
    try {
      chat = await resolveUserChatTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }


    // ===== PARALLEL DATA FETCH =====
    const { data: prospect } = await supabase.from("prospects").select("*").eq("id", prospectId).eq("user_id", user.id).single();
    if (!prospect) {
      return new Response(JSON.stringify({ error: "Prospect not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [
      { data: workspace },
      { data: allHistory },
      { data: kbItems },
      { data: trainingExamples },
      { data: positiveFeedback },
      { data: winningAnalytics },
      { data: leadEntry },
      { data: friendAudienceSignals },
      { data: approvedProofAssets },
    ] = await Promise.all([
      supabase.from("workspaces").select("*").eq("id", prospect.workspace_id).single(),
      supabase.from("chat_messages").select("*").eq("prospect_id", prospectId).eq("thread_type", activeThreadType).order("created_at"),
      supabase.from("knowledge_base_items").select("id, title, type, brain_type").eq("user_id", user.id),
      supabase.from("workspace_training_data").select("content, title, style_analysis").eq("workspace_id", prospect.workspace_id).eq("status", "ready").not("content", "is", null).order("created_at", { ascending: false }).limit(10),
      supabase.from("suggestion_feedback").select("suggestion_text, suggestion_type, conversation_stage, framework_used").eq("user_id", user.id).eq("workspace_id", prospect.workspace_id).eq("thread_type", activeThreadType).eq("feedback", "positive").order("created_at", { ascending: false }).limit(15),
      supabase.from("conversation_analytics").select("questioning_patterns_used, key_insights, tone_progression").eq("user_id", user.id).eq("workspace_id", prospect.workspace_id).eq("outcome", "won"),
      supabase.from("lead_registry").select("*").eq("user_id", user.id).eq("prospect_id", prospectId).maybeSingle(),
      supabase.from("friend_audience_signals")
        .select("signal_type, signal_key, observation_count, positive_feedback_count, win_count, loss_count")
        .eq("user_id", user.id)
        .eq("workspace_id", prospect.workspace_id)
        .order("observation_count", { ascending: false })
        .limit(80),
      supabase.from("workspace_proof_assets")
        .select("title, result_type, result_value, result_date, description")
        .eq("user_id", user.id)
        .eq("workspace_id", prospect.workspace_id)
        .eq("approved_for_ai", true)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const history = deduplicateConversationTurns(allHistory || []);
    const speakerMessages = history.filter((m: any) => m.direction === "inbound" || m.direction === "outbound");
    const recentMessages = history.slice(-10);
    if (screenshotPath) {
      // The client may supply the full editable OCR transcript. Never label
      // that mixed-speaker block as the prospect's latest message. The bubbles
      // were already stored with directions, so the newest inbound row is the
      // authoritative prospect turn.
      const latestInbound = [...speakerMessages].reverse().find((item: any) => item.direction === "inbound");
      if (latestInbound?.content?.trim()) message = keepHeadAndLatest(latestInbound.content.trim(), 12000);
    }
    if (activeThreadType === "friend") {
      const latestInbound = [...speakerMessages].reverse().find((item: any) => item.direction === "inbound");
      await recordInboundOutcomeSignals({
        supabase,
        userId: user.id,
        workspaceId: prospect.workspace_id,
        prospectId,
        threadType: activeThreadType,
        messageId: latestInbound?.id || null,
        message,
      });
    }

    // Resolve the configured Friend -> Expert relationship so referral-stage
    // replies can hand the prospect to the correct expert instead of inventing
    // or using a generic destination.
    let linkedExpertWorkspace: any = null;
    if (activeThreadType === "friend") {
      const { data: workspaceLinks } = await supabase
        .from("workspace_links")
        .select("expert_workspace_id")
        .eq("user_id", user.id)
        .eq("friend_workspace_id", prospect.workspace_id)
        .limit(1);
      const expertWorkspaceId = workspaceLinks?.[0]?.expert_workspace_id;
      if (expertWorkspaceId) {
        const { data: expertWorkspace } = await supabase
          .from("workspaces")
          .select("id, name, niche_description, positioning, products_detected, expert_description, instagram_url, store_url")
          .eq("id", expertWorkspaceId)
          .eq("user_id", user.id)
          .maybeSingle();
        linkedExpertWorkspace = expertWorkspace;
      }
    }

    // Build conversation history string
    const conversationHistory = history
      .map((m: any) => `${m.direction === "outbound" ? "YOU" : m.direction === "context" ? "SALESPERSON NOTE" : m.direction === "unknown" ? "UNKNOWN SPEAKER" : "PROSPECT"}: ${m.content}`)
      .join("\n");

    // ===== BRAIN RETRIEVAL (RAG) =====
    const last3 = recentMessages.slice(-3).map((m: any) => m.content).join(" ");
    const brainQuery = keepHeadAndLatest(`${message} ${screenshotContext} ${prospect.detected_interests || ""} ${last3}`, 2400, 500);
    const embeddingPromise = generateEmbedding(brainQuery, supabase, user.id);

    const [
      globalPrinciples,
      userPrinciples,
      globalChunks,
      userChunks,
      { data: wsConvoChunks },
      { data: brainInsights },
      queryEmbedding,
    ] = await Promise.all([
      supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .is("workspace_id", null)
        .in("brain_type", [activeThreadType, "both"])
        .in("source_type", ["core_knowledge", "sales_principle"])
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(150).then(r => r.data || []),
      supabase.from("sales_brain")
        .select(PRINCIPLE_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("brain_type", [activeThreadType, "both"])
        .in("source_type", ALLOWED_SOURCE_TYPES)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(200).then(r => r.data || []),
      supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .is("workspace_id", null)
        .in("brain_type", [activeThreadType, "both"])
        .eq("source_type", "core_knowledge")
        .order("relevance_score", { ascending: false })
        .limit(150).then(r => r.data || []),
      supabase.from("knowledge_chunks")
        .select(CHUNK_SELECT)
        .eq("user_id", user.id).is("workspace_id", null)
        .in("brain_type", [activeThreadType, "both"])
        .in("source_type", ["core_knowledge", "content", "video", "pdf"])
        .order("relevance_score", { ascending: false })
        .limit(200).then(r => r.data || []),

      supabase.from("knowledge_chunks")
        .select("id, content, category, source_type, trigger_phrases, source_id, created_at")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id)
        .in("brain_type", [activeThreadType, "both"])
        .in("source_type", ["conversation", "training_conversation"])
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("learned_insights")
        .select("insight, insight_type, source")
        .eq("user_id", user.id).eq("workspace_id", prospect.workspace_id)
        .order("created_at", { ascending: false }).limit(15),
      embeddingPromise,
    ]);

    const kbMap: Record<string, string> = {};
    const kbModeMap: Record<string, string> = {};
    (kbItems || []).forEach((k: any) => {
      kbMap[k.id] = k.title;
      kbModeMap[k.id] = k.brain_type || "both";
    });

    const sourceCoverageIds = (kbItems || []).map((k: any) => k.id).filter(Boolean).slice(0, MAX_SOURCE_COVERAGE_FILES);
    const [sourceCoveragePrinciplesNested, sourceCoverageChunksNested] = await Promise.all([
      Promise.all(sourceCoverageIds.map((sourceId: string) =>
        supabase.from("sales_brain")
          .select(PRINCIPLE_SELECT)
          .eq("user_id", user.id)
          .is("workspace_id", null)
          .in("brain_type", [activeThreadType, "both"])
          .eq("source_id", sourceId)
          .in("source_type", ALLOWED_SOURCE_TYPES)
          .order("relevance_score", { ascending: false, nullsFirst: false })
          .limit(5)
          .then((r: any) => r.data || [])
      )),
      Promise.all(sourceCoverageIds.map((sourceId: string) =>
        supabase.from("knowledge_chunks")
          .select(CHUNK_SELECT)
          .eq("user_id", user.id)
          .is("workspace_id", null)
          .in("brain_type", [activeThreadType, "both"])
          .eq("source_id", sourceId)
          .in("source_type", ALLOWED_SOURCE_TYPES)
          .order("relevance_score", { ascending: false, nullsFirst: false })
          .limit(4)
          .then((r: any) => r.data || [])
      )),
    ]);
    const sourceCoveragePrinciples = sourceCoveragePrinciplesNested.flat();
    const sourceCoverageChunks = sourceCoverageChunksNested.flat();

    // Semantic search
    let semanticPrinciples: any[] = [];
    let semanticChunks: any[] = [];
    if (queryEmbedding) {
      const embStr = JSON.stringify(queryEmbedding);
      const [semP, semC] = await Promise.all([
        supabase.rpc("match_sales_brain", { query_embedding: embStr, match_count: 260, match_threshold: 0.12, p_user_id: user.id }),
        supabase.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 180, match_threshold: 0.12, p_user_id: user.id }),
      ]);
      semanticPrinciples = (semP.data || [])
        .filter((p: any) => ALLOWED_SOURCE_TYPES.includes(p.source_type) && (
          (!p.source_id && (!p.brain_type || p.brain_type === "both" || p.brain_type === activeThreadType)) ||
          (p.source_id && (!kbModeMap[p.source_id] || kbModeMap[p.source_id] === "both" || kbModeMap[p.source_id] === activeThreadType))
        ))
        .map((p: any) => ({ ...p, _semantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
      semanticChunks = (semC.data || [])
        .filter((c: any) => ALLOWED_SOURCE_TYPES.includes(c.source_type) && (!c.brain_type || c.brain_type === "both" || c.brain_type === activeThreadType))
        .map((c: any) => ({ ...c, _semantic: true, relevance_score: Math.round((c.similarity || 0) * 100) }));
    }

    // Merge + deduplicate + message-focused source-balanced ranking
    const allPrinciples = mergeByIdPriority(sourceCoveragePrinciples, mergeByIdPriority(userPrinciples, globalPrinciples));
    const allChunks = mergeByIdPriority(sourceCoverageChunks, mergeByIdPriority(userChunks, globalChunks));
    const mergedPrinciples = deduplicatePrinciples(mergeByIdPriority(semanticPrinciples, allPrinciples), "relevance_score");
    const mergedChunks = deduplicateChunks(mergeByIdPriority(semanticChunks, allChunks), "relevance_score");

    const messageTerms = extractMeaningfulTerms(`${message} ${screenshotContext} ${last3}`);
    function sourceNameFor(item: any) {
      return item.source_id && kbMap[item.source_id] ? kbMap[item.source_id] : (item.source_name || item.source_type || "unknown");
    }
    function scoreAgainstMessage(text: string, semanticScore: number): number {
      const lower = (text || "").toLowerCase();
      let score = semanticScore * 8;
      for (const term of messageTerms) if (lower.includes(term)) score += 5;
      return score;
    }
    function sourceBalancedTake(items: any[], maxPerSource: number, limit: number) {
      const counts: Record<string, number> = {};
      const selected: any[] = [];
      const overflow: any[] = [];
      for (const item of items) {
        const key = sourceNameFor(item);
        const count = counts[key] || 0;
        if (count < maxPerSource) {
          counts[key] = count + 1;
          selected.push(item);
        } else {
          overflow.push(item);
        }
        if (selected.length >= limit) break;
      }
      return selected.length >= limit ? selected : [...selected, ...overflow].slice(0, limit);
    }

    const scoredPrinciples = mergedPrinciples.map((p: any) => {
      const text = `${p.principle_name || ""} ${p.what_i_learned || ""} ${p.how_to_apply || ""} ${p.when_to_use || ""} ${p.exact_words_to_use || ""} ${p.the_deep_why || ""}`;
      const sem = p._semantic ? (p.relevance_score || 0) / 100 : 0;
      return { ...p, matchScore: scoreAgainstMessage(text, sem) };
    }).sort((a: any, b: any) => b.matchScore - a.matchScore);

    const scoredChunks = diversityRerank(mergedChunks, "source_id", 2).map((c: any) => {
      const text = `${c.content || ""} ${c.trigger_phrases || ""}`;
      const sem = c._semantic ? (c.relevance_score || 0) / 100 : 0;
      return { ...c, matchScore: scoreAgainstMessage(text, sem) };
    }).sort((a: any, b: any) => b.matchScore - a.matchScore);

    const kbCount = kbItems?.length || 0;
    const principlesCap = Math.min(Math.max(60, kbCount * 10), 200);
    const chunksCap = Math.min(Math.max(35, kbCount * 8), 150);

    // Workspace-first retrieval
    const wsFirstCandidates = activeThreadType === "friend"
      ? (wsConvoChunks || []).filter((chunk: any) => chunk.source_type === "training_conversation")
      : (wsConvoChunks || []);
    const wsFirst = wsFirstCandidates.slice(0, 25);
    const remaining = Math.max(chunksCap - wsFirst.length, 15);
    const topChunks = [...wsFirst, ...sourceBalancedTake(scoredChunks, 3, remaining)].slice(0, chunksCap);
    const topPrinciples = sourceBalancedTake(scoredPrinciples, 2, principlesCap);

    // Format brain principles for prompt
    const principlesText = topPrinciples.length > 0
      ? topPrinciples.map((p: any) => {
          const src = p.source_id && kbMap[p.source_id] ? kbMap[p.source_id] : p.source_name;
          const power = p.power_level ?? 5;
          return `• [${p.principle_name}] (Source: ${src}) (Power: ${power}/10): ${p.what_i_learned}\n  Apply: ${p.how_to_apply}`;
        }).join("\n")
      : "No principles uploaded yet.";

    // These chunks were previously retrieved and reported to the UI but never
    // included in either model prompt. Keep the most relevant source-balanced
    // excerpts concise enough to remain usable by the reasoning model.
    const chunksText = topChunks.length > 0
      ? topChunks.slice(0, 45).map((c: any) => {
          const sourceTitle = c.source_id && kbMap[c.source_id] ? kbMap[c.source_id] : c.source_type;
          const src = `${sourceTitle}${c.locator ? `, ${c.locator}` : ""}${c.chunk_kind === "source_passage" ? ", original source passage" : ""}`;
          return `• (Source: ${src}) [${c.category || "general"}]: ${(c.content || "").substring(0, 700)}`;
        }).join("\n")
      : "No relevant knowledge chunks retrieved.";

    const learnedInsightsText = (brainInsights || []).length > 0
      ? (brainInsights || []).slice(0, 12).map((i: any) => `• ${i.insight}${i.source ? ` (Source: ${i.source})` : ""}`).join("\n")
      : "No workspace conversation insights yet.";

    const winningPatternsText = (winningAnalytics || []).length > 0
      ? (winningAnalytics || []).slice(0, 10).map((a: any) =>
          `• Questions: ${(a.questioning_patterns_used || []).join(", ") || "unknown"}; Insights: ${(a.key_insights || []).join(" | ") || "none"}`
        ).join("\n")
      : "No verified winning conversation patterns yet.";

    const friendPersonaApproved = workspace?.workspace_type !== "friend" || workspace?.friend_persona_status !== "draft";
    const approvedFriendPersona = friendPersonaApproved && workspace?.friend_persona && typeof workspace.friend_persona === "object"
      ? workspace.friend_persona as Record<string, any>
      : {};
    const approvedOfferTruth = friendPersonaApproved && workspace?.offer_truth && typeof workspace.offer_truth === "object"
      ? workspace.offer_truth as Record<string, any>
      : {};
    const approvedStories = friendPersonaApproved && Array.isArray(workspace?.approved_stories)
      ? workspace.approved_stories.slice(0, 12)
      : [];
    const approvedConversationExamples = friendPersonaApproved
      ? String(approvedFriendPersona.conversation_examples || "").trim()
      : "";
    const approvedProofText = friendPersonaApproved && (approvedProofAssets || []).length > 0
      ? (approvedProofAssets || []).map((proof: any) =>
          `• ${proof.title}${proof.result_value ? `: ${proof.result_value}` : ""}${proof.result_date ? ` (${proof.result_date})` : ""}${proof.description ? ` — ${proof.description}` : ""}`
        ).join("\n")
      : "No approved result evidence. Do not state income, sales numbers or performance claims.";
    const approvedFriendContext = friendPersonaApproved && workspace?.workspace_type === "friend"
      ? [
          approvedFriendPersona.display_name ? `Approved Friend Identity: ${approvedFriendPersona.display_name}` : "",
          approvedFriendPersona.role ? `Friend Role: ${approvedFriendPersona.role}` : "",
          approvedFriendPersona.voice_notes ? `Friend Voice: ${approvedFriendPersona.voice_notes}` : "",
          approvedOfferTruth.name ? `Approved Offer: ${approvedOfferTruth.name}` : "",
          approvedOfferTruth.description ? `Offer Truth: ${approvedOfferTruth.description}` : "",
          approvedOfferTruth.personal_experience ? `Genuine Offer Experience: ${approvedOfferTruth.personal_experience}` : "",
          approvedOfferTruth.price ? `Verified Offer Price: ${approvedOfferTruth.price}` : "",
          approvedOfferTruth.who_it_is_for ? `Offer Fit: ${approvedOfferTruth.who_it_is_for}` : "",
          approvedOfferTruth.who_it_is_not_for ? `Offer Not For: ${approvedOfferTruth.who_it_is_not_for}` : "",
          approvedOfferTruth.referral_url ? `Approved Referral URL: ${approvedOfferTruth.referral_url}` : "",
          approvedStories.length ? `Approved True Stories:\n${approvedStories.map((story: string) => `• ${story}`).join("\n")}` : "No approved story library. Do not invent a personal story.",
          `Approved Result Evidence:\n${approvedProofText}`,
          workspace.forbidden_claims ? `Forbidden Claims:\n${workspace.forbidden_claims}` : "",
          `Learning Mode: ${workspace.friend_learning_mode || "review"}`,
        ].filter(Boolean).join("\n")
      : workspace?.workspace_type === "friend"
        ? "FRIEND PERSONA IS A DRAFT. Ignore automatic persona, story, result, product and referral inferences until the user approves them."
        : "";

    // ===== STEP 1: RUN CONVERSATION ANALYSIS =====
    const workspaceProfile = workspace ? [
      workspace.name ? `Workspace: ${workspace.name}` : "",
      workspace.niche_description ? `Niche: ${workspace.niche_description}` : "",
      workspace.target_audience ? `Target: ${workspace.target_audience}` : "",
      workspace.business_model ? `Business Model: ${workspace.business_model}` : "",
      workspace.positioning ? `Positioning: ${workspace.positioning}` : "",
      workspace.profile_analysis ? `Profile: ${workspace.profile_analysis}` : "",
      workspace.products_detected ? `Products: ${workspace.products_detected}` : "",
      workspace.custom_framework ? `Custom Framework:\n${workspace.custom_framework}` : "",
      workspace.parsed_framework ? `Structured Framework:\n${JSON.stringify(workspace.parsed_framework)}` : "",
      approvedConversationExamples ? `Full Approved Reference Conversation:\n${approvedConversationExamples}` : "",
      friendPersonaApproved && workspace.friend_backstory ? `Friend Backstory: ${workspace.friend_backstory}` : "",
      friendPersonaApproved && workspace.transformation ? `Transformation: ${workspace.transformation}` : "",
      friendPersonaApproved && workspace.expert_description ? `Expert Description: ${workspace.expert_description}` : "",
      friendPersonaApproved && workspace.referral_triggers ? `Referral Triggers: ${workspace.referral_triggers}` : "",
      approvedFriendContext,
    ].filter(Boolean).join("\n") : "No workspace profile.";

    const linkedExpertContext = linkedExpertWorkspace
      ? [
          `Linked Expert Workspace: ${linkedExpertWorkspace.name}`,
          linkedExpertWorkspace.niche_description ? `Expert Niche: ${linkedExpertWorkspace.niche_description}` : "",
          linkedExpertWorkspace.positioning ? `Expert Positioning: ${linkedExpertWorkspace.positioning}` : "",
          linkedExpertWorkspace.products_detected ? `Expert Services: ${linkedExpertWorkspace.products_detected}` : "",
          linkedExpertWorkspace.expert_description ? `Expert Identity: ${linkedExpertWorkspace.expert_description}` : "",
          linkedExpertWorkspace.instagram_url ? `Expert Instagram: ${linkedExpertWorkspace.instagram_url}` : "",
          linkedExpertWorkspace.store_url ? `Expert Destination: ${linkedExpertWorkspace.store_url}` : "",
        ].filter(Boolean).join("\n")
      : friendPersonaApproved && workspace?.expert_description
        ? `Configured Expert: ${workspace.expert_description}${workspace.store_url ? `\nWorkspace Destination: ${workspace.store_url}` : ""}`
        : "No linked Expert workspace is configured. Use only an expert explicitly named in the Custom Framework; otherwise ask permission to introduce the trusted team without inventing details.";

    const existingFriendProfile = activeThreadType === "friend" && leadEntry?.prospect_profile && typeof leadEntry.prospect_profile === "object"
      ? leadEntry.prospect_profile as Record<string, unknown>
      : {};
    const friendLearningContext = activeThreadType === "friend"
      ? buildFriendLearningContext(existingFriendProfile, friendAudienceSignals || [])
      : "Friend learning is not used in Expert mode.";
    const prospectDecisionHistory = activeThreadType === "friend"
      ? await loadProspectDecisionHistory(supabase, user.id, prospectId, activeThreadType)
      : "Fact-level Friend decision history is not used in Expert mode.";

    const analysisPrompt = `You are a sales conversation intelligence engine with an OBJECTION RADAR and multi-framework analyzer. Analyze and return JSON ONLY.

Return the existing sales fields plus these REQUIRED structured learning fields: "segment" (beginner|first_sale_stuck|inconsistent_sales|mentor_no_results|independent|tried_before|already_successful|not_ready|other), "experience_level", "sales_status", "mentor_status", "current_strategy", "interests" (array), "desires" (array), "pain_points" (array), "objections" (array), "questions_already_answered" (array of topics or questions the conversation has already resolved), "objections_handled" (array), "strategies_attempted" (array), "exact_unresolved_issue", "motivation", "intent" (what they are trying to protect, prove, avoid or achieve), "tangible_goal" (the concrete result they want), "problem_gap" (distance between current and desired state), "problem_status" (active|past_resolved|unclear|none), "doubt_cause" (why they hesitate), "certainty_gap" (what must become logically clear), "reply_act" (relate|share_story|validate|answer|observe|probe|reframe|transition|ask_permission|refer|stop), "question_needed" (boolean), "knowledge_need" (the exact principle or evidence needed, or "none"), "readiness" (not_ready|exploring|problem_aware|wants_help|accepted_referral), "contact_status" (active|not_now|do_not_contact|not_a_fit), "next_best_action", "learning_confidence" (0-100), and "evidence" (short array of conversation facts supporting the profile). New explicit facts always correct stale memory: a prospect saying sales are not consistent yet is inconsistent_sales, not already_successful or unknown; preserve any current Bootcamp, mentor, course, program, or team support they mention. Never list an unanswered question as answered.
Also REQUIRED for the certainty funnel: "why_goal_matters", "past_experiences" (array), "root_cause", "consequences", "need_for_change_reason", "inaction_pattern", and "detailed_future_outcome".

Existing sales fields: { "warmth_score": <0-100>, "stage": <"intent"|"logical_certainty"|"emotional_certainty"|"pitch"|"handoff">, "prospect_psychology": <string>, "pain_expressed": <boolean>, "pain_summary": <string|null>, "signals_detected": [<strings>], "predicted_next_objection": <string|null>, "recommended_move": <string>, "brain_principle_used": <string|null>, "brain_principle_reason": <string|null>, "stage_reason": <string>, "detectedTone": <string>, "prospectType": <string>, "objection_detected": <string|null>, "objection_bucket": <string|null>, "objection_response_type": <string|null>, "spin_stage": <string>, "offer_fit": <string>, "referral_readiness": <string>, "next_objective": <string>, "prospect_fears": [<strings>], "prospect_dreams": [<strings>], "conversion_triggers": [<strings>] }

OBJECTION RADAR: Scan EVERY message for objection language. Classify: TIME, MONEY, TRUST, CERTAINTY, PRIORITY, FEAR, TIMING, NEED_MORE_CLARITY. Recommend response type: CLARIFY, REASSURE, REFRAME, DEEPEN, ISOLATE, HAND_OFF.
SPIN DETECTION: <4 exchanges="situation", personal but no pain="problem", pain not amplified="implication", pain+wants change="need_payoff".
CERTAINTY FUNNEL: return intent|logical_certainty|emotional_certainty|pitch|handoff. intent = surface goal -> why it matters -> previous attempts -> actual experience -> their explanation -> likely root cause. logical_certainty = goal -> reason -> obstacle -> root cause -> consequences -> unresolved gap -> need for change. emotional_certainty = inaction pattern -> empathetic mirror -> detailed future outcome. pitch = full-context recap -> confirm gap -> connect desired outcome -> position relevant approved expert help -> ask permission. handoff = accepted permission -> concrete approved expert/team destination. Follow the stages in order and preserve prior answers. Warmth, message count, or a shallow first answer never completes a stage. A clear refusal exits safely; an explicit request for the expert may proceed directly to handoff.
SALES-GAP RULE: "I am not making sales", "sales are inconsistent", "I need more sales", and equivalent first-person statements are an active personal sales gap, not casual rapport. Identify whether the bottleneck is traffic, offer, messaging, conversion, follow-up, or consistency. Set knowledge_need to the exact sales psychology or framework needed. If the prospect explicitly asks for help with sales, readiness=wants_help and reply_act=ask_permission; otherwise use one focused diagnostic act and move toward a permission-based transition when the gap is sufficiently understood.
REFERRAL READINESS: not_ready until a relevant problem/desire is clear; ask_permission when fit looks plausible and the prospect wants help; ready_for_handoff only after permission or an explicit request for the expert/link. Never use warmth alone as proof of fit.
LEARNING: Build structured fields only from explicit evidence. "Made one sale", "working with a mentor", "tried before", and "doing it alone" are different states. Preserve useful known facts from CURRENT PROSPECT MEMORY unless newer evidence corrects them.
REPLY ACT: Choose what a real peer should do next. A question is optional. Prefer relating, sharing an approved experience, answering, observing or validating when discovery is not needed. Set question_needed=true only when one answer is necessary to understand the person or advance the conversation naturally.
BOUNDARIES: "Don't contact me", "leave me alone", or an equivalent explicit refusal means contact_status=do_not_contact, recommended_move=respect_boundary, referral_readiness=not_ready, and next_best_action=respectfully stop. "Not now" means contact_status=not_now. Never treat a boundary as an objection to overcome.
WARMTH: +5-15 personal detail, +10 shared struggle, +15 asked about you, +20 wants change, -10 short/low energy, -15 skeptical.
VISUAL EVIDENCE: When a screenshot is supplied, use visible speaker alignment, reactions, quoted replies, timestamps, read/seen/delivered status, unanswered-message state, and attachments. If OCR conflicts with the image, trust the image and mention the conflict in signals_detected. Treat salesperson notes as context, never as the prospect's words.`;

    const prospectEvidenceLedger = buildProspectEvidenceLedger(history);
    const analysisUserPrompt = `WORKSPACE_PROFILE:
${workspaceProfile}

LINKED_EXPERT:
${linkedExpertContext}

SCREENSHOT_VISUAL_CONTEXT:
${screenshotContext || "No screenshot supplied."}

SALES_BRAIN_PRINCIPLES:
${principlesText.substring(0, 4500)}

RELEVANT_KNOWLEDGE_CHUNKS:
${chunksText.substring(0, 4500)}

WORKSPACE_LEARNINGS:
${learnedInsightsText.substring(0, 2000)}

FRIEND_LEARNING_MEMORY:
${friendLearningContext.substring(0, 5000)}

FACT_AND_STRATEGY_LEDGER:
${prospectDecisionHistory.substring(0, 6500)}

PROSPECT_EVIDENCE_LEDGER (every unique inbound turn, chronological):
${prospectEvidenceLedger}

CONVERSATION_HISTORY:
${formatConversationHistory(history)}

AUTHORITATIVE LATEST PROSPECT MESSAGE:
${message || "No inbound prospect message was found."}

SPEAKER SAFETY: YOU/OUTBOUND rows are the app user's messages. PROSPECT/INBOUND rows are the buyer's messages. Never answer a YOU message as though the prospect said it.`;
    const screenshotSignedUrl = await createScreenshotSignedUrl(supabase, user.id, screenshotPath);
    const analysisUserContent: any = screenshotSignedUrl && !chat.isAnthropic
      ? [
          { type: "text", text: `${analysisUserPrompt}\n\nInspect the attached original screenshot as primary evidence. Reconcile it with the extracted transcript, note any OCR/speaker errors, and use visible reactions, timestamps, read status, quoted replies, and attachments in the analysis.` },
          { type: "image_url", image_url: { url: screenshotSignedUrl } },
        ]
      : analysisUserPrompt;

    let analysisJson: any = { warmth_score: 20, stage: "friend", prospect_psychology: "Unknown", pain_expressed: false, pain_summary: null, signals_detected: [], predicted_next_objection: null, recommended_move: "empathy_mirror", brain_principle_used: null, brain_principle_reason: null, stage_reason: "Deterministic fallback", detectedTone: "neutral", prospectType: "unknown", objection_detected: null, objection_bucket: null, objection_response_type: null, spin_stage: "situation", offer_fit: "uncertain", referral_readiness: "not_ready", next_objective: "Understand the prospect before suggesting anything", segment: "other", experience_level: "unknown", sales_status: "unknown", mentor_status: "unknown", current_strategy: "unknown", interests: [], desires: [], pain_points: [], objections: [], motivation: "unknown", intent: "unknown", tangible_goal: "unknown", problem_gap: "unknown", doubt_cause: "unknown", certainty_gap: "unknown", reply_act: "respond naturally", question_needed: false, knowledge_need: "none", readiness: "not_ready", contact_status: "active", next_best_action: "continue discovery", learning_confidence: 0, evidence: [] };
    try {
      const analysisResponse = await userChat(chat, {
        model: screenshotSignedUrl && !chat.isAnthropic ? chat.models.vision : chat.models.fast,
        messages: [
          { role: "system", content: analysisPrompt },
          { role: "user", content: analysisUserContent },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
        timeout_ms: 15000,
      });
      if (!analysisResponse.ok) throw new Error(`Analysis AI error: ${analysisResponse.status}`);
      const analysisData = await analysisResponse.json();
      const analysisRaw = analysisData.choices?.[0]?.message?.content || "";
      if (!analysisRaw.trim()) throw new Error("Analysis AI returned no usable content");
      const match = analysisRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
      analysisJson = JSON.parse((match ? match[1] : analysisRaw).trim());
    } catch (analysisError) {
      if (activeThreadType !== "friend") throw analysisError;
      console.warn("[generate-reply] Friend analysis used deterministic fallback", analysisError);
    }

    if (activeThreadType === "friend") {
      const prospectOnlyHistory = speakerMessages
        .filter((item: any) => item.direction === "inbound")
        .map((item: any) => String(item.content || ""))
        .join("\n");
      analysisJson = applyDeterministicSalesSignals(analysisJson, message, prospectOnlyHistory);
      analysisJson = applyDeterministicCommercialRealityCheck(analysisJson, message, prospectOnlyHistory);
      // Merge the newest evidence into this prospect's durable memory before
      // deriving a stage. This prevents later short replies from erasing
      // Intent, Logical, or Emotional evidence collected earlier.
      analysisJson = {
        ...analysisJson,
        ...buildFriendProspectProfile(analysisJson, existingFriendProfile),
      };
      analysisJson = applyEarliestMissingFriendCheckpoint(analysisJson);
    }

    // Both Friend reply paths use one evidence-gated five-stage journey. A
    // warm tone or a long thread can never advance a prospect by itself.
    const explicitContactBoundary = analysisJson.contact_status === "do_not_contact";
    if (explicitContactBoundary) {
      analysisJson.referral_readiness = "not_ready";
      analysisJson.recommended_move = "respect_boundary";
    } else if (analysisJson.contact_status === "not_a_fit") {
      analysisJson.referral_readiness = "not_ready";
    }
    const friendStageResult = deriveEvidenceGatedFriendStage(analysisJson, speakerMessages.length);
    analysisJson.stage = friendStageResult.stage;
    analysisJson.earliest_missing_checkpoint = friendStageResult.checkpoint;
    analysisJson.stage_evidence = friendStageResult.evidence;
    analysisJson.stage_missing = friendStageResult.missing;

    // ===== FRIEND PASS 2: DECISION-AWARE KNOWLEDGE RETRIEVAL =====
    // The first retrieval gives the analyzer broad context. After the analyzer
    // identifies intent, experience, desired result, gap, doubt, certainty and
    // the appropriate peer act, search again using that decision state.
    let replyTopPrinciples = topPrinciples;
    let replyTopChunks = topChunks;
    let replyPrinciplesText = principlesText;
    let replyChunksText = chunksText;
    let appliedRetrievalQuery = brainQuery;
    if (activeThreadType === "friend") {
      const decisionQuery = buildFriendDecisionSearchQuery(analysisJson, message, existingFriendProfile);
      appliedRetrievalQuery = decisionQuery;
      const decisionEmbedding = await generateEmbedding(decisionQuery, supabase, user.id);
      if (decisionEmbedding) {
        const embStr = JSON.stringify(decisionEmbedding);
        const [decisionP, decisionC] = await Promise.all([
          supabase.rpc("match_sales_brain", { query_embedding: embStr, match_count: 120, match_threshold: 0.14, p_user_id: user.id }),
          supabase.rpc("match_knowledge_chunks", { query_embedding: embStr, match_count: 100, match_threshold: 0.14, p_user_id: user.id }),
        ]);
        const decisionSemanticPrinciples = (decisionP.data || [])
          .filter((p: any) => ALLOWED_SOURCE_TYPES.includes(p.source_type) && (
            (!p.source_id && (!p.brain_type || p.brain_type === "both" || p.brain_type === activeThreadType)) ||
            (p.source_id && (!kbModeMap[p.source_id] || kbModeMap[p.source_id] === "both" || kbModeMap[p.source_id] === activeThreadType))
          ))
          .map((p: any) => ({ ...p, _decisionSemantic: true, relevance_score: Math.round((p.similarity || 0) * 100) }));
        const decisionSemanticChunks = (decisionC.data || [])
          .filter((c: any) => ALLOWED_SOURCE_TYPES.includes(c.source_type) && (!c.brain_type || c.brain_type === "both" || c.brain_type === activeThreadType))
          .map((c: any) => ({ ...c, _decisionSemantic: true, relevance_score: Math.round((c.similarity || 0) * 100) }));
        const decisionTerms = extractMeaningfulTerms(decisionQuery, 64);
        const scoreForDecision = (text: string, semantic: number) => {
          const lower = (text || "").toLowerCase();
          let score = semantic * 10;
          for (const term of decisionTerms) if (lower.includes(term)) score += 6;
          return score;
        };
        const decisionPrinciples = deduplicatePrinciples(
          mergeByIdPriority(decisionSemanticPrinciples, mergedPrinciples),
          "relevance_score",
        ).map((p: any) => ({
          ...p,
          matchScore: scoreForDecision(
            `${p.principle_name || ""} ${p.what_i_learned || ""} ${p.how_to_apply || ""} ${p.when_to_use || ""} ${p.the_deep_why || ""}`,
            p._decisionSemantic ? (p.relevance_score || 0) / 100 : 0,
          ),
        })).sort((a: any, b: any) => b.matchScore - a.matchScore);
        const decisionChunks = deduplicateChunks(
          mergeByIdPriority(decisionSemanticChunks, mergedChunks),
          "relevance_score",
        ).map((c: any) => ({
          ...c,
          matchScore: scoreForDecision(`${c.content || ""} ${c.trigger_phrases || ""}`, c._decisionSemantic ? (c.relevance_score || 0) / 100 : 0),
        })).sort((a: any, b: any) => b.matchScore - a.matchScore);

        // Keep the second pass tightly focused on the diagnosed moment. A huge
        // context set lets broad material overpower the exact sales gap.
        replyTopPrinciples = sourceBalancedTake(decisionPrinciples, 1, 8);
        replyTopChunks = sourceBalancedTake(decisionChunks, 1, 10);
        replyPrinciplesText = replyTopPrinciples.length
          ? replyTopPrinciples.map((p: any) => {
              const src = p.source_id && kbMap[p.source_id] ? kbMap[p.source_id] : p.source_name;
              return `• [${p.principle_name}] (Source: ${src}): ${p.what_i_learned}\n  Apply: ${p.how_to_apply}`;
            }).join("\n")
          : "No principle is required. Respond naturally from the current conversation and approved Friend identity.";
        replyChunksText = replyTopChunks.length
          ? replyTopChunks.map((c: any) => {
              const sourceTitle = c.source_id && kbMap[c.source_id] ? kbMap[c.source_id] : c.source_type;
              const src = `${sourceTitle}${c.locator ? `, ${c.locator}` : ""}${c.chunk_kind === "source_passage" ? ", original source passage" : ""}`;
              return `• (Source: ${src}) [${c.category || "general"}]: ${(c.content || "").substring(0, 700)}`;
            }).join("\n")
          : "No knowledge passage is necessary for this reply.";
      }
    }

    // Outcome-aware ranking augments relevance; it never replaces it. New
    // strategies receive a neutral prior, while repeated failures for this
    // exact prospect are penalized and verified positive outcomes add weight.
    let strategyPerformance: any[] = [];
    const decisionGraphTraversal = activeThreadType === "friend"
      ? await traverseSalesKnowledgeGraph(supabase, user.id, appliedRetrievalQuery)
      : { text: "(Friend decision graph not used)", paths: [] as Array<Record<string, unknown>>, candidateSalesBrainIds: [] as string[] };
    if (decisionGraphTraversal.candidateSalesBrainIds.length > 0) {
      const graphIds = new Set(decisionGraphTraversal.candidateSalesBrainIds);
      const graphCandidates = mergedPrinciples.filter((principle: any) => graphIds.has(principle.id)).map((principle: any) => ({
        ...principle,
        matchScore: Number(principle.matchScore || principle.relevance_score || 0) + 12,
        _graphMatched: true,
      }));
      replyTopPrinciples = sourceBalancedTake(
        deduplicatePrinciples([...replyTopPrinciples, ...graphCandidates], "relevance_score")
          .sort((a: any, b: any) => Number(b.matchScore || 0) - Number(a.matchScore || 0)),
        1,
        8,
      );
    }
    let knowledgeGraphContext = { text: "(Friend knowledge graph not used)", paths: [] as Array<Record<string, unknown>>, nodeByPrinciple: {} as Record<string, string> };
    if (activeThreadType === "friend" && replyTopPrinciples.length > 0) {
      strategyPerformance = await loadStrategyPerformance({
        supabase,
        userId: user.id,
        workspaceId: prospect.workspace_id,
        prospectId,
        prospectSegment: analysisJson.segment || existingFriendProfile?.segment || null,
        funnelStage: friendStageResult.stage,
        objectionType: analysisJson.objection_detected || analysisJson.objection_bucket || null,
        salesBrainIds: replyTopPrinciples.map((principle: any) => principle.id).filter(Boolean),
      });
      replyTopPrinciples = applyOutcomeAwareStrategyRank(replyTopPrinciples, strategyPerformance, {
        funnelStage: analysisJson.stage,
        objectionType: analysisJson.objection_detected || analysisJson.objection_bucket,
        prospectText: `${message}\n${conversationHistory}`,
      }).slice(0, 8);
      replyPrinciplesText = replyTopPrinciples.map((principle: any) => {
        const source = principle.source_id && kbMap[principle.source_id]
          ? kbMap[principle.source_id]
          : principle.source_name;
        const performance = principle._strategyPerformance
          ? ` | verified effectiveness=${principle._strategyPerformance.effectiveness_score}; prior attempts=${principle._strategyPerformance.previous_attempt_count}`
          : " | no verified outcome history yet";
        return `• [${principle.principle_name}] (Source: ${source}${performance}): ${principle.what_i_learned}\n  Apply: ${principle.how_to_apply}`;
      }).join("\n");
      const selectedGraphContext = await loadKnowledgeGraphContext(
        supabase,
        user.id,
        replyTopPrinciples.map((principle: any) => principle.id).filter(Boolean),
      );
      knowledgeGraphContext = {
        text: `${decisionGraphTraversal.text}\n${selectedGraphContext.text}`,
        paths: [...decisionGraphTraversal.paths, ...selectedGraphContext.paths],
        nodeByPrinciple: selectedGraphContext.nodeByPrinciple,
      };
    }

    const friendStageDirective = activeThreadType === "friend"
      ? buildFriendStageDirective(friendStageResult)
      : "Expert mode does not use the Friend journey.";
    const lockedReplyPrinciple = activeThreadType === "friend" ? replyTopPrinciples[0] || null : null;
    const lockedReplySource = lockedReplyPrinciple
      ? (lockedReplyPrinciple.source_id && kbMap[lockedReplyPrinciple.source_id]
        ? kbMap[lockedReplyPrinciple.source_id]
        : lockedReplyPrinciple.source_name || lockedReplyPrinciple.source_type || "unknown")
      : "";
    const lockedReplyPassage = activeThreadType === "friend"
      ? replyTopChunks.find((chunk: any) =>
          chunk.chunk_kind === "source_passage"
          && (!lockedReplyPrinciple?.source_id || chunk.source_id === lockedReplyPrinciple.source_id)
        ) || replyTopChunks.find((chunk: any) => chunk.chunk_kind === "source_passage") || replyTopChunks[0]
      : null;
    const friendKnowledgeContract = activeThreadType === "friend"
      ? buildFriendKnowledgeApplicationContract({
          analysis: analysisJson,
          checkpoint: friendStageResult.checkpoint,
          stage: friendStageResult.stage,
          latestProspectMessage: message,
          principle: lockedReplyPrinciple,
          sourceName: lockedReplySource,
          supportingPassage: lockedReplyPassage?.content || "",
        })
      : null;
    const friendKnowledgeContractText = friendKnowledgeContract
      ? formatFriendKnowledgeApplicationContract(friendKnowledgeContract)
      : "Expert mode does not use a Friend knowledge application contract.";
    const relevantReferenceMoments = activeThreadType === "friend"
      ? selectRelevantConversationPassages(
          approvedConversationExamples,
          appliedRetrievalQuery,
          friendStageResult.stage,
        )
      : "Expert mode does not use Friend reference conversations.";

    // ===== STEP 2: GENERATE STAGE-AWARE REPLIES WITH MULTI-FRAMEWORK =====
    const styleFingerprint = buildStyleFingerprint(workspace?.style_vector);

    // Include training examples in style context
    let trainingContext = "";
    if (trainingExamples && trainingExamples.length > 0) {
      trainingContext = "\n\nTRAINING EXAMPLES (your real voice — match this exactly):\n";
      for (const ex of trainingExamples) {
        trainingContext += `--- "${ex.title}" ---\n${((ex.content as string) || "").substring(0, 3000)}\n`;
        if (ex.style_analysis) {
          const sa = ex.style_analysis as any;
          trainingContext += `[tone=${sa.emotional_tone || "?"}, length=${sa.avg_message_length || "?"}, emoji=${sa.emoji_pattern || "?"}]\n`;
        }
      }
    }

    // Feedback patterns
    let feedbackContext = "";
    if (positiveFeedback && positiveFeedback.length > 0) {
      feedbackContext = "\n\nUSER-APPROVED PATTERNS (matched thumbs up — mimic these):\n" +
        positiveFeedback.slice(0, 5).map((f: any) => `- "${(f.suggestion_text || "").substring(0, 200)}"`).join("\n")
        + "\nLearn only the tone and conversational structure. Never copy a name, result, family detail, objection or personal fact into this prospect's reply.";
    }

    // Lead registry context
    let leadContext = "";
    if (leadEntry) {
      const pastAdvice = Array.isArray(leadEntry.past_advice) ? leadEntry.past_advice : [];
      const recentObjections = pastAdvice
        .filter((a: any) => a.framework?.includes("objection") || a.stage === "objection")
        .slice(-3);
      leadContext = `\n\nLEAD REGISTRY:\nPersona: ${leadEntry.persona_type || "?"}\nPsychological State: ${leadEntry.psychological_state || "?"}\nSubtext: ${leadEntry.subtext_analysis || "none"}\nPast Objections: ${recentObjections.length > 0 ? recentObjections.map((o: any) => o.advice?.substring(0, 80)).join(" | ") : "none"}\n${friendLearningContext}`;
    }

    const styleModifierInstruction = styleModifier
      ? `\n\nSTYLE MODIFIER: Make all variants more ${styleModifier}. Adjust tone accordingly while staying in the correct stage.`
      : "";

    // Build objection-aware instructions
    const objectionInstruction = analysisJson.objection_detected
      ? `\n\nOBJECTION DETECTED: "${analysisJson.objection_detected}"
BUCKET: ${analysisJson.objection_bucket}
RESPONSE TYPE: ${analysisJson.objection_response_type}
${activeThreadType === "friend"
  ? "Acknowledge it naturally. Do not force three techniques or treat a boundary as resistance."
  : `PRIMARY variant MUST use ${analysisJson.objection_response_type} technique. ALTERNATIVE may use a different relevant response type.`}
NEVER argue with the objection. ALWAYS acknowledge first.`
      : "";

    const spinInstruction = `\nSPIN STAGE: ${analysisJson.spin_stage || "situation"}
Use SPIN only as a silent diagnostic. question_needed=${Boolean(analysisJson.question_needed)}. Do not ask a SPIN question unless one answer is genuinely needed for the chosen reply_act.`;

    const modeInstruction = activeThreadType === "expert"
      ? `MODE: EXPERT. Respond as the trusted expert/consultant. Diagnose precisely, give useful clarity, handle the objection directly, and recommend the clearest next step. Do not pretend to be a peer who personally lived every detail.`
      : `MODE: FRIEND. Respond as a warm peer using only the workspace's approved identity, real story and offer truth. Follow Intent -> Logical Certainty -> Emotional Certainty -> Pitch -> Handoff without losing earlier context. At stage=pitch, recap their own context and ask permission before explaining what helped. At stage=handoff, make the concrete approved handoff using LINKED_EXPERT_CONTEXT and the approved referral URL. Never invent an expert, destination, proof, price, purchase or personal result.`;

    const replySystemPrompt = `You are an evidence-grounded DM reply generator for social media sales conversations. Use the user's approved identity, offer truth, verified result evidence and uploaded sales knowledge. Choose the smallest effective technique for the current moment. Never pressure a poor-fit prospect and never present an inference as a fact.

You are given the analysis result (including objection radar and SPIN stage), workspace profile, style fingerprint, conversation history, and brain principles.

${modeInstruction}

Generate exactly 3 reply variants as JSON. Each must sound EXACTLY like the person in WORKSPACE_PROFILE and STYLE_FINGERPRINT. Never sound like AI.

FRAMEWORK SELECTION:
- When the locked knowledge contract says Required=true, its principle is the one primary framework and MUST materially shape every variant.
- When the contract says Required=false, use one primary framework only when it helps the chosen reply_act.
- Add a second technique only when it materially improves the reply.
- Never stack frameworks merely to sound sophisticated.
- A natural peer response may use no formal framework. One message has one objective and at most one optional question.

REPLY-ACT RULES:
- relate: recognize the specific experience and create common ground.
- share_story: share one short approved lived detail because it genuinely helps, not to manufacture authority.
- validate: let the prospect feel understood without immediately probing.
- answer: answer what they asked directly before adding anything.
- observe: name a useful pattern or gap in plain peer language.
- probe: ask one natural question only because the missing answer matters.
- reframe: offer one gentle perspective that protects their autonomy and dignity.
- transition: connect the discussion to what helped, without pitching.
- ask_permission: ask whether they want to hear what helped.
- refer: make the approved expert handoff only after permission or an explicit request.
- stop: acknowledge and end without a question.
Do not turn relate, share_story, validate, answer, observe or reframe into a question merely to keep the conversation moving.
${objectionInstruction}
${spinInstruction}

FRIEND PERSONA + OFFER TRUTH RULES:
- In Friend mode, use only identity, backstory, transformation, stories, product experience, results, expert details, price and URLs explicitly marked approved in WORKSPACE_PROFILE.
- Never invent a purchase, personal experience, income, sales number, testimonial, mentor relationship, price, guarantee or result.
- If no verified result evidence is present, make no numerical performance claim.
- A configured website is not permission to drop a link early. First detect a referral-ready signal, then ask permission, then make the handoff.
- If the offer is not a fit, say so honestly and do not force a referral.
- Automatic profile drafts are never live facts until approved.
- Conversation learnings may improve audience/objection recognition, but they must never overwrite the approved identity, offer facts, story library or forbidden claims.
- Current prospect memory belongs only to this person. Never attribute another prospect's personal fact, result, family detail, desire or objection to them.
- Workspace audience signals are anonymous recurring patterns, not proof about this person. The current conversation always wins.
- If contact_status=do_not_contact, write one brief respectful acknowledgement with no question, persuasion, follow-up promise, offer, link or referral. If contact_status=not_now, do not push an expert; leave the door open calmly.
- In this digital-marketing context, sales may mean first sale, more sales, consistent sales, or scalable sales. Preserve that exact level. Never congratulate one sale as though the prospect has reached consistency, and never assume someone wants help unless their words support it.

TONE: Warm, human, calm, confident, relatable, NOT needy. Like a friend who's been through the same struggle.

=== HUMAN VOICE — NON-NEGOTIABLE (every "message" field) ===
Every variant must read like a real person texting from their phone. Never like AI, never like a marketer, never like a sales coach giving a speech.

HARD BANS inside the "message" field:
- No "I hope this finds you well", "I wanted to reach out", "I came across your", "Just circling back", "Touching base", "Per our", "As per", "Kindly", "Synergy", "Leverage", "Unlock", "Empower", "Game-changer", "Revolutionize", "10x", "Crushing it", "In today's world", "At the end of the day".
- No em-dashes ( — ). Use a period, comma, or line break.
- No semicolons.
- No filler openers: "Listen,", "Look,", "Here's the thing,", "Real talk,", "Honestly,".
- No emoji unless the prospect already used emoji in CONVERSATION_HISTORY.
- No hashtags. No "Cheers,", "Best,", "Warm regards,". No sign-off at all unless the style fingerprint clearly uses one.
- No generic compliments ("Love your content", "Your page is amazing", "Big fan").
- No restating their message back to them ("I totally hear you that…", "It makes complete sense that…").
- No three-sentence uniform cadence. Mix short fragments with one normal sentence. Vary length on purpose.

DO:
- Sound like a smart friend texting. Contractions on. Lowercase where natural. Drop articles where a real texter would.
- Reference one SPECIFIC concrete detail from CONVERSATION_HISTORY or the prospect's latest message. Never generic.
- One clear idea. One question max. Cut every word that does not earn its place.
- Match the length and energy of the prospect's last message.
- "casual" variant should feel like one quick text someone tapped out in 5 seconds.

If a draft sounds like ChatGPT wrote it, rewrite it before returning.


VARIANT RULES:
- All variants perform the SAME reply_act and next objective selected by the analysis.
- Variant 1 (primary): Best natural peer wording, applying the locked principle whenever Required=true.
- Variant 2 (alternative): Different human wording or relatable angle, not a forced discovery question.
- Variant 3 (casual): Shortest natural version. It may omit a framework only when Required=false.

KNOWLEDGE GROUNDING: When a variant uses a retrieved principle, cite its exact principle and source in metadata. Use ONLY names that appear in SALES_BRAIN_PRINCIPLES; never invent.
- When Required=true, every variant must include knowledge_application with the locked principle/source, the actual lesson applied, the strategic move, and message_evidence copied exactly from its own visible message. A label or citation without real application fails validation.
- At logical_certainty, emotional_certainty, or pitch with an active sales gap, the primary variant MUST apply the single strongest retrieved sales principle internally and cite it in metadata. The visible message must still sound like a friend, never a lesson or framework recital.
- When knowledge_need="none" or a simple human response is best, set cited_principle_name and cited_source_name to null. Do not force a framework into the visible message.
- Prefer the most relevant source for each variant. Diversity is secondary to relevance and truth.
- Do NOT keep defaulting to OBJECTION CRUSHER or Go Pro. Pick the principle whose actual lesson best matches the latest prospect message and buyer psychology.
- In why_this_works, state the principle's actual lesson and how you applied it. Never only say "from Source A combined with Source B".
- Final check before returning JSON: every cited source must genuinely support the message and every personal or offer claim must exist in WORKSPACE_PROFILE.

Return JSON only:
{ "variants": [{ "variant": "primary"|"alternative"|"casual", "message": "...", "move_used": "<reply_act>", "principle_applied": "<principle or natural peer response>", "cited_principle_name": "<exact retrieved principle or null>", "cited_source_name": "<exact retrieved source or null>", "knowledge_application": { "principle_name": "<locked principle or null>", "source_name": "<locked source or null>", "lesson_applied": "actual retrieved lesson used", "strategic_move": "how the lesson changes this exact reply", "message_evidence": "exact phrase copied from message" }, "why_this_works": "Why this peer act fits the exact message; mention the retrieved principle only if one was used", "warmth_prediction": <number>, "frameworks_used": [] }] }${styleModifierInstruction}`;

    const replyUserPrompt = `WORKSPACE_PROFILE:
${workspaceProfile}

STYLE_FINGERPRINT:
${styleFingerprint}${trainingContext}${feedbackContext}${leadContext}

LINKED_EXPERT_CONTEXT:
${linkedExpertContext}

SCREENSHOT_VISUAL_CONTEXT:
${screenshotContext || "No screenshot supplied."}

ANALYSIS:
${JSON.stringify(analysisJson)}

${friendStageDirective}

${friendKnowledgeContractText}

CONVERSATION_HISTORY:
${conversationHistory}

LATEST PROSPECT MESSAGE:
${message}

SALES_BRAIN_PRINCIPLES:
${replyPrinciplesText.substring(0, 6500)}

RELEVANT_KNOWLEDGE_CHUNKS:
${replyChunksText.substring(0, 6500)}

TYPED_SALES_KNOWLEDGE_GRAPH:
${knowledgeGraphContext.text.substring(0, 6500)}

DECISION_AWARE_RETRIEVAL_QUERY:
${appliedRetrievalQuery.substring(0, 3600)}

RELEVANT_APPROVED_REFERENCE_MOMENTS_FOR_THIS_EXACT_STAGE:
${relevantReferenceMoments}

WORKSPACE_LEARNED_INSIGHTS:
${learnedInsightsText.substring(0, 2500)}

FRIEND_LEARNING_CONTEXT:
${friendLearningContext.substring(0, 5000)}

FACT_AND_PREVIOUS_STRATEGY_LEDGER:
${prospectDecisionHistory.substring(0, 6500)}

VERIFIED_WINNING_PATTERNS:
${winningPatternsText.substring(0, 2000)}`;

    let replyJson: any = { variants: [] };
    let replyGenerationFailure = "";
    try {
      const replyResponse = await userChat(chat, {
        model: chat.models.balanced,
        messages: [
          { role: "system", content: replySystemPrompt },
          { role: "user", content: replyUserPrompt },
        ],
        temperature: 0.7,
        // The grounded Friend prompt contains the prospect ledger, workspace
        // profile, source evidence, graph path and reference moments. Twenty
        // two seconds was causing valid Gemini generations to be aborted and
        // replaced by a generic deterministic question.
        timeout_ms: 40000,
      });
      if (!replyResponse.ok) throw new Error(`Reply AI error: ${replyResponse.status}`);
      const replyData = await replyResponse.json();
      const replyRaw = replyData.choices?.[0]?.message?.content || "";
      if (!replyRaw.trim()) throw new Error("Reply AI returned no usable content");
      const match = replyRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidate = (match ? match[1] : replyRaw).trim();
      try {
        replyJson = JSON.parse(candidate);
      } catch {
        const objMatch = candidate.match(/\{[\s\S]*\}/);
        replyJson = JSON.parse(objMatch ? objMatch[0] : "{}");
      }
      if (!Array.isArray(replyJson.variants) || replyJson.variants.length === 0) {
        throw new Error("Reply generator returned no Friend variants");
      }
    } catch (replyError) {
      if (activeThreadType !== "friend") throw replyError;
      const primaryFailure = replyError instanceof Error ? replyError.message : "Friend reply generation failed";
      try {
        const compactFacts = JSON.stringify({
          latest_prospect_message: message,
          stage: friendStageResult.stage,
          checkpoint: friendStageResult.checkpoint,
          prospect_profile: analysisJson?.prospect_profile || {},
          evidence: Array.isArray(analysisJson?.evidence) ? analysisJson.evidence.slice(-6) : [],
          workspace_offer: workspace?.offer_truth || workspace?.products_detected || workspace?.expert_description || "",
          selected_principle: lockedReplyPrinciple?.principle_name || "",
          selected_source: lockedReplySource || lockedReplyPrinciple?.source_name || "",
          selected_lesson: lockedReplyPrinciple?.what_i_learned || lockedReplyPrinciple?.how_to_apply || "",
          recent_turns: speakerMessages.slice(-8),
        });
        const recoveryResponse = await userChat(chat, {
          model: chat.models.fast,
          messages: [
            { role: "system", content: "You write the next message in a genuine peer-to-peer Friend conversation. Return ONLY valid JSON: {\"variants\":[{\"variant\":\"primary\",\"message\":\"...\",\"why_this_works\":\"...\"},{\"variant\":\"alternative\",\"message\":\"...\",\"why_this_works\":\"...\"},{\"variant\":\"casual\",\"message\":\"...\",\"why_this_works\":\"...\"}]}. Use the known facts and selected source lesson. Do not invent results, pressure, sell, or ask more than one question per variant. Keep each message short, warm, distinct, and focused on the stated checkpoint." },
            { role: "user", content: compactFacts },
          ],
          temperature: 0.45,
          response_format: { type: "json_object" },
          timeout_ms: 30000,
        });
        if (!recoveryResponse.ok) throw new Error(`Compact Friend recovery failed: ${recoveryResponse.status}`);
        const recoveryData = await recoveryResponse.json();
        const recoveryContent = recoveryData.choices?.[0]?.message?.content || "";
        const recoveryMatch = recoveryContent.match(/\{[\s\S]*\}/);
        const recoveryParsed = JSON.parse(recoveryMatch ? recoveryMatch[0] : recoveryContent);
        if (!Array.isArray(recoveryParsed.variants) || recoveryParsed.variants.length !== 3) {
          throw new Error("Compact Friend recovery returned an incomplete variant set");
        }
        replyJson = { ...replyJson, ...recoveryParsed };
        console.warn("[generate-reply] Full Friend generation recovered with compact grounded prompt:", primaryFailure);
      } catch (recoveryError) {
        replyGenerationFailure = `${primaryFailure}; ${recoveryError instanceof Error ? recoveryError.message : "Compact Friend recovery failed"}`;
        console.warn("[generate-reply] Friend generation and compact recovery failed", replyGenerationFailure);
      }
    }

    // Friend replies must pass a second, low-temperature conversion-quality
    // review before they can reach the UI. The validator repairs drift while
    // preserving the locked stage, objective, approved truth and metadata.
    if (activeThreadType === "friend") {
      const originalVariants = (Array.isArray(replyJson.variants) ? replyJson.variants : [])
        .map((variant: any) => hydrateFriendKnowledgeApplication(variant, friendKnowledgeContract));
      const deterministicIssues = originalVariants.flatMap((variant: any, index: number) =>
        deterministicFriendQualityIssues(variant?.message || "", friendStageResult.stage, analysisJson, history, variant, friendKnowledgeContract)
          .map((issue) => `variant ${index + 1}: ${issue}`)
      );
      let repairedVariants: any[] = [];
      let validationFailure = replyGenerationFailure;
      try {
        if (validationFailure) throw new Error(validationFailure);
        if (originalVariants.length === 0) throw new Error("Reply generator returned no Friend variants");
        const qualityResponse = await userChat(chat, {
          model: chat.models.fast,
          messages: [
            { role: "system", content: buildFriendQualityValidatorPrompt("variants") },
            {
              role: "user",
              content: `${friendStageDirective}\n\n${friendKnowledgeContractText}\n\nLOCKED ANALYSIS:\n${JSON.stringify(analysisJson)}\n\nLATEST PROSPECT MESSAGE:\n${message}\n\nRECENT CONVERSATION:\n${keepHeadAndLatest(conversationHistory, 10000, 1800)}\n\nFACT AND PREVIOUS STRATEGY LEDGER:\n${prospectDecisionHistory.substring(0, 5000)}\n\nRELEVANT REFERENCE MOMENTS:\n${relevantReferenceMoments}\n\nRETRIEVED KNOWLEDGE:\n${replyPrinciplesText.substring(0, 4500)}\n${replyChunksText.substring(0, 4500)}\n\nKNOWLEDGE GRAPH:\n${knowledgeGraphContext.text.substring(0, 3500)}\n\nDETERMINISTIC PRECHECK ISSUES:\n${deterministicIssues.join("\n") || "none"}\n\nDRAFT VARIANTS TO VALIDATE AND REPAIR:\n${JSON.stringify(originalVariants)}`,
            },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
          timeout_ms: 18000,
        });
        if (!qualityResponse.ok) throw new Error(`Friend quality validation failed: ${qualityResponse.status}`);
        const qualityData = await qualityResponse.json();
        const qualityRaw = qualityData.choices?.[0]?.message?.content || "{}";
        const qualityMatch = qualityRaw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const qualityJson = JSON.parse((qualityMatch ? qualityMatch[1] : qualityRaw).trim());
        repairedVariants = (Array.isArray(qualityJson.variants) ? qualityJson.variants : [])
          .map((variant: any) => hydrateFriendKnowledgeApplication(variant, friendKnowledgeContract));
        if (repairedVariants.length !== originalVariants.length) throw new Error("Friend quality validator returned an incomplete variant set");
        const remainingIssues = repairedVariants.flatMap((variant: any, index: number) =>
          deterministicFriendQualityIssues(variant?.message || "", friendStageResult.stage, analysisJson, history, variant, friendKnowledgeContract)
            .map((issue) => `variant ${index + 1}: ${issue}`)
        );
        if (remainingIssues.length > 0) validationFailure = `Friend quality validator rejected the reply: ${remainingIssues.join("; ")}`;
      } catch (qualityError) {
        validationFailure = qualityError instanceof Error ? qualityError.message : "Friend quality validation failed";
      }

      // A validator outage or metadata-only omission must not erase an
      // otherwise safe, source-grounded primary generation. Prefer the
      // validator's repaired prose when it is complete, otherwise retain the
      // original hydrated variants and use the deterministic fallback only if
      // neither candidate set passes the non-negotiable local checks.
      let candidateVariants = repairedVariants.length === originalVariants.length && repairedVariants.length > 0
        ? repairedVariants
        : originalVariants;
      let candidateIssues = candidateVariants.flatMap((variant: any, index: number) =>
        deterministicFriendQualityIssues(variant?.message || "", friendStageResult.stage, analysisJson, history, variant, friendKnowledgeContract)
          .map((issue) => `variant ${index + 1}: ${issue}`)
      );
      if (candidateIssues.length > 0 && originalVariants.length === 3) {
        try {
          const repairResponse = await userChat(chat, {
            model: chat.models.fast,
            messages: [
              { role: "system", content: "Return ONLY valid JSON with exactly three objects in variants. Rewrite each Friend reply so it is short, natural, grounded in the stated prospect fact, applies the selected lesson, asks at most one question, and does not repeat a previous question. Do not add claims, pressure, or a pitch." },
              { role: "user", content: JSON.stringify({ stage: friendStageResult.stage, checkpoint: friendStageResult.checkpoint, prospect_fact: friendKnowledgeContract?.prospectFact, selected_principle: friendKnowledgeContract?.principleName, selected_source: friendKnowledgeContract?.sourceName, selected_lesson: friendKnowledgeContract?.lesson || friendKnowledgeContract?.howToApply, latest_message: message, issues: candidateIssues, drafts: candidateVariants }) },
            ],
            temperature: 0.25,
            response_format: { type: "json_object" },
            timeout_ms: 30000,
          });
          if (!repairResponse.ok) throw new Error(`Compact Friend repair failed: ${repairResponse.status}`);
          const repairData = await repairResponse.json();
          const repairContent = repairData.choices?.[0]?.message?.content || "";
          const repairMatch = repairContent.match(/\{[\s\S]*\}/);
          const repairJson = JSON.parse(repairMatch ? repairMatch[0] : repairContent);
          const repaired = (Array.isArray(repairJson.variants) ? repairJson.variants : [])
            .map((variant: any) => hydrateFriendKnowledgeApplication(variant, friendKnowledgeContract));
          if (repaired.length !== 3) throw new Error("Compact Friend repair returned an incomplete variant set");
          const repairIssues = repaired.flatMap((variant: any, index: number) =>
            deterministicFriendQualityIssues(variant?.message || "", friendStageResult.stage, analysisJson, history, variant, friendKnowledgeContract)
              .map((issue) => `variant ${index + 1}: ${issue}`)
          );
          if (repairIssues.length === 0) {
            candidateVariants = repaired;
            candidateIssues = [];
            console.warn("[generate-reply] Repaired Friend reply locally after validator issues");
          }
        } catch (repairError) {
          console.warn("[generate-reply] Compact Friend repair unavailable:", repairError instanceof Error ? repairError.message : repairError);
        }
      }
      const useDeterministicFallback = candidateVariants.length !== 3 || candidateIssues.length > 0;
      if (useDeterministicFallback) {
        const fallbackMessages = buildDeterministicFriendFallbackMessages(
          repairedVariants.length > 0 ? repairedVariants : originalVariants,
          friendStageResult.stage,
          friendStageResult.checkpoint,
          analysisJson,
          message,
          history,
          friendKnowledgeContract,
        );
        repairedVariants = fallbackMessages.map((fallbackMessage, index) => ({
          ...(originalVariants[index] || {
            variant: index === 0 ? "primary" : index === 1 ? "alternative" : "casual",
            move_used: analysisJson.reply_act || "probe",
            principle_applied: "evidence-gated certainty funnel",
            why_this_works: "Continues from the earliest unverified checkpoint without inventing facts.",
            warmth_prediction: analysisJson.warmth_score,
          }),
          message: fallbackMessage,
          cited_principle_name: null,
          cited_source_name: null,
          knowledge_application: null,
          principle_applied: "knowledge-aware deterministic fallback",
          why_this_works: "Uses the verified prospect facts and earliest missing checkpoint without falsely claiming that an AI-selected source lesson was applied.",
        }));
        console.warn("generate-reply used deterministic Friend fallback:", validationFailure || candidateIssues.join("; "));
      } else {
        repairedVariants = candidateVariants;
        if (validationFailure) {
          console.warn("generate-reply kept a locally valid grounded Friend reply after validator failure:", validationFailure);
        }
      }

      replyJson.variants = repairedVariants.map((variant: any, index: number) => ({
        ...originalVariants[index],
        ...variant,
      }));
      replyJson.qualityValidation = {
        passed: true,
        repaired: JSON.stringify(repairedVariants) !== JSON.stringify(originalVariants),
        fallbackApplied: useDeterministicFallback,
        fallbackReason: useDeterministicFallback ? (validationFailure || candidateIssues.join("; ")) : null,
        validatorBypassed: !useDeterministicFallback && Boolean(validationFailure),
      };
    }

    const structuredFriendProfile = activeThreadType === "friend"
      ? buildFriendProspectProfile(analysisJson, existingFriendProfile)
      : null;
    if (structuredFriendProfile) analysisJson.prospectType = structuredFriendProfile.segment;
    if (structuredFriendProfile?.contact_status === "do_not_contact") {
      replyJson.variants = [
        { variant: "primary", message: "I understand. I won't message you again.", move_used: "respect_boundary", principle_applied: "consent", why_this_works: "Respects the prospect's explicit boundary.", warmth_prediction: 0 },
        { variant: "alternative", message: "Understood. I'll leave it there.", move_used: "respect_boundary", principle_applied: "consent", why_this_works: "Ends the outreach without reopening the conversation.", warmth_prediction: 0 },
        { variant: "casual", message: "Got it. Take care.", move_used: "respect_boundary", principle_applied: "consent", why_this_works: "Acknowledges the request briefly and applies no pressure.", warmth_prediction: 0 },
      ];
    }
    if (structuredFriendProfile) {
      const latestInbound = [...speakerMessages].reverse().find((item: any) => item.direction === "inbound");
      await persistProspectFactLedger({
        supabase,
        userId: user.id,
        workspaceId: prospect.workspace_id,
        prospectId,
        threadType: activeThreadType,
        profile: structuredFriendProfile,
        sourceMessageId: latestInbound?.id || null,
        sourceDirection: "inbound",
        sourceMessages: speakerMessages,
      });
    }

    // ===== SIDE EFFECTS: Analytics, Learning, Lead Registry =====
    const detectedTone = analysisJson.detectedTone || "neutral";
    const detectedProspectType = analysisJson.prospectType || "unknown";
    const detectedPattern = analysisJson.stage || "general";

    // Save tone to latest inbound message
    if (detectedTone !== "neutral") {
      const latestInbound = history.filter((m: any) => m.direction === "inbound").pop();
      if (latestInbound) {
        supabase.from("chat_messages").update({ detected_tone: detectedTone }).eq("id", latestInbound.id).then(() => {});
      }
    }

    // Update conversation analytics
    const { data: existingAnalytics } = await supabase.from("conversation_analytics").select("*").eq("user_id", user.id).eq("prospect_id", prospectId).maybeSingle();
    if (existingAnalytics) {
      const patterns = existingAnalytics.questioning_patterns_used || [];
      if (!patterns.includes(detectedPattern)) patterns.push(detectedPattern);
      const tones = existingAnalytics.tone_progression || [];
      if (detectedTone) tones.push(detectedTone);
      supabase.from("conversation_analytics").update({
        questioning_patterns_used: patterns, tone_progression: tones,
        messages_count: (existingAnalytics.messages_count || 0) + 1,
      }).eq("id", existingAnalytics.id).then(() => {});
    } else {
      supabase.from("conversation_analytics").insert({
        user_id: user.id, prospect_id: prospectId, workspace_id: prospect.workspace_id,
        questioning_patterns_used: [detectedPattern], tone_progression: detectedTone ? [detectedTone] : [],
        messages_count: 1, ai_suggestions_used: 0, outcome: prospect.outcome || "active",
      }).then(() => {});
    }

    // Persist the same canonical stage the UI displays. This is evidence-gated,
    // not warmth- or message-count-driven.
    const newDbStage = activeThreadType === "friend"
      ? friendStageToDatabase(friendStageResult.stage)
      : prospect.conversation_stage;
    if (newDbStage !== prospect.conversation_stage) {
      supabase.from("prospects").update({ conversation_stage: newDbStage }).eq("id", prospectId).then(() => {});
    }

    // Save conversation summary every 10 messages
    if (speakerMessages.length > 0 && speakerMessages.length % 10 === 0) {
      const summaryLines = history.slice(-10).map((m: any) => `${m.direction === "outbound" ? "Y" : m.direction === "context" ? "NOTE" : m.direction === "unknown" ? "UNKNOWN" : "P"}: ${m.content.substring(0, 80)}`);
      const summary = `${prospect.name} (${speakerMessages.length} msgs). Stage: ${analysisJson.stage}. Warmth: ${analysisJson.warmth_score}. ${summaryLines.slice(-3).join(" | ")}`;
      supabase.from("prospects").update({ conversation_summary: summary }).eq("id", prospectId).then(() => {});
    }

    // Save observational insight only. Generated suggestions are not proven
    // winners and must not be written back as "BEST REPLY" training data until
    // the user gives positive feedback or records a conversion.
    const learningResult: any = null;
    if (message) {
      await supabase.from("learned_insights").insert({
        user_id: user.id, workspace_id: prospect.workspace_id, prospect_id: prospectId,
        insight_type: "conversation",
        insight: `${prospect.name}: Type=${detectedProspectType}, Tone=${detectedTone}, Stage=${analysisJson.stage}, Warmth=${analysisJson.warmth_score}, Move=${analysisJson.recommended_move}`,
        source: `Chat with ${prospect.name}`,
      });

    }

    // Every Friend analysis updates a structured memory for this prospect.
    // Only aggregate taxonomy signals cross conversations; never copy personal
    // evidence or generated reply text into another person's memory.
    // Lead registry update
    if (message) {
      const adviceEntry = { date: new Date().toISOString(), stage: analysisJson.stage, warmth: analysisJson.warmth_score, move: analysisJson.recommended_move, advice: (replyJson.variants?.[0]?.message || "").substring(0, 300) };
      if (leadEntry) {
        const pastAdvice = Array.isArray(leadEntry.past_advice) ? leadEntry.past_advice : [];
        pastAdvice.push(adviceEntry);
        await supabase.from("lead_registry").update({
          psychological_state: analysisJson.prospect_psychology || leadEntry.psychological_state,
          persona_type: detectedProspectType !== "unknown" ? detectedProspectType : leadEntry.persona_type,
          subtext_analysis: analysisJson.stage_reason || leadEntry.subtext_analysis,
          past_advice: pastAdvice.slice(-20),
          ...(structuredFriendProfile ? {
            prospect_profile: structuredFriendProfile,
            contact_status: structuredFriendProfile.contact_status,
            last_observed_at: new Date().toISOString(),
          } : {}),
        }).eq("id", leadEntry.id);
      } else {
        await supabase.from("lead_registry").insert({
          user_id: user.id, workspace_id: prospect.workspace_id, prospect_id: prospectId,
          name: prospect.name, persona_type: detectedProspectType,
          psychological_state: analysisJson.prospect_psychology || "unknown",
          subtext_analysis: analysisJson.stage_reason || null,
          past_advice: [adviceEntry], upload_matches: [],
          ...(structuredFriendProfile ? {
            prospect_profile: structuredFriendProfile,
            contact_status: structuredFriendProfile.contact_status,
            last_observed_at: new Date().toISOString(),
          } : {}),
        });
      }
      if (structuredFriendProfile) {
        const { error: signalError } = await supabase.rpc("record_friend_learning_signals", {
          p_user_id: user.id,
          p_workspace_id: prospect.workspace_id,
          p_profile: analysisJson,
          p_metric: "observation",
          p_prospect_id: prospectId,
        });
        if (signalError) console.warn("[generate-reply] could not record Friend audience signals", signalError);
      }
    }

    // ===== BUILD RESPONSE =====
    // Map variants to the existing suggestion format for backward compatibility
    const suggestions = (replyJson.variants || []).map((v: any, i: number) => ({
      id: i + 1,
      type: v.variant || (i === 0 ? "primary" : i === 1 ? "alternative" : "softer"),
      text: v.message || "",
      whyThisWorks: v.why_this_works || "",
      frameworkUsed: `${v.move_used || ""} | ${v.principle_applied || ""}`,
      warmthPrediction: v.warmth_prediction,
      citedPrincipleName: v.cited_principle_name || null,
      citedSourceName: v.cited_source_name || null,
      knowledgeApplication: v.knowledge_application || v.knowledgeApplication || null,
    }));

    let decisionTrace: { decisionId: string | null; attemptIds: string[] } = { decisionId: null, attemptIds: [] };
    if (activeThreadType === "friend") {
      const latestInbound = [...speakerMessages].reverse().find((item: any) => item.direction === "inbound");
      decisionTrace = await persistSalesDecision({
        supabase,
        userId: user.id,
        workspaceId: prospect.workspace_id,
        prospectId,
        threadType: activeThreadType,
        inputMessageId: latestInbound?.id || null,
        inputText: message,
        analysis: analysisJson,
        selectedPrinciple: lockedReplyPrinciple,
        selectedKnowledgeNodeId: lockedReplyPrinciple?.id
          ? knowledgeGraphContext.nodeByPrinciple[lockedReplyPrinciple.id] || null
          : null,
        graphPath: knowledgeGraphContext.paths,
        scoreBreakdown: {
          retrieval_query: appliedRetrievalQuery,
          outcome_performance: strategyPerformance,
          knowledge_contract_required: friendKnowledgeContract?.required || false,
        },
        modelProvider: chat.provider,
        modelName: chat.models.balanced,
        workspaceOffer: JSON.stringify(
          workspace?.offer_truth || workspace?.products_detected || workspace?.expert_description || workspace?.store_url || "",
        ).slice(0, 1500),
        generationStatus: replyJson.qualityValidation?.fallbackApplied ? "fallback" : "generated",
        variants: replyJson.variants || [],
      });
      suggestions.forEach((suggestion: any, index: number) => {
        suggestion.decisionId = decisionTrace.decisionId;
        suggestion.strategyAttemptId = decisionTrace.attemptIds[index] || null;
      });
    }

    const sourceTypes = new Set<string>();
    replyTopChunks.forEach((c: any) => sourceTypes.add(c.source_type || "unknown"));
    replyTopPrinciples.forEach((p: any) => sourceTypes.add(p.source_type || "unknown"));

    return new Response(JSON.stringify({
      suggestions,
      analysis: analysisJson,
      conversationStage: newDbStage,
      prospectType: detectedProspectType,
      prospectLearning: structuredFriendProfile,
      friendJourney: activeThreadType === "friend" ? friendStageResult : null,
      qualityValidation: replyJson.qualityValidation || null,
      knowledgeApplicationContract: friendKnowledgeContract ? {
        requested: friendKnowledgeContract.requested,
        required: friendKnowledgeContract.required,
        available: friendKnowledgeContract.available,
        checkpoint: friendKnowledgeContract.checkpoint,
        principleName: friendKnowledgeContract.principleName || null,
        sourceName: friendKnowledgeContract.sourceName || null,
      } : null,
      learningResult,
      decisionTrace,
      brainRetrieval: {
        chunksRetrieved: replyTopChunks.length,
        uniqueSources: new Set([...replyTopChunks.map((c: any) => c.source_id)].filter(Boolean)).size,
        sources: Array.from(sourceTypes),
        insightsRetrieved: brainInsights?.length || 0,
        retrievalPhase: activeThreadType === "friend" ? "analysis_then_decision_search" : "message_search",
        graphPathsRetrieved: knowledgeGraphContext.paths.length,
        outcomeRankedStrategies: strategyPerformance.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("generate-reply error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
