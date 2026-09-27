import { describe, expect, it } from "vitest";
import { deduplicateChunks, deduplicatePrinciples } from "../../supabase/functions/_shared/dedup";

describe("bounded-cost knowledge deduplication", () => {
  it("keeps the strongest copy of a repeated source passage", () => {
    const content = "Ask about the actual concern before choosing proof for this buyer.";
    const chunks = [
      { id: "first", content, relevance_score: 30 },
      { id: "unrelated", content: "A different passage about timing and a customer's preferred next step.", relevance_score: 50 },
      { id: "stronger", content, relevance_score: 90 },
    ];
    expect(deduplicateChunks(chunks).map(chunk => chunk.id)).toEqual(["stronger", "unrelated"]);
  });

  it("updates the similarity index when a stronger passage replaces an earlier one", () => {
    const chunks = [
      { id: "original", content: "Listen closely to the buyer and ask about their concern before offering any proof.", relevance_score: 10 },
      { id: "replacement", content: "Listen closely to the buyer and ask about their concern before offering relevant proof.", relevance_score: 80 },
      { id: "repeat", content: "Listen closely to the buyer and ask about their concern before offering relevant proof.", relevance_score: 20 },
    ];
    expect(deduplicateChunks(chunks).map(chunk => chunk.id)).toEqual(["replacement"]);
  });

  it("retains distinct principles while deduplicating repeated lessons", () => {
    const principles = [
      { id: "a", principle_name: "Clarify the concern", what_i_learned: "Ask what the buyer is uncertain about before choosing proof.", relevance_score: 20 },
      { id: "b", principle_name: "Clarify the concern", what_i_learned: "Ask what the buyer is uncertain about before choosing proof.", relevance_score: 70 },
      { id: "c", principle_name: "Respect the no", what_i_learned: "Stop following up after a clear refusal.", relevance_score: 40 },
    ];
    expect(deduplicatePrinciples(principles).map(principle => principle.id)).toEqual(["b", "c"]);
  });
});
