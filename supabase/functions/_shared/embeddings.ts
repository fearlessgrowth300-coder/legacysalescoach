// Shared embedding generation helper for semantic search.
//
// Uses text-embedding-3-small (768 dimensions) via the **Lovable AI Gateway**,
// so it works on Lovable Cloud with the auto-provisioned LOVABLE_API_KEY — no
// separate OpenAI account/key required. 768 dims matches the existing pgvector
// columns (sales_brain.embedding / knowledge_chunks.embedding) and the gateway
// proxies the exact same OpenAI model, so vectors stay in the same space as any
// previously stored ones.

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    // Prefer the Lovable Gateway key (always present on Lovable Cloud); fall back
    // to a direct OpenAI key if one happens to be configured.
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    const endpoint = LOVABLE_API_KEY
      ? "https://ai.gateway.lovable.dev/v1/embeddings"
      : "https://api.openai.com/v1/embeddings";
    const apiKey = LOVABLE_API_KEY || OPENAI_API_KEY;

    if (!apiKey) {
      console.warn("No LOVABLE_API_KEY or OPENAI_API_KEY set, skipping embedding generation");
      return null;
    }

    // Truncate to ~8000 tokens (~32000 chars) to stay within model limits
    const truncated = (text || "").substring(0, 32000);
    if (truncated.length < 1) return null;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncated,
        dimensions: 768,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error("Embedding API error:", response.status, await response.text().catch(() => ""));
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}
