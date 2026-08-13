import { describe, expect, it } from "vitest";
import { needsFirstMessageRepair, parseSavedFirstMessages } from "@/lib/first-message";

describe("saved first-message recovery", () => {
  it("detects the broken certainty-funnel suggestions", () => {
    const saved = JSON.stringify([{
      text: "I hear you. What concrete result are you working toward most right now?",
      frameworkUsed: "evidence-gated certainty funnel",
    }]);
    expect(needsFirstMessageRepair(saved)).toBe(true);
  });

  it("keeps a profile-specific Instagram opener", () => {
    const saved = JSON.stringify([{
      text: "Hey Hayley, your line about helping moms create income from home caught my attention. What got you into that?",
      frameworkUsed: "Specific Observation",
    }]);
    expect(needsFirstMessageRepair(saved)).toBe(false);
    expect(parseSavedFirstMessages(saved)).toHaveLength(1);
  });
});

