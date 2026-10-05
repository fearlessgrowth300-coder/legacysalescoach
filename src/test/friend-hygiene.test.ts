import { describe, expect, it } from "vitest";
import {
  friendHardDecline,
  friendHygieneIssues,
  friendObjections,
  isSoftFriendIssue,
  rankFriendPrinciplesForStage,
  rankOpenerPrinciples,
  sentLineSet,
} from "../../supabase/functions/_shared/friend-conversation-engine";

// Lines and replies taken from the real Friend conversations reviewed on 2026-10-04.
const sent = sentLineSet(["Love that! What made you decide to build around that? Tell me more."]);

describe("Friend conversation hygiene", () => {
  it("flags a stock line already sent to other prospects", () => {
    const issues = friendHygieneIssues("Oh nice. What made you decide to build around that?", [], sent);
    expect(issues.some((issue) => issue.startsWith("reuses a line"))).toBe(true);
    expect(friendHygieneIssues("Oh nice, how did you get into it?", [], sent).some((i) => i.startsWith("reuses"))).toBe(false);
  });

  it("blocks back-to-back questions", () => {
    const convo = [{ direction: "outbound", content: "How long have you been at it?" }, { direction: "inbound", content: "About a year now, slowly growing my page" }];
    expect(friendHygieneIssues("That's awesome! What got you started?", convo).some((i) => i.startsWith("asks again"))).toBe(true);
    expect(friendHygieneIssues("A year is solid, I remember how slow the start felt for me too 😅", convo).some((i) => i.startsWith("asks again"))).toBe(false);
  });

  it("flags a wall of text answering a short message", () => {
    const convo = [{ direction: "inbound", content: "That sounds great!" }];
    const long = "It really was a game changer for me. ".repeat(8);
    expect(friendHygieneIssues(long, convo).some((i) => i.startsWith("too long"))).toBe(true);
  });

  it("prefers opener teachings and rotates away from the always-locked principle", () => {
    const pool = [
      { id: "cf", principle_name: "Conversational Fluidity over Script Adherence" },
      { id: "gap", principle_name: "The Gap Analysis Framework" },
      { id: "op", principle_name: "The 'Main Intent' Setter Opener" },
      { id: "ally", principle_name: "The Ally, Not Attacker Opening" },
    ];
    expect(rankOpenerPrinciples(pool)[0].id).toBe("op");
    // "op" was locked on the last 3 openers -> the other opener principle gets a turn
    expect(rankOpenerPrinciples(pool, { op: 3 })[0].id).toBe("ally");
    expect(rankOpenerPrinciples([pool[0], pool[1]], { cf: 5 })[0].id).toBe("gap");
  });

  it("treats mentor / new / try-alone / afraid / fine / no-funds as objections to handle, not refusals", () => {
    const said = (text: string) => friendObjections([text]).map((o) => o.objection);
    expect(said("I'm working with a mentor currently but that's great it is working for you!")).toContain("has a mentor");
    expect(said("I'm still new to all of this")).toContain("is new");
    expect(said("I want to try it myself first")).toContain("wants to try it alone first");
    expect(said("It sounds like this might be more for MLM content creators")).toContain("is afraid or has been burned");
    expect(said("Not yet😊 I'm not really pushing for sales with this page right now.")).toContain("says they are fine");
    expect(said("I dnt have the funds right now")).toContain("has no funds right now");
    expect(friendHardDecline(["I'm working with a mentor currently"])).toBe(false);
  });

  it("only an explicit refusal blocks the pitch (strict)", () => {
    const mentor = [{ direction: "inbound", content: "I'm working with a mentor currently" }];
    const pitch = "Love that! The team that rebuilt my funnel does a free audit, want the link?";
    expect(friendHygieneIssues(pitch, mentor).some((i) => i.startsWith("pitches"))).toBe(false);
    const refused = [{ direction: "inbound", content: "Not interested, please stop messaging me" }];
    const issue = friendHygieneIssues(pitch, refused).find((i) => i.startsWith("pitches"));
    expect(issue).toBeTruthy();
    expect(isSoftFriendIssue(issue!)).toBe(false);
  });

  it("early replies prefer rapport lessons over closing scripts; later stages keep retrieval order", () => {
    const pool = [
      { principle_name: "Eliminating Self-Limiting Stories", category: "Mindset", when_to_use: "slump, fear of prospecting" },
      { principle_name: "The 4-Step Nonchalant Closing Framework", category: "Closing" },
      { principle_name: "Building Rapport Through Common Ground", category: "Trust Building" },
    ];
    expect(rankFriendPrinciplesForStage(pool, "intent")[0].principle_name).toBe("Building Rapport Through Common Ground");
    expect(rankFriendPrinciplesForStage(pool, "intent").at(-1)!.principle_name).toBe("The 4-Step Nonchalant Closing Framework");
    expect(rankFriendPrinciplesForStage(pool, "logical_certainty")).toEqual(pool);
  });

  it("allows one question back when the prospect asked us a question (real Amanda message)", () => {
    const convo = [
      { direction: "outbound", content: "Hey Amanda! Love your post. How long have you been building?" },
      { direction: "inbound", content: "I have had to make a few adjustments and use my time wisely. How is everything going for you?" },
    ];
    const reply = "Doing good! Juggling it around my 9-5 took me a while too 😅 What are you working on right now?";
    expect(friendHygieneIssues(reply, convo).some((i) => i.startsWith("asks again"))).toBe(false);
    const noQuestionFromThem = [convo[0], { direction: "inbound", content: "About a year now." }];
    expect(friendHygieneIssues(reply, noQuestionFromThem).some((i) => i.startsWith("asks again"))).toBe(true);
  });
});
