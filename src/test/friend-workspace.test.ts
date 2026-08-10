import { describe, expect, it } from "vitest";
import { friendDraftPayload, stringList } from "@/lib/friend-workspace";

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
});
