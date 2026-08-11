import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildFriendDecisionSearchQuery,
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

  it("builds retrieval around intent, gap and certainty instead of keywords alone", () => {
    const query = buildFriendDecisionSearchQuery({
      intent: "prove she can create repeatable sales independently",
      tangible_goal: "consistent weekly sales",
      sales_status: "made one sale",
      problem_gap: "cannot repeat the first result",
      doubt_cause: "previous mentor support did not help",
      certainty_gap: "does not know whether the strategy is repeatable",
      reply_act: "relate_then_reframe",
      knowledge_need: "autonomy-safe reframe and repeatable process",
      objections: ["wants to do it alone"],
    }, "I already made a sale so I can do it myself");

    expect(query).toContain("consistent weekly sales");
    expect(query).toContain("cannot repeat the first result");
    expect(query).toContain("autonomy-safe reframe");
    expect(query).toContain("I already made a sale");
  });

  it("keeps known prospect facts when a later analysis returns unknown", () => {
    const profile = buildFriendProspectProfile({
      sales_status: "unknown",
      doubt_cause: "not inferred",
    }, {
      sales_status: "made one sale",
      doubt_cause: "lost trust after a previous program",
    });

    expect(profile.sales_status).toBe("made one sale");
    expect(profile.doubt_cause).toBe("lost trust after a previous program");
  });

  it("uses analysis-first retrieval and does not force a question in Friend mode", () => {
    const generateReply = readFileSync("supabase/functions/generate-reply/index.ts", "utf8");
    const chatSuggest = readFileSync("supabase/functions/chat-suggest/index.ts", "utf8");

    expect(generateReply).toContain("FRIEND PASS 2: DECISION-AWARE KNOWLEDGE RETRIEVAL");
    expect(generateReply).toContain("buildFriendDecisionSearchQuery(analysisJson");
    expect(chatSuggest).toContain("FRIEND DECISION ANALYSIS — locked for this generation");
    expect(chatSuggest).toContain("buildFriendDecisionSearchQuery(friendDecisionAnalysis");
    expect(generateReply).not.toContain("End with a question that deepens rapport");
    expect(chatSuggest).not.toContain("SELECT appropriate SPIN question type based on conversation depth");
  });
});
