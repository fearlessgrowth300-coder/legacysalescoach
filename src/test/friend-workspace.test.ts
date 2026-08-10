import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRIEND_BEHAVIOR,
  friendDraftPayload,
  mergeAutomaticFriendDraft,
  normalizeFriendCourses,
  normalizeFriendProfileDraft,
  stringList,
} from "@/lib/friend-workspace";

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

  it("merges the Instagram identity and owner-provided Friend setup into the approved draft", () => {
    const draft = mergeAutomaticFriendDraft({
      audience_description: "mums building online income",
      friend_persona: { voice_notes: "warm and informal" },
    }, {
      instagram: {
        username: "legacydriven",
        fullName: "Legacy Driven Growth",
        biography: "Helping mums build digital income",
        profilePicUrl: "https://storage.example/avatar.jpg",
      },
      courseName: "Freedom Builder Course",
      courseDescription: "The course used to learn the strategy.",
      courseResults: "Made the verified sales shown in the uploaded proof.",
      conversationExamples: "Friend: I saw your post about starting again...",
      strategyName: "Freedom Builder Method",
      strategyWebsite: "https://example.com/method",
      expertName: "Freedom Builder Team",
      expertReference: "the team",
      expertWebsite: "https://example.com/help",
      expertHelp: "They help beginners set up the system.",
    });

    expect(draft.friend_persona).toMatchObject({
      display_name: "Legacy Driven Growth",
      instagram_username: "legacydriven",
      instagram_bio: "Helping mums build digital income",
      avatar_url: "https://storage.example/avatar.jpg",
      behavior_guidelines: DEFAULT_FRIEND_BEHAVIOR,
      conversation_examples: "Friend: I saw your post about starting again...",
      strategy_name: "Freedom Builder Method",
      expert_reference: "the team",
    });
    expect(draft.offer_truth).toMatchObject({
      name: "Freedom Builder Course",
      results_summary: "Made the verified sales shown in the uploaded proof.",
    });

    const payload = friendDraftPayload(draft);
    expect(payload.friend_persona).toMatchObject({
      instagram_bio: "Helping mums build digital income",
      conversation_examples: "Friend: I saw your post about starting again...",
      expert_name: "Freedom Builder Team",
    });
    expect(payload.expert_description).toContain("the team: Freedom Builder Team");
  });

  it("keeps multiple courses separate while retaining the first as the compatible primary offer", () => {
    const draft = mergeAutomaticFriendDraft({}, {
      courses: [
        { name: "Starter Course", website: "https://example.com/starter", description: "For beginners" },
        { name: "Scale Course", website: "https://example.com/scale", results_summary: "Verified scale result" },
      ],
    });

    expect(normalizeFriendCourses(draft.offer_truth.courses)).toHaveLength(2);
    expect(draft.offer_truth.courses[1]).toMatchObject({ name: "Scale Course", results_summary: "Verified scale result" });
    expect(draft.offer_truth).toMatchObject({
      name: "Starter Course",
      course_url: "https://example.com/starter",
      description: "For beginners",
    });
    expect(draft.setup_verified_context.course_count).toBe(2);
  });
});
