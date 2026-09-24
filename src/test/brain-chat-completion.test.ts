import { describe, expect, it } from "vitest";
import { isBrainChatReplyTruncated } from "@/lib/brainChatCompletion";

describe("AI Chat completion", () => {
  it("does not mistake a validated reply for truncation when the final SSE marker is missed", () => {
    expect(isBrainChatReplyTruncated({ receivedDone: false, receivedCompleteReply: true, finishReason: "stop" })).toBe(false);
  });

  it("accepts a complete reply regardless of its final punctuation", () => {
    expect(isBrainChatReplyTruncated({ receivedDone: true, receivedCompleteReply: false })).toBe(false);
  });

  it("still flags a genuinely incomplete stream or provider token limit", () => {
    expect(isBrainChatReplyTruncated({ receivedDone: false, receivedCompleteReply: false })).toBe(true);
    expect(isBrainChatReplyTruncated({ receivedDone: true, receivedCompleteReply: false, finishReason: "length" })).toBe(true);
  });
});
