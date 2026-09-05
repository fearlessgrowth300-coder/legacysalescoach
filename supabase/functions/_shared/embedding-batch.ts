import { coerceEmbeddingDimensions } from "./embedding-vector.ts";
import type { UserEmbedTarget } from "./user-ai.ts";

// Batch requests reduce quota consumption during resumable indexing. Keep row
// positions stable and reject malformed vectors instead of silently saving them.
export async function embedBatch(target: UserEmbedTarget, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const input = texts.map(text => text.trim().slice(0, 24000));
  if (input.some(text => !text)) throw new Error("Empty embedding input");
  const gemini = target.provider === "gemini";
  const url = gemini
    ? `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:batchEmbedContents`
    : target.url;
  const body = gemini ? { requests: input.map(text => ({
    model: `models/${target.model}`, content: { parts: [{ text }] }, outputDimensionality: target.dimensions,
  })) } : { model: target.model, input, dimensions: target.dimensions };
  const response = await fetch(url, { method: "POST", headers: target.headers,
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
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
