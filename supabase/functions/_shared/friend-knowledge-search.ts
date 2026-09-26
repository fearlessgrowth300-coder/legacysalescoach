// Full-vault keyword search complements vector retrieval. Unlike the small
// relevance-ordered static reservoir, it can find passages in any uploaded
// book, PDF, or transcript, including rows that have not been embedded yet.
const ALLOWED_SOURCE_TYPES = new Set(["core_knowledge", "sales_principle", "content", "video", "pdf"]);
const SEARCH_STOP_WORDS = new Set([
  "about", "again", "already", "because", "conversation", "current", "friend", "have",
  "latest", "message", "need", "prospect", "really", "reply", "should", "their",
  "there", "these", "they", "this", "unknown", "what", "when", "where", "which",
  "with", "would", "your", "youre", "from", "that", "them", "then", "just", "want",
]);

export interface FriendLexicalKnowledge {
  principles: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
  query: string;
}

export interface FriendKnowledgePassage {
  id?: string;
  source_id?: string | null;
  chunk_kind?: string | null;
  content?: string | null;
}

export function selectFriendSourcePassage(
  chunks: FriendKnowledgePassage[],
  sourceId: string | null | undefined,
): FriendKnowledgePassage | null {
  if (!sourceId) return null;
  const sourceChunks = chunks.filter((chunk) => chunk.source_id === sourceId);
  return sourceChunks.find((chunk) => chunk.chunk_kind === "source_passage")
    || sourceChunks[0]
    || null;
}

export async function loadFriendSupportingPassage(
  supabase: any,
  userId: string,
  principle: { id?: string; source_id?: string | null } | null | undefined,
  chunks: FriendKnowledgePassage[],
): Promise<string> {
  if (!principle?.source_id) return "";
  // Follow the exact principle-to-evidence link first. An unrelated top-ranked
  // passage must never be presented as evidence for the selected lesson.
  if (principle.id) {
    try {
      const { data: links, error } = await supabase.from("knowledge_evidence_links")
        .select("knowledge_chunk_id, source_id")
        .eq("user_id", userId)
        .eq("sales_brain_id", principle.id)
        .eq("supports_or_contradicts", "supports")
        .order("extraction_confidence", { ascending: false })
        .limit(5);
      if (!error) {
        for (const link of links || []) {
          if ((link.source_id && link.source_id !== principle.source_id) || !link.knowledge_chunk_id) continue;
          const { data: passage } = await supabase.from("knowledge_chunks")
            .select("content, source_id, chunk_kind")
            .eq("id", link.knowledge_chunk_id)
            .eq("user_id", userId)
            .maybeSingle();
          if (passage?.source_id === principle.source_id && passage.chunk_kind === "source_passage") {
            return String(passage.content || "");
          }
        }
      }
    } catch (error) {
      console.warn("[friend-knowledge-search] linked evidence unavailable", error);
    }
  }
  return String(selectFriendSourcePassage(chunks, principle.source_id)?.content || "");
}

export function buildFriendLexicalQuery(
  latestMessage: string,
  analysis: Record<string, unknown> | null | undefined,
): string {
  const focused = [
    analysis?.knowledge_need,
    analysis?.exact_unresolved_issue,
    analysis?.objection_detected,
    analysis?.problem_gap,
    latestMessage,
  ].filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const part of focused) {
    for (const match of part.toLowerCase().matchAll(/[a-z0-9]{3,}/g)) {
      const term = match[0];
      if (SEARCH_STOP_WORDS.has(term) || seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
      if (terms.length === 8) return terms.join(" OR ");
    }
  }
  return terms.join(" OR ");
}

export async function retrieveFriendLexicalKnowledge(
  supabase: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }> },
  userId: string,
  brainType: string,
  kbModeMap: Record<string, string>,
  latestMessage: string,
  analysis?: Record<string, unknown> | null,
): Promise<FriendLexicalKnowledge> {
  const query = buildFriendLexicalQuery(latestMessage, analysis);
  const result: FriendLexicalKnowledge = { principles: [], chunks: [], query };
  if (!query) return result;
  try {
    const { data, error } = await supabase.rpc("search_sales_knowledge", {
      search_query: query,
      p_user_id: userId,
      match_count: 150,
    });
    if (error) {
      console.warn("[friend-knowledge-search] lexical search unavailable", error);
      return result;
    }
    for (const hit of Array.isArray(data) ? data : []) {
      if (!hit || (hit.kind !== "principle" && hit.kind !== "passage")) continue;
      const record = hit.record as Record<string, unknown> | null;
      if (!record || typeof record !== "object" || !ALLOWED_SOURCE_TYPES.has(String(record.source_type || ""))) continue;
      if (record.workspace_id != null) continue;
      const sourceMode = record.source_id ? kbModeMap[String(record.source_id)] : undefined;
      const mode = sourceMode || record.brain_type || "both";
      if (mode !== "both" && mode !== brainType) continue;
      const candidate = { ...record, _lexical: true, lexical_rank: Number(hit.rank || 0) };
      if (hit.kind === "principle") result.principles.push(candidate);
      else result.chunks.push(candidate);
    }
  } catch (error) {
    console.warn("[friend-knowledge-search] lexical search failed", error);
  }
  return result;
}
