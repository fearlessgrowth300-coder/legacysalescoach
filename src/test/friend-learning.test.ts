import { describe, expect, it } from "vitest";
import {
  buildFriendLearningContext,
  buildFriendProspectProfile,
} from "../../supabase/functions/_shared/friend-learning";

describe("Friend conversation learning", () => {
  it("merges structured evidence without losing previous prospect facts", () => {
    const profile = buildFriendProspectProfile({
      segment: "first-sale but stuck",
      mentor_status: "has a mentor but no recent result",
      objections: ["wants to do it alone"],
      contact_status: "active",
      confidence: 82,
    }, {
      interests: ["digital products"],
      desires: ["consistent sales"],
      sales_status: "made one sale",
    }, "2026-08-10T22:00:00.000Z");

    expect(profile).toMatchObject({
      segment: "first-sale but stuck",
      sales_status: "made one sale",
      mentor_status: "has a mentor but no recent result",
      contact_status: "active",
      confidence: 82,
    });
    expect(profile.interests).toContain("digital products");
    expect(profile.objections).toContain("wants to do it alone");
  });

  it("preserves a do-not-contact boundary when a later analysis omits it", () => {
    const profile = buildFriendProspectProfile({}, { contact_status: "do_not_contact" });
    expect(profile.contact_status).toBe("do_not_contact");
  });

  it("ranks verified audience signals above raw frequency", () => {
    const context = buildFriendLearningContext({ segment: "beginner", contact_status: "active" }, [
      { signal_type: "objections", signal_key: "price", observation_count: 10, win_count: 0 },
      { signal_type: "objections", signal_key: "past bad experience", observation_count: 2, win_count: 3 },
    ]);

    expect(context.indexOf("past bad experience")).toBeLessThan(context.indexOf("price"));
    expect(context).toContain("facts stay with this prospect");
  });
});
