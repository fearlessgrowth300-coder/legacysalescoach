import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bestMatchingPassage } from "./friend-knowledge-search.ts";

Deno.test("picks the passage that matches the lesson, none when unrelated", () => {
  const passages = ["We talked about the weather and lunch plans today.", "Find the gap between where the prospect is now, point A, and where they want to be, point B. No gap, no sale."];
  assertEquals(bestMatchingPassage(passages, "The Gap Analysis Framework: distance between current reality point A and desired future point B"), passages[1]);
  assertEquals(bestMatchingPassage(["Totally unrelated cooking text."], "gap analysis point prospect"), null);
});
