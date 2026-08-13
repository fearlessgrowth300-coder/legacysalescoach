import { describe, expect, it } from "vitest";
import {
  buildProfileGroundedFirstMessages,
  extractFirstMessageProfileEvidence,
  isProfileGroundedFirstMessage,
} from "../../supabase/functions/_shared/first-message";

describe("profile-grounded first messages", () => {
  const prospect = {
    name: "Hayley | Faceless Digital Marketing",
    detected_interests: "Helping moms create income from home | A simple method you can start today",
  };

  it("prefers analyzed Instagram evidence over a generic profile summary", () => {
    expect(extractFirstMessageProfileEvidence(prospect, "Instagram URL: https://instagram.com/bloomfromhome"))
      .toContain("Helping moms create income from home");
  });

  it("creates three distinct openers grounded in the analyzed profile", () => {
    const suggestions = buildProfileGroundedFirstMessages(prospect, "");
    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions.map((suggestion) => suggestion.text)).size).toBe(3);
    expect(suggestions.every((suggestion) => isProfileGroundedFirstMessage(suggestion.text, prospect.detected_interests))).toBe(true);
    expect(suggestions.every((suggestion) => !/concrete result|working toward most|main result/i.test(suggestion.text))).toBe(true);
  });

  it("uses a recent post before the bio and names the post in the opener", () => {
    const withPost = {
      ...prospect,
      target_video_caption: "Instagram post/reel\nWhy I stopped waiting for confidence before building my own thing",
    };
    expect(extractFirstMessageProfileEvidence(withPost, "")).toContain("stopped waiting for confidence");
    const suggestions = buildProfileGroundedFirstMessages(withPost, "");
    expect(suggestions.every((suggestion) => /\bpost\b/i.test(suggestion.text))).toBe(true);
    expect(suggestions.every((suggestion) => /confidence/i.test(suggestion.text))).toBe(true);
  });

  it("rejects the certainty-funnel fallback as an Instagram opener", () => {
    expect(isProfileGroundedFirstMessage(
      "I hear you, and that makes sense. What concrete result are you working toward most right now?",
      prospect.detected_interests,
    )).toBe(false);
  });
});
