import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiRequestTimeoutError,
  withAiRequestTimeout,
} from "@/lib/ai-request-timeout";

describe("conversation AI request deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("returns a response that finishes before the deadline", async () => {
    await expect(withAiRequestTimeout(Promise.resolve("ready"), 50)).resolves.toBe("ready");
  });

  it("rejects a stalled request so the UI can recover", async () => {
    vi.useFakeTimers();
    const result = withAiRequestTimeout(new Promise<string>(() => {}), 1000);
    const assertion = expect(result).rejects.toBeInstanceOf(AiRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
