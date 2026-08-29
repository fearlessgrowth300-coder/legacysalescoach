export function isAllowedBrainChatOrigin(origin: string, configuredOrigins: string[] = []): boolean {
  return origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.endsWith(".vercel.app") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://[::1]:") ||
    configuredOrigins.includes(origin);
}

export function isSimpleBrainChatSmallTalk(text: string, hasImage = false): boolean {
  if (hasImage) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 80) return false;
  return /^(?:hi|hii+|hello|hey|hey there|hello there|good morning|good afternoon|good evening|how are you|how's it going|whats up|what's up|thanks|thank you|okay|ok)$/.test(normalized);
}

export function simpleBrainChatResponse(text: string): string {
  const normalized = text.toLowerCase();
  if (/thank/.test(normalized)) return "You’re welcome. What would you like help with next?";
  if (/how are you|how's it going|what'?s up/.test(normalized)) {
    return "I’m ready to help. What are we working on today?";
  }
  if (/^(?:ok|okay)\b/.test(normalized.trim())) return "Got it. What would you like to do next?";
  return "Hey! What would you like help with today? You can ask a sales question, paste a buyer conversation, or upload a screenshot.";
}

export type BrainChatIntent =
  | "knowledge_qa"
  | "source_summary"
  | "source_comparison"
  | "copywriting"
  | "conversation_coaching"
  | "business_planning";

export function classifyBrainChatIntent(text: string, hasImage = false): BrainChatIntent {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (hasImage) return "conversation_coaching";
  if (/\b(?:compare|comparison|difference between|versus|\bvs\.?\b|which (?:book|video|framework|method))\b/.test(value)) {
    return "source_comparison";
  }
  if (/\b(?:summari[sz]e|summary of|key lessons|main lessons|what does (?:the|this) (?:book|pdf|video)|teach me (?:the|this) (?:book|pdf|video))\b/.test(value)) {
    return "source_summary";
  }
  if (/\b(?:write|rewrite|draft|create)\b.*\b(?:caption|email|post|script|landing page|headline|hook|copy)\b/.test(value)) {
    return "copywriting";
  }
  if (/\b(?:build|create|plan|design|improve|fix|audit|launch|outline)\b.*\b(?:offer|product|funnel|strategy|business|content calendar|marketing plan|sales process|campaign|roadmap)\b/.test(value)) {
    return "business_planning";
  }
  if (/\b(?:what should i reply|what do i say|reply to (?:her|him|them)|message should i send|(?:my|this|the) (?:prospect|buyer|lead|client)|(?:she|he|they) (?:said|replied|asked|told me)|pasted conversation|conversation below|dm conversation|ghosted me|close this prospect)\b/.test(value)) {
    return "conversation_coaching";
  }
  return "knowledge_qa";
}

export function responseMentionsUnknownSources(content: string, allowedTitles: string[]): string[] {
  const allowed = new Set(allowedTitles.map((title) => title.trim().toLowerCase()).filter(Boolean));
  const found = [...String(content || "").matchAll(/\(Source:\s*["“]([^"”]+)["”](?:,\s*Chapter\s+[^)]+)?\)/gi)]
    .map((match) => match[1].trim())
    .filter((title) => title && !allowed.has(title.toLowerCase()));
  return [...new Set(found)];
}

export function buildBrainRetrievalMeta(pipeline: any) {
  const retrievedItems = [
    ...(pipeline.selected || []),
    ...(pipeline.evidence_principles || []),
    ...(pipeline.supporting_chunks || []),
  ];
  const uniqueRetrievedItems = new Set(
    retrievedItems.map((item: any, index: number) =>
      String(item.id || item.chunk_id || `${item.source_title || item.source_name || "unknown"}:${item.principle_name || index}`),
    ),
  );
  const sourceTitles = [...new Set([
    ...(pipeline.selected || []).map((item: any) => item.source_title),
    ...(pipeline.evidence_principles || []).map((item: any) => item.source_title || item.source_name),
    ...(pipeline.supporting_chunks || []).map((item: any) => item.source_title),
  ].filter((title): title is string => typeof title === "string" && title.trim().length > 0))];

  return {
    // Kept as `chunksRetrieved` for API compatibility. It now represents every
    // unique retrieved knowledge item (principles, evidence, and raw passages)
    // so the UI does not report zero after principles were actually applied.
    chunksRetrieved: uniqueRetrievedItems.size,
    uniqueSources: sourceTitles.length,
    sources: sourceTitles.slice(0, 12),
    semanticMatches: (pipeline.debug?.semantic_principles_count || 0) + (pipeline.supporting_chunks || []).length,
    staticMatches: pipeline.debug?.static_principles_count || 0,
    dedupSavings: Math.max(0, (pipeline.debug?.candidate_count || 0) - (pipeline.debug?.reranked_count || 0)),
    embeddingUsed: !!pipeline.debug?.embedding_used,
  };
}
