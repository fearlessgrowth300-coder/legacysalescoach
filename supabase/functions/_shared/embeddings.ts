// Shared embedding helper. Routes through the user's OpenAI/Gemini key when
// available. Anthropic chat users use the built-in gateway for embeddings so
// semantic Knowledge Base retrieval stays enabled.
//
// Always 768-dim text-embedding-3-small (OpenAI) or a Gemini embedding model
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
      console.warn("[embeddings] No usable embedding provider is configured; semantic search was skipped.");
      return null;
    }
    console.error("[embeddings] failed:", err);
    return null;
  }
}
