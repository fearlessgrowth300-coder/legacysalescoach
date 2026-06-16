// Shared embedding helper. Routes through the USER's provider key (OpenAI or
// Gemini) — no Lovable-AI fallback. Returns null if the user has no usable key
// (Anthropic-only users get null; surfacing helpful errors is the caller's job).
//
// Always 768-dim text-embedding-3-small (OpenAI) or text-embedding-004 (Gemini)
// to match the existing pgvector columns.

import { resolveUserEmbedTarget, userEmbed, NoUserAiKeyError } from "./user-ai.ts";

export async function generateEmbedding(
  text: string,
  supabase: any,
  userId: string | null,
): Promise<number[] | null> {
  if (!userId) return null;
  try {
    const target = await resolveUserEmbedTarget(supabase, userId);
    return await userEmbed(target, text);
  } catch (err) {
    if (err instanceof NoUserAiKeyError) {
      console.warn("[embeddings] No user AI key set — embeddings skipped.");
      return null;
    }
    console.error("[embeddings] failed:", err);
    return null;
  }
}
