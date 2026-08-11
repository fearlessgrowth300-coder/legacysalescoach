export function isAllowedBrainChatOrigin(origin: string, configuredOrigins: string[] = []): boolean {
  return origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
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

export function buildBrainRetrievalMeta(pipeline: any) {
  const sourceTitles = [...new Set([
    ...(pipeline.selected || []).map((item: any) => item.source_title),
    ...(pipeline.supporting_chunks || []).map((item: any) => item.source_title),
  ].filter((title): title is string => typeof title === "string" && title.trim().length > 0))];

  return {
    chunksRetrieved: (pipeline.supporting_chunks || []).length,
    uniqueSources: sourceTitles.length,
    sources: sourceTitles.slice(0, 12),
    semanticMatches: (pipeline.debug?.semantic_principles_count || 0) + (pipeline.supporting_chunks || []).length,
    staticMatches: pipeline.debug?.static_principles_count || 0,
    dedupSavings: Math.max(0, (pipeline.debug?.candidate_count || 0) - (pipeline.debug?.reranked_count || 0)),
    embeddingUsed: !!pipeline.debug?.embedding_used,
  };
}
