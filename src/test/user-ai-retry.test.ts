import { afterEach, describe, expect, it, vi } from "vitest";
import { userChat, type UserChatTarget } from "../../supabase/functions/_shared/user-ai.ts";

const geminiTarget: UserChatTarget = {
  provider: "gemini",
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  headers: { Authorization: "Bearer test", "x-goog-api-key": "test", "Content-Type": "application/json" },
  models: {
    fast: "gemini-3.8-flash",
    balanced: "gemini-3.8-flash",
    reasoning: "gemini-3.8-flash",
    vision: "gemini-3.8-flash",
  },
  isAnthropic: false,
};

describe("Gemini transient failure recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 503 once before falling back to another model", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"choices":[{"message":{"content":"A useful answer"},"finish_reason":"stop"}]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "Hello" }],
      timeout_ms: 5_000,
    });
    await vi.advanceTimersByTimeAsync(900);
    const response = await resultPromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gemini-3.8-flash");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("gemini-3.8-flash");
  });

  it("recovers a successful-but-empty Gemini completion through the native endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: "gemini-3.8-flash",
        choices: [{ message: { content: "" }, finish_reason: "length" }],
        usage: { completion_tokens: 1800 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [
          { text: "private thought", thought: true },
          { text: "A grounded answer" },
        ] } }],
        usageMetadata: { candidatesTokenCount: 18, thoughtsTokenCount: 7 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "Explain this source" }],
      max_tokens: 8192,
      reasoning_effort: "low",
      timeout_ms: 30_000,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-AI-Transport")).toBe("gemini-native-recovery");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: "gemini-3.8-flash", max_tokens: 8192, reasoning_effort: "low",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig).toMatchObject({
      maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "low" },
    });
    const body = await response.json();
    expect(body.choices[0]).toMatchObject({ message: { content: "A grounded answer" }, finish_reason: "stop" });
    expect(body.usage.completion_tokens_details.reasoning_tokens).toBe(7);
  });

  it("falls back to another model for an empty multimodal completion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"choices":[]}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"choices":[{"message":{"content":"I can read the screenshot"},"finish_reason":"stop"}]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: [
        { type: "text", text: "Read the screenshot" },
        { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
      ] }],
      timeout_ms: 30_000,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("gemini-3.7-flash");
    expect((await response.json()).choices[0].message.content).toBe("I can read the screenshot");
  });

  it("returns an explicit error when every multimodal model responds without text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } }] }],
      timeout_ms: 30_000,
    });

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((await response.json()).error).toContain("no answer");
  });

  it("uses the native Gemini endpoint when the compatible endpoint stays overloaded", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"variants":[{"message":"A grounded reply"}]}' }] } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [
        { role: "system", content: "Return JSON." },
        { role: "user", content: "Write a reply." },
      ],
      response_format: { type: "json_object" },
      // Native recovery of an overloaded model only runs with >30s left.
      timeout_ms: 60_000,
    });
    await vi.advanceTimersByTimeAsync(900);
    const response = await resultPromise;

    expect(response.ok).toBe(true);
    expect(response.headers.get("X-AI-Transport")).toBe("gemini-native-recovery");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("gemini-3.8-flash:generateContent");
    const nativeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(nativeBody.system_instruction.parts[0].text).toBe("Return JSON.");
    expect(nativeBody.generationConfig.responseMimeType).toBe("application/json");
    expect((await response.json()).choices[0].message.content).toContain("A grounded reply");
  });

  it("preserves a native 429 instead of masking it with a later 503", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes(":generateContent")) return new Response("limit reached", { status: 429 });
      const model = JSON.parse(String(init.body)).model;
      return new Response("unavailable", { status: model === "gemini-3.8-flash" ? 429 : 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = userChat(geminiTarget, {
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "Hello" }],
      timeout_ms: 15_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await resultPromise).status).toBe(429);
  });
});
