import { describe, expect, it } from "vitest";
import {
  friendHygieneIssues,
  friendNoPitchReasons,
  friendSellerEvidence,
  isSoftFriendIssue,
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

  it("stops the pitch after a real no, and treats it as strict", () => {
    const convo = [{ direction: "inbound", content: "I'm working with a mentor currently but that's great it is working for you!" }];
    const issues = friendHygieneIssues("Love that! I actually found a mentor who rebuilt my funnel, want the link?", convo);
    const pitch = issues.find((i) => i.startsWith("pitches after"));
    expect(pitch).toContain("already has a mentor");
    expect(isSoftFriendIssue(pitch!)).toBe(false);
    expect(friendHygieneIssues("That's so good to hear, having support makes such a difference 💜", convo).some((i) => i.startsWith("pitches"))).toBe(false);
  });

  it("reads real no-signals", () => {
    expect(friendNoPitchReasons(["I dnt have the funds right now"])).toContain("has no funds");
    expect(friendNoPitchReasons(["It sounds like this might be more for MLM content creators"])).toContain("is worried it is MLM or a scam");
    expect(friendNoPitchReasons(["Not yet😊 I'm not really pushing for sales with this page right now."])).toContain("is not focused on selling");
    expect(friendNoPitchReasons(["No sales yet, I keep posting reels but nothing"])).toEqual([]);
  });

  it("flags sellers but not stuck beginners", () => {
    expect(friendSellerEvidence(["But I'm a digital marketer too like you so I got other pages where I post n guide people through that too"])).toBeTruthy();
    expect(friendSellerEvidence(["I'm already earning from my travel business and residually from the network marketing side."])).toBeTruthy();
    expect(friendSellerEvidence(["I bought DWA but have no sales yet and I'm overwhelmed by the modules"])).toBeNull();
  });

  it("flags sellers from their bio before the first DM (real bios)", () => {
    expect(friendSellerEvidence(["🚀MAMA turning naptime into income Helping New Digital Marketers build Faceless income online 3figure in 7 weeks 🎁 Grab My Free Guide below ↓"])).toBeTruthy();
    expect(friendSellerEvidence(["Digital creator | This mum is building wealth 💛 Faceless digital marketing 💰0-$499 on day 12 ✨ DM INFO For mums who wants more"])).toBeTruthy();
    expect(friendSellerEvidence(["Building my second shift after 9-5 💛✨ Getting unstuck & helping YOU do the same. Better messaging • Less guessing"])).toBeTruthy();
    expect(friendSellerEvidence(["Mom of 3 | learning digital marketing | coffee lover ☕ | 0 sales but not giving up"])).toBeNull();
  });
});
