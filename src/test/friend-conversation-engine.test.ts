import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveEvidenceGatedFriendStage,
  deterministicFriendQualityIssues,
  friendStageToDatabase,
  normalizeFriendStage,
  selectRelevantConversationPassages,
} from "../../supabase/functions/_shared/friend-conversation-engine";

describe("Friend conversation engine", () => {
  it("normalizes both legacy engines into the same five UI stages", () => {
    expect(normalizeFriendStage("warming")).toBe("rapport");
    expect(normalizeFriendStage("implication")).toBe("pain");
    expect(normalizeFriendStage("expert_introduction")).toBe("offer");
    expect(normalizeFriendStage("decision")).toBe("close");
  });

  it("does not advance on warmth or message count without evidence", () => {
    const result = deriveEvidenceGatedFriendStage({ detectedTone: "warm", warmth_score: 90 }, 20);
    expect(result.stage).toBe("opener");
    expect(result.missing).toContain("an active unresolved problem or gap in their own situation");
  });

  it("advances through pain, offer and close only when evidence gates are met", () => {
    const base = {
      motivation: "replace income",
      current_strategy: "posting reels",
      problem_gap: "views but no sales",
      problem_status: "active",
      tangible_goal: "$5k months",
    };
    expect(deriveEvidenceGatedFriendStage(base, 8).stage).toBe("pain");
    expect(deriveEvidenceGatedFriendStage({ ...base, readiness: "wants_help" }, 8).stage).toBe("offer");
    expect(deriveEvidenceGatedFriendStage({ ...base, readiness: "accepted_referral" }, 8).stage).toBe("close");
    expect(friendStageToDatabase("opener")).toBe("first_contact");
  });

  it("does not treat a resolved historical problem as current pain", () => {
    const result = deriveEvidenceGatedFriendStage({
      motivation: "freedom",
      current_strategy: "new opportunity",
      problem_gap: "course sales were difficult",
      problem_status: "past_resolved",
    }, 8);
    expect(result.stage).toBe("rapport");
  });

  it("does not treat a prospect's audience problem as the prospect's own pain", () => {
    const result = deriveEvidenceGatedFriendStage({
      motivation: "make a low-cost offer accessible",
      current_strategy: "selling a $27 PDF",
      pain_points: ["beginners in her audience feel overwhelmed"],
      problem_status: "none",
    }, 8);
    expect(result.stage).toBe("rapport");
  });

  it("retrieves the reference section that matches the exact stage", () => {
    const reference = [
      "Hey, I saw your profile and wanted to say hi.",
      "What strategy are you using and what result are you seeing?",
      "What has no sales meant for your confidence and family?",
      "Would it help if I shared the expert who helped me?",
      "I understand the price concern. What specifically makes you unsure?",
    ].join("\n\n");
    const selected = selectRelevantConversationPassages(reference, "price objection and trust", "close", 1);
    expect(selected).toContain("price concern");
  });

  it("flags the exact weak patterns seen in the live chats", () => {
    expect(deterministicFriendQualityIssues("I'm here if you ever want to chat. Just good vibes!", "rapport")).toContain("vague non-progressing language");
    expect(deterministicFriendQualityIssues("What problems are your audience struggling with?", "rapport")).toContain("asks about the audience instead of the prospect");
  });

  it("wires full approved examples, shared stages and quality validation into both reply paths", () => {
    const generateReply = readFileSync("supabase/functions/generate-reply/index.ts", "utf8");
    const chatSuggest = readFileSync("supabase/functions/chat-suggest/index.ts", "utf8");
    const chatsUi = readFileSync("src/pages/Chats.tsx", "utf8");

    expect(generateReply).toContain("Full Approved Reference Conversation");
    expect(generateReply).toContain("buildFriendQualityValidatorPrompt(\"variants\")");
    expect(generateReply).toContain("friendStageToDatabase(friendStageResult.stage)");
    expect(generateReply).not.toContain("workspace.custom_framework.substring(0, 8000)");
    expect(chatSuggest).toContain("FULL APPROVED REAL CONVERSATION EXAMPLES");
    expect(chatSuggest).toContain("buildFriendQualityValidatorPrompt(\"suggestions\")");
    expect(chatSuggest).toContain("friendStageToDatabase(finalFriendStageResult.stage)");
    expect(chatSuggest).not.toContain("conversation_examples || \"\").trim().substring(0, 14000)");
    expect(chatsUi).toContain('const stages = ["opener", "rapport", "pain", "offer", "close"]');
  });
});
