import { describe, expect, it } from "vitest";
import { friendDraftPayload, normalizeFriendProfileDraft, stringList } from "@/lib/friend-workspace";

describe("friend workspace helpers", () => {
  it("normalizes profile lists without keeping bullets", () => {
    expect(stringList("- no time\n- price concern\ntrust")).toEqual(["no time", "price concern", "trust"]);
  });

  it("converts an approved automatic draft into workspace fields", () => {
    const payload = friendDraftPayload({
      friend_persona: { display_name: "Calm Builder", audience: "beginner parents" },
      pain_points: ["no time", "information overload"],
      referral_triggers: ["asks how I started"],
      offer_truth: { name: "Starter Course", referral_url: "https://example.com" },
    });

    expect(payload.friend_persona_status).toBe("approved");
    expect(payload.audience_description).toBe("beginner parents");
    expect(payload.pain_points).toBe("no time\ninformation overload");
    expect(payload.offer_truth).toMatchObject({ name: "Starter Course" });
  });

  it("converts the legacy Cloud persona response into a visible Friend review draft", () => {
    const draft = normalizeFriendProfileDraft({
      workspace_name: "Legacy Driven Growth",
      tone: "warm and direct",
      audience: "mums building online income",
      positioning: "supportive peer",
      energy: "encouraging",
    }, "The Instagram bio and recent posts focus on helping mums earn online.", "Starter Course");

    expect(draft.friend_persona).toMatchObject({
      display_name: "Legacy Driven Growth",
      role: "supportive peer",
      voice_notes: "warm and direct; encouraging",
    });
    expect(draft.audience_description).toBe("mums building online income");
    expect(draft.profile_evidence).toContain("Instagram bio");
    expect(draft.offer_truth).toMatchObject({ name: "Starter Course" });
    expect(draft.legacy_profile_shape).toBe(true);
  });
});
