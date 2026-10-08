import { describe, expect, it } from "vitest";
import {
  friendHardDecline,
  friendReciprocityIssue,
  promoteReciprocalVariant,
  friendHygieneIssues,
  friendObjections,
  isSoftFriendIssue,
  rankFriendPrinciplesForStage,
  rankOpenerPrinciples,
  sentLineSet,
  sharesOwnDetail,
} from "../../supabase/functions/_shared/friend-conversation-engine";

// Lines and replies taken from the real Friend conversations reviewed on 2026-10-04.
const sent = sentLineSet(["Love that! What made you decide to build around that? Tell me more."]);

describe("Friend conversation hygiene", () => {
  it("flags a stock line already sent to other prospects", () => {
    const issues = friendHygieneIssues("Oh nice. What made you decide to build around that?", [], sent);
    expect(issues.some((issue) => issue.startsWith("reuses a line"))).toBe(true);
    expect(friendHygieneIssues("Oh nice, how did you get into it?", [], sent).some((i) => i.startsWith("reuses"))).toBe(false);
  });

  it("wants every reply to end with a question, even right after ours (owner rule 2026-10-08)", () => {
    const convo = [{ direction: "outbound", content: "How long have you been at it?" }, { direction: "inbound", content: "About a year now, slowly growing my page" }];
    expect(friendHygieneIssues("That's awesome! What got you started? 😊", convo).some((i) => i.startsWith("doesn't end with a question"))).toBe(false);
    expect(friendHygieneIssues("A year is solid, I remember how slow the start felt for me too 😅", convo).some((i) => i.startsWith("doesn't end with a question"))).toBe(true);
    expect(friendHygieneIssues("Got it, take care.", [{ direction: "inbound", content: "Not interested, stop messaging me" }]).some((i) => i.startsWith("doesn't end"))).toBe(false);
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
    expect(friendHygieneIssues(reply, convo).some((i) => i.startsWith("doesn't end"))).toBe(false);
    const noQuestionFromThem = [convo[0], { direction: "inbound", content: "About a year now." }];
    expect(friendHygieneIssues(reply, noQuestionFromThem).some((i) => i.startsWith("doesn't end"))).toBe(false);
  });

  it("asks for a question back when the prospect asked us one and no reply does (2026-10-05 Amanda replies)", () => {
    const convo = [
      { direction: "outbound", content: "Are you finding it tricky balancing building this out with your main job?" },
      { direction: "inbound", content: "I wouldn't say it's tricky but I've made a few adjustments. How is everything going for you?" },
    ];
    const replies = [
      "Things are going great on my end, thank you! Finding that groove with your daily schedule is honestly half the battle.",
      "Doing really well over here, thanks for asking! Love that you've already found a rhythm that works for you.",
      "Doing good over here, thanks! Getting that daily routine dialed in is half the battle.",
    ];
    const issue = friendReciprocityIssue(replies, convo);
    expect(issue).toBeTruthy();
    expect(isSoftFriendIssue(issue!)).toBe(true);
    expect(friendReciprocityIssue([...replies.slice(0, 2), "Doing good! Juggling it around my 9-5 took me a while too 😅 What are you working on right now?"], convo)).toBeNull();
    expect(friendReciprocityIssue(replies, [{ direction: "inbound", content: "About a year now." }])).toBeNull();
    expect(friendReciprocityIssue(replies, [{ direction: "inbound", content: "Not interested, stop messaging me?" }])).toBeNull();
  });

  it("asks for a real Brianna detail when replies ask back but only say 'doing great' (2026-10-05 04:56 Amanda set)", () => {
    const convo = [{ direction: "inbound", content: "I've had to make a few adjustments. How is everything going for you?" }];
    const replies = [
      "Things are going great on my end, thank you! It definitely takes some discipline to shift the routine around, so love that you've already found a rhythm that works. Where are you at with your store setup or content strategy these days?",
      "Doing really well over here, thanks for asking! Finding that groove with your daily schedule is honestly half the battle when you're building something on the side. What kind of setup or approach are you currently focusing on right now?",
      "Doing good over here, thanks! And honestly good for you for getting that daily routine dialed in. What are you working on building out first?",
    ];
    const issue = friendReciprocityIssue(replies, convo);
    expect(issue).toMatch(/^doesn't share a real Brianna detail/);
    expect(isSoftFriendIssue(issue!)).toBe(true);
    const withDetail = "Doing good! I finally stopped trying to do everything and stuck to one system, and it’s made such a difference. What are you building out first?";
    expect(sharesOwnDetail(withDetail)).toBe(true);
    expect(friendReciprocityIssue([replies[0], withDetail], convo)).toBeNull();
    const out = promoteReciprocalVariant(replies.map((message, i) => ({ variant: ["primary", "alternative", "casual"][i], message })).slice(0, 2).concat({ variant: "casual", message: withDetail }), convo);
    expect(out[0].message).toBe(withDetail);
  });

  it("flags a reply with no closing question (2026-10-08 Katie: three good replies, none asked anything)", () => {
    const convo = [
      { direction: "outbound", content: "How has building a neurospicy-friendly setup been going for you so far?" },
      { direction: "inbound", content: "Trial and error, but I make the business work around my brain now. I keep things sooo much simpler." },
    ];
    const dead = "That's honestly such a healthy way to look at it. Dropping the guilt and keeping one simple system made such a difference for me too.";
    expect(friendHygieneIssues(dead, convo).some((i) => i.startsWith("doesn't end with a question"))).toBe(true);
    expect(isSoftFriendIssue("doesn't end with a question: x")).toBe(true);
    const asks = "Same for me, one simple system changed everything \u{1F90D} What does a low-energy day look like for you?";
    expect(friendHygieneIssues(asks, convo).some((i) => i.startsWith("doesn't end"))).toBe(false);
  });

  it("rotates away from the lesson locked on recent replies", () => {
    const pool = [
      { id: "cf", principle_name: "Conversational Fluidity over Script Adherence" },
      { id: "rap", principle_name: "Building Rapport Through Common Ground" },
      { id: "story", principle_name: "Personal Story Bridge" },
    ];
    expect(rankFriendPrinciplesForStage(pool, "intent", { rap: 4 })[0].id).toBe("story");
    expect(rankFriendPrinciplesForStage(pool, "logical_certainty", { cf: 3 })[0].id).toBe("rap");
  });

  it("never locks a post-purchase lesson for a Friend prospect (2026-10-05 05:52 Katie)", () => {
    const pool = [
      { id: "pp", principle_name: "The Post-Purchase Review Solicitation Framework", category: "Follow Up", when_to_use: "Immediately after delivering a product or service to a customer." },
      { id: "story", principle_name: "Personal Story Bridge" },
    ];
    expect(rankFriendPrinciplesForStage(pool, "emotional_certainty")[0].id).toBe("story");
    expect(rankFriendPrinciplesForStage(pool, "intent")[0].id).toBe("story");
  });

  it("puts a reply that asks back first when the prospect asked us (2026-10-05 04:39 set)", () => {
    const convo = [{ direction: "inbound", content: "I've made a few adjustments and use my time wisely. How is everything going for you?" }];
    const variants = [
      { variant: "primary", message: "Things are going great on my end, thanks for asking! Finding that groove is half the battle." },
      { variant: "alternative", message: "Doing well, thank you 😊 What has made the biggest difference?" },
      { variant: "casual", message: "I'm good! What changed in how you plan your time?" },
    ];
    const out = promoteReciprocalVariant(variants, convo);
    expect(out[0].message).toContain("What has made the biggest difference?");
    expect(out.map((v) => v.variant)).toEqual(["primary", "alternative", "casual"]);
    expect(promoteReciprocalVariant(variants, [{ direction: "inbound", content: "About a year now." }])).toBe(variants);
  });

  it("treats 'not anchored to the prospect fact' as a rewrite, not a reason for the generic fallback", () => {
    expect(isSoftFriendIssue("reply is not anchored to the locked prospect fact")).toBe(true);
    expect(isSoftFriendIssue("pitches after the prospect explicitly declined; respect it")).toBe(false);
  });
});
