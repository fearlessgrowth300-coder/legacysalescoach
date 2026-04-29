// Deno-only PDF extraction helpers. Kept in a separate file from lib.ts so the
// Vitest (node) suite that imports lib.ts doesn't choke on `npm:` specifiers.
//
// === Why unpdf and not pdf-parse / Gemini-as-PDF-reader ===
// We previously sent PDFs to Gemini Flash via `image_url` because the Lovable
// AI gateway accepts `data:application/pdf;base64,...` and "just works" for
// small files. It does NOT scale: the model OCRs every page, the gateway has
// a hard ~150s idle timeout, and large books (3 MB+) reliably time out.
// `pdf-parse` is the obvious Node alternative but depends on Node's `fs` and a
// debug-mode test fixture path — it doesn't run on Deno edge runtime.
// `unpdf` is the Deno/Workers-compatible wrapper around Mozilla's pdf.js and
// runs locally in milliseconds for born-digital PDFs (no network, no token
// budget). Do not regress to `image_url` PDFs unless you also add chunked,
// page-by-page Gemini calls with a real timeout budget per page.

import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

// Pure-bytes-in / text-out so this is unit-testable without Storage.
// Returns text with `=== Page N ===` separators preserved so downstream
// chapter detection still works, plus a meta object the caller can use to
// decide whether to fall back to OCR.
export async function extractPdfBytes(
  bytes: Uint8Array,
): Promise<{ text: string; pageCount: number }> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
    const pageArr = Array.isArray(pages) ? pages : [String(pages || "")];
    const text = pageArr
      .map((p, i) => `=== Page ${i + 1} ===\n${(p || "").trim()}`)
      .join("\n\n")
      .trim();
    return { text, pageCount: totalPages || pageArr.length };
  } catch (e) {
    console.warn("unpdf extraction failed:", e instanceof Error ? e.message : e);
    return { text: "", pageCount: 0 };
  }
}

// Heuristic: a born-digital PDF gives us hundreds of chars per MB. Anything
// less almost certainly means the file is a scanned image and we need OCR.
// Exported so it can be unit-tested in isolation.
export function looksScanned(textLength: number, fileSizeBytes: number): boolean {
  const sizeMB = Math.max(0.1, fileSizeBytes / 1024 / 1024);
  return textLength < Math.max(200, 200 * sizeMB);
}

// Render PDF pages to PNG via pdf.js (unpdf re-exports it) and OCR each one
// through OpenAI vision. Stays under the edge function budget by capping
// pages at 50 and timing out per-page.
export async function ocrPdfWithVision(
  bytes: Uint8Array,
  apiKey: string,
  maxPages = 50,
): Promise<string> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    console.warn("OCR fallback unavailable: OPENAI_API_KEY missing");
    return "";
  }

  let renderPageAsImage: any;
  try {
    const mod = await import("npm:unpdf@0.12.1");
    renderPageAsImage = (mod as any).renderPageAsImage;
  } catch (e) {
    console.warn("unpdf renderPageAsImage import failed:", e);
    return "";
  }

  const pdf = await getDocumentProxy(bytes);
  const totalPages = Math.min(pdf.numPages || 0, maxPages);
  if (totalPages === 0) return "";

  const out: string[] = [];
  for (let p = 1; p <= totalPages; p++) {
    try {
      const png: ArrayBuffer = await renderPageAsImage(bytes, p, { scale: 1.5 });
      const b64 = arrayBufferToBase64(png);
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Transcribe ALL visible text from this page exactly. Return plain text only, no commentary." },
              { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
            ],
          }],
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        await resp.text();
        console.warn(`OCR page ${p} failed: ${resp.status}`);
        continue;
      }
      const j = await resp.json();
      const pageText = j.choices?.[0]?.message?.content || "";
      out.push(`=== Page ${p} ===\n${pageText}`);
    } catch (e) {
      console.warn(`OCR page ${p} threw:`, e instanceof Error ? e.message : e);
    }
  }
  return out.join("\n\n").trim();
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 32768;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(bin);
}
