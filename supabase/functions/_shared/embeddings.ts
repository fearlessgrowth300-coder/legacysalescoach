// Shared embedding generation helper for semantic search
// Uses OpenAI text-embedding-3-small (768 dimensions) to match existing DB vectors

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      console.warn("OPENAI_API_KEY not set, skipping embedding generation");
      return null;
    }

    // Truncate to ~8000 tokens (~32000 chars) to stay within model limits
    const truncated = text.substring(0, 32000);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: truncated,
        dimensions: 768,
      }),
    });

    if (!response.ok) {
      console.error("Embedding API error:", response.status);
      await response.text(); // consume body
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}
