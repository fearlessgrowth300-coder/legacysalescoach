import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { friendStalledSetIssue } from "./friend-conversation-engine.ts";
import { bestMatchingPassage } from "./friend-knowledge-search.ts";

// Real 2026-10-04 Friend reply set: all three close the topic.
const amanda = [{ direction: "inbound", content: "Hi Brianna! Thank you for the follow! I have had to make a few adjustments and use my time wisely. How is everything going for you?" }];
const stalled = [
  "Doing good over here, thanks! And good for you for getting that daily routine dialed in.",
  "Doing really well over here, thank you! It definitely takes some discipline to shift the routine around.",
  "Things are going great on my end, thanks for asking!",
];

Deno.test("flags a reply set where nothing keeps the chat going", () => {
  const issue = friendStalledSetIssue(stalled, "past_experience", amanda);
  assert(issue?.includes("past_experience"));
});

Deno.test("silent when a variant asks, the prospect disengages, or we already asked twice", () => {
  assertEquals(friendStalledSetIssue([...stalled.slice(0, 2), "Doing good! What's been the biggest thing you had to shift?"], "past_experience", amanda), null);
  assertEquals(friendStalledSetIssue(stalled, "past_experience", [{ direction: "inbound", content: "not interested, thanks" }]), null);
  assertEquals(friendStalledSetIssue(stalled, "past_experience", [
    { direction: "outbound", content: "How long have you been at it?" },
    { direction: "inbound", content: "a year" },
    { direction: "outbound", content: "What made you start?" },
  ]), null);
  assertEquals(friendStalledSetIssue(stalled, "complete", amanda), null);
});

Deno.test("picks the passage that matches the lesson, none when unrelated", () => {
  const passages = ["We talked about the weather and lunch plans today.", "Find the gap between where the prospect is now, point A, and where they want to be, point B. No gap, no sale."];
  assertEquals(bestMatchingPassage(passages, "The Gap Analysis Framework: distance between current reality point A and desired future point B"), passages[1]);
  assertEquals(bestMatchingPassage(["Totally unrelated cooking text."], "gap analysis point prospect"), null);
});
