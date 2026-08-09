import { describe, expect, it } from "vitest";
import { toAnthropicContent } from "../../supabase/functions/_shared/anthropic-content";
import { buildBrainRetrievalMeta, isAllowedBrainChatOrigin } from "../../supabase/functions/brain-chat/lib";
import { PROVIDER_MODEL } from "@/hooks/useActiveAiModel";

describe("AI Chat connection helpers", () => {
  it("allows local development and configured production origins without opening CORS broadly", () => {
    expect(isAllowedBrainChatOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedBrainChatOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedBrainChatOrigin("https://legacysalescoach.lovable.app")).toBe(true);
    expect(isAllowedBrainChatOrigin("https://coach.example.com", ["https://coach.example.com"])).toBe(true);
    expect(isAllowedBrainChatOrigin("https://malicious.example.com")).toBe(false);
  });

  it("preserves text and images when translating a vision request for Anthropic", () => {
    expect(toAnthropicContent([
      { type: "text", text: "Read this conversation" },
      { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
    ])).toEqual([
      { type: "text", text: "Read this conversation" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } },
    ]);
  });

  it("returns the retrieval metadata shape consumed by AI Chat", () => {
    expect(buildBrainRetrievalMeta({
      selected: [{ source_title: "Never Split the Difference" }],
      supporting_chunks: [
        { source_title: "Never Split the Difference" },
        { source_title: "SPIN Selling" },
      ],
      debug: {
        semantic_principles_count: 8,
        static_principles_count: 0,
        candidate_count: 20,
        reranked_count: 18,
        embedding_used: true,
      },
    })).toEqual({
      chunksRetrieved: 2,
      uniqueSources: 2,
      sources: ["Never Split the Difference", "SPIN Selling"],
      semanticMatches: 10,
      staticMatches: 0,
      dedupSavings: 2,
      embeddingUsed: true,
    });
  });

  it("shows the same generation models used by the backend", () => {
    expect(PROVIDER_MODEL.lovable.model).toBe("google/gemini-2.5-flash");
    expect(PROVIDER_MODEL.openai.model).toBe("gpt-4o");
    expect(PROVIDER_MODEL.anthropic.model).toBe("claude-opus-4-8");
  });
});
