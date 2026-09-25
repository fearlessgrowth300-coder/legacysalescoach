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
      .mockResolvedValueOnce(new Response('{"choices":[]}', { status: 200 }));
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
      timeout_ms: 30_000,
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
