import { afterEach, describe, expect, it, vi } from "vitest";
import { userChat, type UserChatTarget } from "../../supabase/functions/_shared/user-ai.ts";

const geminiTarget: UserChatTarget = {
  provider: "gemini",
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
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
});
