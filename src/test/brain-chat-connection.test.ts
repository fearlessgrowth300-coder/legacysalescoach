import { describe, expect, it } from "vitest";
import { toAnthropicContent } from "../../supabase/functions/_shared/anthropic-content";
import {
  buildBrainRetrievalMeta,
  classifyBrainChatIntent,
  isAllowedBrainChatOrigin,
  isSimpleBrainChatSmallTalk,
  responseMentionsUnknownSources,
  simpleBrainChatResponse,
} from "../../supabase/functions/brain-chat/lib";
import { PROVIDER_MODEL } from "@/hooks/useActiveAiModel";
import {
  buildVisionModelChain,
  GEMINI_CHAT_MODELS,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_VISION_FALLBACK_MODELS,
  shouldOmitGeminiSamplingParameters,
} from "../../supabase/functions/_shared/gemini-models";
import {
  isSimpleBrainChatGreeting,
  simpleBrainChatGreetingResponse,
} from "@/lib/brain-chat-small-talk";

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
    expect(PROVIDER_MODEL.lovable.model).toBe("google/gemini-3.1-flash-lite");
    expect(PROVIDER_MODEL.openai.model).toBe("gpt-4o");
    expect(PROVIDER_MODEL.gemini.model).toBe(GEMINI_CHAT_MODELS.balanced);
    expect(PROVIDER_MODEL.anthropic.model).toBe("claude-opus-4-8");
  });

  it("routes direct Gemini calls through current chat and embedding models", () => {
    expect(GEMINI_CHAT_MODELS).toEqual({
      fast: "gemini-3.1-flash-lite",
      balanced: "gemini-3-flash-preview",
      reasoning: "gemini-3-flash-preview",
      vision: "gemini-3-flash-preview",
    });
    expect(GEMINI_EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(GEMINI_VISION_FALLBACK_MODELS).toEqual([
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
    ]);
    expect(buildVisionModelChain(
      GEMINI_CHAT_MODELS.vision,
      [GEMINI_CHAT_MODELS.vision, ...GEMINI_VISION_FALLBACK_MODELS],
    )).toEqual([
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-flash",
    ]);
    expect(shouldOmitGeminiSamplingParameters("gemini", GEMINI_CHAT_MODELS.fast)).toBe(false);
    expect(shouldOmitGeminiSamplingParameters("gemini", GEMINI_CHAT_MODELS.balanced)).toBe(false);
    expect(shouldOmitGeminiSamplingParameters("gemini", "gemini-2.5-flash")).toBe(false);
    expect(shouldOmitGeminiSamplingParameters("lovable", "google/gemini-3.5-flash")).toBe(true);
    expect(shouldOmitGeminiSamplingParameters("lovable", "google/gemini-3.1-flash-lite")).toBe(false);
  });

  it("keeps simple greetings out of the full sales-analysis pipeline", () => {
    expect(isSimpleBrainChatSmallTalk("hi")).toBe(true);
    expect(isSimpleBrainChatSmallTalk("Good morning! ")).toBe(true);
    expect(isSimpleBrainChatSmallTalk("hi", true)).toBe(false);
    expect(isSimpleBrainChatSmallTalk("Hi, she said the price is too high. What should I reply?")).toBe(false);
    expect(simpleBrainChatResponse("hi")).toContain("What would you like help with");
    expect(isSimpleBrainChatGreeting("Hi")).toBe(true);
    expect(isSimpleBrainChatGreeting("Hi, what should I send this buyer?")).toBe(false);
    expect(simpleBrainChatGreetingResponse("Hi")).toBe(simpleBrainChatResponse("Hi"));
  });

  it("routes knowledge questions separately from buyer-conversation coaching", () => {
    expect(classifyBrainChatIntent("Summarize the main lessons from Objection Crusher")).toBe("source_summary");
    expect(classifyBrainChatIntent("Compare SPIN Selling versus Never Split the Difference")).toBe("source_comparison");
    expect(classifyBrainChatIntent("Write an Instagram caption for my course")).toBe("copywriting");
    expect(classifyBrainChatIntent("What does the knowledge base teach about trust?")).toBe("knowledge_qa");
    expect(classifyBrainChatIntent("How should objections be handled according to the books?")).toBe("knowledge_qa");
    expect(classifyBrainChatIntent("This buyer said the price is too high. What should I reply?")).toBe("conversation_coaching");
    expect(classifyBrainChatIntent("What is shown here?", true)).toBe("conversation_coaching");
  });

  it("detects citations to sources that were not retrieved", () => {
    expect(responseMentionsUnknownSources(
      '(Source: "SPIN Selling") and (Source: "Made Up Book")',
      ["SPIN Selling"],
    )).toEqual(["Made Up Book"]);
  });
});
