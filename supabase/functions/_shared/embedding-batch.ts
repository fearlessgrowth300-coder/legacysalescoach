import { coerceEmbeddingDimensions } from "./embedding-vector.ts";
import type { UserEmbedTarget } from "./user-ai.ts";

// Self-hosted EmbeddingGemma-300M (llama.cpp on the VPS, OpenAI-compatible).
// When LOCAL_EMBED_URL is set, EVERY embedding — stored rows and search queries —
// goes there regardless of the user's chat key, so all vectors share one space.
// (Mixing OpenAI + Gemini vectors made semantic search return noise.)
export const LOCAL_EMBED_MODEL = "embeddinggemma-300m";
export function localEmbedTarget(): UserEmbedTarget | null {
  const url = Deno.env.get("LOCAL_EMBED_URL");
  if (!url) return null;
  return {
    provider: "local",
    url,
    headers: { Authorization: `Bearer ${Deno.env.get("LOCAL_EMBED_TOKEN") || ""}`, "Content-Type": "application/json" },
    model: LOCAL_EMBED_MODEL,
    dimensions: 768,
  };
}

// metadata.embedding_model for rows embedded now, so Repair Search (reindex)
// skips them. Same format backfill-embeddings writes. Only known for local.
export function embeddingModelTag(): string | null {
  return localEmbedTarget() ? `local:${LOCAL_EMBED_MODEL}:768` : null;
}

// Batch requests reduce quota consumption during resumable indexing. Keep row
// positions stable and reject malformed vectors instead of silently saving them.
// `kind` picks EmbeddingGemma's retrieval prompt: stored text is a "document",
// what the user asks is a "query". Other providers ignore it.
export async function embedBatch(
  target: UserEmbedTarget, texts: string[], kind: "query" | "document" = "query",
): Promise<number[][]> {
  if (!texts.length) return [];
  target = localEmbedTarget() || target;
  const local = target.provider === "local";
  // EmbeddingGemma reads at most 2048 tokens. 6000 chars hit 2077 tokens on a real
  // passage (that failed the whole batch); 4000 stays under even for dense text.
  const input = texts.map(text => text.trim().slice(0, local ? 4000 : 24000))
    .map(text => !local || !text ? text
      : kind === "document" ? `title: none | text: ${text}` : `task: search result | query: ${text}`);
  if (input.some(text => !text)) throw new Error("Empty embedding input");
  const gemini = target.provider === "gemini";
  const url = gemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:batchEmbedContents`
    : target.url;
  const body = gemini ? { requests: input.map(text => ({
    model: `models/${target.model}`, content: { parts: [{ text }] }, outputDimensionality: target.dimensions,
  })) } : { model: target.model, input, dimensions: target.dimensions };
  const response = await fetch(url, { method: "POST", headers: target.headers,
    body: JSON.stringify(body), signal: AbortSignal.timeout(local ? 120000 : 25000) });
  if (!response.ok) {
    const retry = response.headers.get("retry-after") || "30";
    throw new Error(`Embedding provider HTTP ${response.status}; retry after ${retry}s`);
  }
  const payload = await response.json();
  const raw = gemini ? payload.embeddings?.map((e: any) => e.values)
    : payload.data?.sort((a: any, b: any) => a.index - b.index).map((e: any) => e.embedding);
  if (!Array.isArray(raw) || raw.length !== texts.length) throw new Error("Incomplete embedding batch");
  return raw.map(value => {
    if (!Array.isArray(value) || value.some(v => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error("Invalid embedding vector");
    }
    const vector = coerceEmbeddingDimensions(value, target.dimensions);
    if (!vector || vector.every(v => v === 0)) throw new Error("Invalid embedding vector");
    return vector;
  });
}
