import { describe, expect, it } from "vitest";
import {
  latestProspectScreenshotMessage,
  latestScreenshotTurn,
  orderedScreenshotMessages,
} from "@/lib/screenshot-conversation";

const instagramConversation = [
  { speaker: "them" as const, text: "How long have you been doing digital marketing?", order: 1 },
  { speaker: "me" as const, text: "I began my digital marketing journey five months ago.", order: 2 },
  { speaker: "them" as const, text: "That’s amazing! Thank you for sharing your journey!", order: 3 },
];

describe("screenshot conversation speaker selection", () => {
  it("uses the bottom-most prospect bubble rather than the salesperson's story", () => {
    expect(latestProspectScreenshotMessage(instagramConversation)).toBe(
      "That’s amazing! Thank you for sharing your journey!",
    );
    expect(latestScreenshotTurn(instagramConversation)?.speaker).toBe("them");
  });

  it("preserves explicit OCR order before choosing the latest turn", () => {
    const shuffled = [instagramConversation[2], instagramConversation[0], instagramConversation[1]];
    expect(orderedScreenshotMessages(shuffled).map((message) => message.order)).toEqual([1, 2, 3]);
    expect(latestScreenshotTurn(shuffled)?.text).toContain("Thank you");
  });

  it("does not relabel the latest salesperson bubble as an inbound reply", () => {
    expect(latestProspectScreenshotMessage([
      { speaker: "them", text: "I am just starting", order: 1 },
      { speaker: "me", text: "How has it been going?", order: 2 },
    ])).toBe("I am just starting");
  });
});
