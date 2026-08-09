import { describe, it, expect } from "vitest";
import { buildSourcePassages, chunkText, dedupePrinciples, detectChapters, formatTranscriptSegments, mapVariantToSuggestion, prepareBookSections } from "../../supabase/functions/process-knowledge/lib";

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

describe("source passage preservation", () => {
  it("keeps PDF page locations on retrieval-sized passages", () => {
    const text = [
      "=== Page 1 ===\n" + "Trust is earned through specific evidence. ".repeat(90),
      "=== Page 2 ===\n" + "Handle price by returning to the cost of the problem. ".repeat(90),
    ].join("\n\n");
    const passages = buildSourcePassages(text, { chunkSize: 2200, overlap: 200 });

    expect(passages.length).toBeGreaterThan(2);
    expect(passages.some((p) => p.metadata.page_start === 1)).toBe(true);
    expect(passages.some((p) => p.metadata.page_end === 2)).toBe(true);
    expect(passages.every((p) => p.content.length > 80)).toBe(true);
  });

  it("preserves transcript timestamps for later citations", () => {
    const transcript = formatTranscriptSegments([
      { start: 0, text: "Open with a specific observation." },
      { start: 75, text: "Then ask a low-pressure question." },
    ]);
    expect(transcript).toContain("[00:00] Open with");
    expect(transcript).toContain("[01:15] Then ask");

    const passages = buildSourcePassages(transcript, { chunkSize: 1200 });
    expect(passages[0].metadata.timestamp_start).toBe("00:00");
    expect(passages[0].metadata.timestamp_end).toBe("01:15");
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

describe("detectChapters", () => {
  it("does not treat numbered sales bullets as separate chapters", () => {
    const content = [
      "CHAPTER 1: MONEY OBJECTIONS\n" + "Value frame. ".repeat(400),
      "1. It refuses biased certainty\n" + "Bullet explanation. ".repeat(80),
      "2. It tests urgency\n" + "Bullet explanation. ".repeat(80),
      "CHAPTER 2: TRUST OBJECTIONS\n" + "Trust frame. ".repeat(400),
    ].join("\n\n");
    const out = detectChapters(content, 12000);
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 1: MONEY OBJECTIONS", "CHAPTER 2: TRUST OBJECTIONS"]);
  });

  it("splits oversized detected parts into safe processing sections", () => {
    const content = [
      "PART 1: THE FOUNDATION\n" + "Foundation sentence. ".repeat(1800),
      "PART 2: THE METHOD\n" + "Method sentence. ".repeat(1800),
    ].join("\n\n");
    const out = prepareBookSections(content, 12000);
    expect(out.length).toBeGreaterThan(2);
    expect(Math.max(...out.map((c) => c.text.length))).toBeLessThanOrEqual(13000);
  });
});
