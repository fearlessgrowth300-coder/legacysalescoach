// Regression test for the PDF text extractor.
// Asserts: extraction completes well under 60s, produces meaningful text, and
// preserves the `=== Page N ===` markers chapter detection relies on.
//
// Run with: supabase--test_edge_functions { functions: ["process-knowledge"] }

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractPdfBytes, looksScanned } from "./pdf-extract.ts";

Deno.test("extractPdfBytes: born-digital PDF extracts under 60s with page markers", async () => {
  const url = new URL("./__fixtures__/sample.pdf", import.meta.url);
  const bytes = new Uint8Array(await Deno.readFile(url));

  const start = Date.now();
  const { text, pageCount } = await extractPdfBytes(bytes);
  const elapsedMs = Date.now() - start;

  assert(elapsedMs < 60_000, `extraction took ${elapsedMs}ms (>60s budget)`);
  assertEquals(pageCount, 3, `expected 3 pages, got ${pageCount}`);
  assert(text.length > 200, `expected >200 chars, got ${text.length}`);
  assert(text.includes("=== Page 1 ==="), "missing Page 1 marker");
  assert(text.includes("=== Page 3 ==="), "missing Page 3 marker");
  assert(/Chapter\s+1/i.test(text), "missing 'Chapter 1' heading");
});

Deno.test("looksScanned: born-digital text is NOT flagged as scanned", () => {
  // 50KB file with 5000 chars of text → 100 chars/KB ≈ 100k/MB → not scanned
  assertEquals(looksScanned(5000, 50 * 1024), false);
});

Deno.test("looksScanned: image-only PDF IS flagged as scanned", () => {
  // 2MB file with only 50 chars → clearly scanned
  assertEquals(looksScanned(50, 2 * 1024 * 1024), true);
});
