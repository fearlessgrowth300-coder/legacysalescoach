import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { responseCitesUnknownPrinciples, responseMentionsUnknownSources } from "./lib.ts";
import { collapseSimilarPrincipleNames } from "../_shared/dedup.ts";

// Real 2026-10-02 answer: blended/renamed principles cited from "OBJECTION CRUSHER (1)".
const retrieved = ["The Boat Story Reframe", "Symptom vs. Problem Frame", "The Refundable Deposit Commitment"];

Deno.test("flags renamed or merged principle names, keeps exact ones", () => {
  const answer = `1. **The Refundable Deposit Commitment / Identity Reframing** (Source: *"OBJECTION CRUSHER (1)"*).
2. **Downsell / Payment Anchor Framing** (Source: *"OBJECTION CRUSHER (1)"*).
3. **Symptom vs Problem Frame** (Source: "OBJECTION CRUSHER (1)")`;
  assertEquals(responseCitesUnknownPrinciples(answer, retrieved), [
    "The Refundable Deposit Commitment / Identity Reframing",
    "Downsell / Payment Anchor Framing",
  ]);
  assertEquals(responseCitesUnknownPrinciples(`**Refundable Deposit Commitment** (Source: "X")`, retrieved), []);
});

Deno.test("source check sees titles wrapped in Markdown emphasis", () => {
  assertEquals(responseMentionsUnknownSources(`(Source: *"Made Up Book"*)`, ["OBJECTION CRUSHER (1)"]), ["Made Up Book"]);
  assertEquals(responseMentionsUnknownSources(`(Source: *"OBJECTION CRUSHER (1)"*)`, ["OBJECTION CRUSHER (1)"]), []);
});

Deno.test("collapses renamed copies within a source, keeps distinct ideas and other sources", () => {
  const rows = [
    { id: "1", principle_name: "Identity Labeling", source_id: "oc" },
    { id: "2", principle_name: "Identity Labeling for Conversion", source_id: "oc" },
    { id: "3", principle_name: "The Identity Fork", source_id: "oc" },
    { id: "4", principle_name: "Identity Forking", source_id: "oc" },
    { id: "5", principle_name: "Identity Shift", source_id: "oc" },
    { id: "6", principle_name: "Identity Labeling", source_id: "zig" },
  ];
  assertEquals(collapseSimilarPrincipleNames(rows).map((r) => r.id), ["1", "3", "5", "6"]);
});
