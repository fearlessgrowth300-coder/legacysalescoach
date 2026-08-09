export function isAllowedBrainChatOrigin(origin: string, configuredOrigins: string[] = []): boolean {
  return origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://[::1]:") ||
    configuredOrigins.includes(origin);
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
