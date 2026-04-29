import { describe, it, expect } from "vitest";
import { chunkText, dedupePrinciples, mapVariantToSuggestion } from "../../supabase/functions/process-knowledge/lib";

describe("chunkText (true 10k chunking)", () => {
  it("returns the whole string when shorter than chunk size", () => {
    const out = chunkText("hello world", 10000);
    expect(out).toEqual(["hello world"]);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkText("", 10000)).toEqual([]);
  });

  it("splits a long string into ~10k pieces and keeps full coverage", () => {
    // 35,000 chars of repeated sentences → must produce >=4 chunks
    const sentence = "This is a clean sentence about sales psychology. ";
    const long = sentence.repeat(800); // ~40k chars
    const chunks = chunkText(long, 10000);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(10001);
    }
    // Concatenation should preserve all original content (allowing trims)
    const rejoined = chunks.join(" ");
    expect(rejoined.length).toBeGreaterThan(long.length * 0.95);
  });

  it("prefers sentence boundaries over hard cuts", () => {
    const a = "A".repeat(9000) + ". ";
    const b = "B".repeat(9000) + ". ";
    const chunks = chunkText(a + b, 10000);
    // First chunk should end at the sentence boundary, not mid-A
    expect(chunks[0].endsWith(".")).toBe(true);
  });
});

describe("dedupePrinciples", () => {
  it("keeps a single entry per principle_name (case-insensitive)", () => {
    const input = [
      { principle_name: "Mirror Then Label", what_i_learned: "short" },
      { principle_name: "mirror then label", what_i_learned: "much much longer richer detail here" },
      { principle_name: "Pre-Frame", what_i_learned: "x" },
    ];
    const out = dedupePrinciples(input);
    expect(out.length).toBe(2);
    const mirror = out.find(p => p.principle_name.toLowerCase() === "mirror then label");
    // Should keep the richer (longer) entry
    expect(mirror?.what_i_learned).toMatch(/much much longer/);
  });

  it("ignores empty principle names", () => {
    const out = dedupePrinciples([{ principle_name: "" }, { principle_name: "  " }]);
    expect(out).toEqual([]);
  });
});

describe("mapVariantToSuggestion (citation contract)", () => {
  it("maps cited_principle_name and cited_source_name from the edge function payload", () => {
    const edgePayload = {
      variant: "primary",
      message: "Hey — quick one. What's the actual pain right now?",
      move_used: "empathy_mirror",
      principle_applied: "Voss Mirroring",
      cited_principle_name: "Tactical Empathy Mirror",
      cited_source_name: "Chris Voss — Never Split the Difference",
      why_this_works: "Mirrors back the prospect's last words.",
      warmth_prediction: 62,
    };
    const s = mapVariantToSuggestion(edgePayload, 7);
    expect(s.id).toBe(7);
    expect(s.citedPrincipleName).toBe("Tactical Empathy Mirror");
    expect(s.citedSourceName).toBe("Chris Voss — Never Split the Difference");
    expect(s.text).toContain("quick one");
  });

  it("returns null cited fields when the AI omits them", () => {
    const s = mapVariantToSuggestion({ variant: "primary", message: "hi" });
    expect(s.citedPrincipleName).toBeNull();
    expect(s.citedSourceName).toBeNull();
  });
});
