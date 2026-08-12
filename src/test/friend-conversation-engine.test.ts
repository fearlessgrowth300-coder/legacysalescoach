import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyDeterministicSalesSignals,
  detectFriendSalesSignal,
  deriveEvidenceGatedFriendStage,
  deterministicFriendQualityIssues,
  friendStageToDatabase,
  normalizeFriendStage,
  selectRelevantConversationPassages,
} from "../../supabase/functions/_shared/friend-conversation-engine";

describe("Friend conversation engine", () => {
  it("normalizes both legacy engines into the same five UI stages", () => {
    expect(normalizeFriendStage("warming")).toBe("intent");
    expect(normalizeFriendStage("implication")).toBe("logical_certainty");
    expect(normalizeFriendStage("need_payoff")).toBe("emotional_certainty");
    expect(normalizeFriendStage("expert_introduction")).toBe("pitch");
    expect(normalizeFriendStage("decision")).toBe("handoff");
  });

  it("does not advance on warmth or message count without evidence", () => {
    const result = deriveEvidenceGatedFriendStage({ detectedTone: "warm", warmth_score: 90 }, 20);
    expect(result.stage).toBe("intent");
    expect(result.missing).toContain("an active unresolved problem or gap in their own situation");
  });

  it("advances through the certainty funnel only when each evidence gate is met", () => {
    const base = {
      motivation: "replace income",
      tangible_goal: "consistent $5k months",
      past_experiences: ["posted reels for six months without a repeatable result"],
      problem_gap: "views but no sales",
      problem_status: "active",
      root_cause: "content attracts attention but does not create buyer conversations",
      consequences: "income remains unpredictable and leaving the job stays delayed",
      need_for_change_reason: "the same posting approach is not producing consistent sales",
      inaction_pattern: "afraid another investment will fail after a poor course experience",
      detailed_future_outcome: "predictable income, more time with family, and confidence in the business",
    };
    expect(deriveEvidenceGatedFriendStage(base, 8).stage).toBe("emotional_certainty");
    expect(deriveEvidenceGatedFriendStage({ ...base, readiness: "wants_help" }, 8).stage).toBe("pitch");
    expect(deriveEvidenceGatedFriendStage({ ...base, readiness: "accepted_referral" }, 8).stage).toBe("handoff");
    expect(friendStageToDatabase("intent")).toBe("intent");
  });

  it("does not skip the goal, experience, logical, or emotional checkpoints", () => {
    const intentOnly = { tangible_goal: "consistent sales", motivation: "more time with family" };
    expect(deriveEvidenceGatedFriendStage(intentOnly, 12).stage).toBe("intent");

    const intentComplete = { ...intentOnly, past_experiences: ["tried daily reels for four months"] };
    expect(deriveEvidenceGatedFriendStage(intentComplete, 12).stage).toBe("logical_certainty");

    const logicalComplete = {
      ...intentComplete,
      problem_status: "active",
      problem_gap: "attention is not turning into sales",
      root_cause: "the content has no buyer transition",
      consequences: "income remains unpredictable",
      need_for_change_reason: "posting more of the same will repeat the result",
    };
    expect(deriveEvidenceGatedFriendStage(logicalComplete, 12).stage).toBe("emotional_certainty");

    const emotionalComplete = {
      ...logicalComplete,
      inaction_pattern: "afraid of wasting money after a previous course",
      detailed_future_outcome: "reliable income and afternoons free for family",
      readiness: "wants_help",
    };
    expect(deriveEvidenceGatedFriendStage(emotionalComplete, 12).stage).toBe("pitch");
  });

  it("does not treat a resolved historical problem as current pain", () => {
    const result = deriveEvidenceGatedFriendStage({
      motivation: "freedom",
      current_strategy: "new opportunity",
      problem_gap: "course sales were difficult",
      problem_status: "past_resolved",
    }, 8);
    expect(result.stage).toBe("intent");
  });

  it("does not treat a prospect's audience problem as the prospect's own pain", () => {
    const result = deriveEvidenceGatedFriendStage({
      motivation: "make a low-cost offer accessible",
      current_strategy: "selling a $27 PDF",
      pain_points: ["beginners in her audience feel overwhelmed"],
      problem_status: "none",
    }, 8);
    expect(result.stage).toBe("intent");
  });

  it("recognizes an explicit first-person lack of sales as an active pain-stage gap", () => {
    const enriched = applyDeterministicSalesSignals(
      { current_strategy: "posting reels" },
      "My main issue is sales. I'm still not making any sales.",
    );
    expect(enriched.problem_status).toBe("active");
    expect(enriched.knowledge_need).toContain("sales psychology");
    expect(enriched.reply_act).not.toBe("ask_permission");
    expect(deriveEvidenceGatedFriendStage(enriched, 2).stage).toBe("intent");
  });

  it("records explicit interest in help without skipping missing certainty stages", () => {
    const enriched = applyDeterministicSalesSignals(
      { current_strategy: "organic content" },
      "I need help getting consistent sales.",
    );
    expect(enriched.readiness).toBe("wants_help");
    expect(enriched.reply_act).not.toBe("ask_permission");
    expect(deriveEvidenceGatedFriendStage(enriched, 4).stage).toBe("intent");
  });

  it("does not turn a general audience sales statement into the prospect's personal pain", () => {
    const signal = detectFriendSalesSignal("I teach beginners how to get sales from content.");
    expect(signal.activeSalesGap).toBe(false);
    expect(signal.explicitSalesGoal).toBe(false);
  });

  it("retrieves the reference section that matches the exact stage", () => {
    const reference = [
      "Hey, I saw your profile and wanted to say hi.",
      "What strategy are you using and what result are you seeing?",
      "What has no sales meant for your confidence and family?",
      "Would it help if I shared the expert who helped me?",
      "I understand the price concern. What specifically makes you unsure?",
    ].join("\n\n");
    const selected = selectRelevantConversationPassages(reference, "price objection and trust", "handoff", 1);
    expect(selected).toContain("price concern");
  });

  it("flags the exact weak patterns seen in the live chats", () => {
    expect(deterministicFriendQualityIssues("I'm here if you ever want to chat. Just good vibes!", "intent")).toContain("vague non-progressing language");
    expect(deterministicFriendQualityIssues("What problems are your audience struggling with?", "intent")).toContain("asks about the audience instead of the prospect");
  });

  it("wires full approved examples, shared stages and quality validation into both reply paths", () => {
    const generateReply = readFileSync("supabase/functions/generate-reply/index.ts", "utf8");
    const chatSuggest = readFileSync("supabase/functions/chat-suggest/index.ts", "utf8");
    const chatsUi = readFileSync("src/pages/Chats.tsx", "utf8");

    expect(generateReply).toContain("Full Approved Reference Conversation");
    expect(generateReply).toContain("buildFriendQualityValidatorPrompt(\"variants\")");
    expect(generateReply).toContain("friendStageToDatabase(friendStageResult.stage)");
    expect(generateReply).toContain("sourceBalancedTake(decisionPrinciples, 1, 8)");
    expect(generateReply).not.toContain("workspace.custom_framework.substring(0, 8000)");
    expect(chatSuggest).toContain("FULL APPROVED REAL CONVERSATION EXAMPLES");
    expect(chatSuggest).toContain("buildFriendQualityValidatorPrompt(\"suggestions\")");
    expect(chatSuggest).toContain("friendStageToDatabase(finalFriendStageResult.stage)");
    expect(chatSuggest).toContain('const principlesCap = activeThreadType === "friend" ? 10');
    expect(chatSuggest).not.toContain("conversation_examples || \"\").trim().substring(0, 14000)");
    expect(chatsUi).toContain('const stages = ["intent", "logical_certainty", "emotional_certainty", "pitch", "handoff"]');
  });
});
