import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { describeApiKey, getLatestUserApiKey } from "../_shared/api-key-utils.ts";
import { extractPdfBytes, looksScanned, ocrPdfWithVision } from "./pdf-extract.ts";

const defaultCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ===== EMBEDDING GENERATION (OpenAI text-embedding-3-small, 768 dims) =====
async function generateEmbedding(text: string, _apiKey: string): Promise<number[] | null> {
  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return null;
    const truncated = (text || "").substring(0, 32000);
    if (truncated.length < 5) return null;
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: truncated, dimensions: 768 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) { await r.text(); return null; }
    const d = await r.json();
    return d.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("Embedding failed:", e);
    return null;
  }
}

// ===== PASS 1: TRANSCRIPT CLEANING =====
// One job: fix punctuation, paragraph breaks, strip filler, label speaker shifts.
// No extraction. No JSON. Plain readable text out.
async function cleanTranscriptChunk(rawChunk: string, apiKey: string): Promise<string> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a transcript cleaner. ONE JOB: produce a clean, readable version of the transcript below.

RULES:
1. Fix punctuation (periods, commas, question marks).
2. Add paragraph breaks at natural topic shifts.
3. Remove filler words: "um", "uh", "like", "you know", "I mean", "sort of", "kind of", "right?", "okay so".
4. If you detect a speaker change, prefix the new block with "Speaker:" (or "Host:" / "Guest:" if obvious).
5. Preserve every idea, technique, story, number, script, and exact quote. DO NOT summarise. DO NOT shorten. DO NOT extract.
6. Output PLAIN TEXT only. No JSON. No markdown headings. No commentary.`,
          },
          { role: "user", content: rawChunk },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) {
      console.error("Cleaning pass failed:", r.status);
      return rawChunk; // fallback to raw
    }
    const d = await r.json();
    const cleaned = d.choices?.[0]?.message?.content || "";
    return cleaned.length > rawChunk.length * 0.4 ? cleaned : rawChunk;
  } catch (e) {
    console.error("Cleaning pass exception:", e);
    return rawChunk;
  }
}

// ===== STRUCTURED LEARNINGS EXTRACTION =====
async function extractStructuredLearningsChunk(
  content: string,
  sourceName: string,
  apiKey: string,
  chunkIndex: number,
  totalChunks: number,
  options: { timeoutMs?: number; maxTokens?: number; maxPrinciples?: number } = {},
): Promise<any[]> {
  try {
    const chunkLabel = totalChunks > 1 ? ` (Part ${chunkIndex + 1}/${totalChunks})` : "";
    const maxPrinciples = options.maxPrinciples ?? 12;
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an elite sales student watching this video / reading this material for the first time. Your job is to extract EVERYTHING valuable — every insight, technique, script, story, warning, and principle — as if you are the most obsessive note-taker who has ever studied sales.

You will be given a TRANSCRIPT CHUNK from a video or document.

Extract the highest-value distinct learnings from this chunk. Return at most ${maxPrinciples} principles. Prioritize actionable scripts, warnings, frameworks, psychology, and prospecting moves over repeated ideas.

For EVERY learning you extract, return it in this exact JSON structure:

{
  "principle_name": "[Short memorable name for this technique or insight]",
  
  "category": "[One of: Prospecting | Opening | Trust Building | Objection Handling | 
               Closing | Follow Up | Mindset | Script | Story | Warning | Framework | 
               Psychology | Marketing | Leadership | Pricing | DM Outreach | 
               Social Media | Referral | Tonality | Body Language | Energy]",
  
  "what_i_learned": "[The full insight as if writing it in your own notes — 
                     not just a headline. Capture the complete idea including 
                     any context, nuance, or detail the speaker gave. 
                     Minimum 3 sentences.]",
  
  "the_deep_why": "[WHY does this work on human psychology? What is happening 
                   in the prospect's brain, emotions, or decision-making when 
                   this technique is used? This is the psychological mechanism 
                   behind the technique.]",
  
  "how_to_apply": "[Step-by-step practical application. Not vague advice — 
                   specific actionable steps someone can follow TODAY. 
                   Minimum 3 steps.]",
  
  "exact_words_to_use": "[If the speaker gave any exact phrases, scripts, 
                         sentences, or word-for-word lines — capture them 
                         here exactly as said. If no exact words given, 
                         write the closest natural script for applying 
                         this technique. Always write as spoken dialogue.]",
  
  "words_to_never_use": "[Phrases, words, or approaches the speaker warned 
                         against — or that would sabotage this technique. 
                         If not mentioned, infer from context what would 
                         go wrong.]",
  
  "real_example_or_story": "[Any story, case study, example, or scenario 
                            the speaker used to illustrate this. If they 
                            gave a real example, capture it fully. 
                            If not, write a concrete realistic example 
                            of this technique in action.]",
  
  "when_to_use": "[The exact situation, moment, or trigger that calls for 
                  this technique. Be specific — what has the prospect said 
                  or done that signals this is the right move?]",
  
  "when_not_to_use": "[Situations where this would backfire. What context 
                      makes this the wrong move?]",
  
  "common_mistake": "[The most common way people get this wrong — and what 
                     happens when they do.]",
  
  "power_level": "[1-10 rating of how high-impact this technique is for 
                  converting a prospect]",
  
  "works_best_for": "[Which type of prospect or situation this is most 
                     powerful for — e.g. price objectors, warm leads, 
                     cold DMs, phone calls, in-person]",
  
  "connected_principles": "[Names of other techniques or principles this 
                            connects to or should be used alongside]",

  "trigger_phrases": "[3-5 key words or phrases that should trigger retrieval 
                      of this principle when someone asks about it]"
}

---

EXTRACTION RULES:

1. NEVER summarise multiple ideas into one principle. Each distinct idea gets its own entry. If the speaker makes 8 points — extract 8.

2. CAPTURE EXACT QUOTES. If the speaker says a specific sentence or script — capture it word for word in exact_words_to_use. These are gold. Do not paraphrase them.

3. EXTRACT STORIES FULLY. If the speaker tells a story or example — that story is a principle in itself. Extract it as its own entry with category "Story" and capture the full narrative.

4. EXTRACT WARNINGS. If the speaker says "never do this" or "the mistake people make is" — that is its own principle entry with category "Warning."

5. EXTRACT FRAMEWORKS. If the speaker describes a multi-step system, formula, or framework — extract the full framework as one entry AND extract each step as its own entry.

6. NUMBERS AND STATISTICS matter. If the speaker gives a stat like "80% of sales happen on the 5th follow up" — capture it in what_i_learned and use it in the script.

7. TONALITY AND ENERGY cues. If the speaker talks about HOW to say something — the tone, pace, energy, pause — capture that as its own entry with category "Tonality."

8. MINDSET SHIFTS. Any belief, mindset, or identity shift the speaker describes gets its own entry with category "Mindset."

---

Return a single JSON object with this exact shape: { "principles": [ ...principle objects... ] }. No extra text. No markdown. No code fences. Always include the "principles" key even if you only extract one item. Extract 3-${maxPrinciples} strong principles; do not exceed ${maxPrinciples}.`,
          },
          {
            role: "user",
            content: `Extract ALL learnings from this material titled "${sourceName}"${chunkLabel}:\n\n${content}`,
          },
        ],
        temperature: 0.3,
        // Keep output bounded so one difficult PDF chapter cannot outlive the
        // Edge background-task wall clock and leave the book stuck in extracting.
        max_tokens: options.maxTokens ?? 8000,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("Structured learnings API error:", response.status, errBody.substring(0, 500));
      return [];
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "";
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      console.warn(
        `Pass 2 output truncated by token cap (finish_reason=length, ${aiContent.length} chars). Salvaging partial principles via brace-counter.`,
      );
    }
    if (!aiContent || aiContent.length < 5) {
      console.warn("Empty AI extraction response. Full payload keys:", Object.keys(data || {}));
      return [];
    }
    const parsed = parsePrinciplesJson(aiContent);
    if (parsed.length === 0) {
      console.warn(
        `Pass 2 returned 0 principles (finish_reason=${finishReason}). Raw AI output (first 800 chars): ${aiContent.substring(0, 800)}`,
      );
    } else if (finishReason === "length") {
      console.log(`Pass 2 salvaged ${parsed.length} principles from truncated output.`);
    }
    return parsed;
  } catch (e) {
    console.error("Structured learnings extraction failed:", e);
    return [];
  }
}

// Robust JSON-array parser for AI extraction output.
// Handles: ```json fences, wrapping objects { "principles": [...] }, smart
// quotes, trailing commas, and an array embedded anywhere in the response.
function parsePrinciplesJson(raw: string): any[] {
  if (!raw) return [];
  let s = raw.trim();

  // Strip code fences
  s = s.replace(/^```(?:json|JSON)?\s*/i, "").replace(/```\s*$/i, "").trim();

  // Normalize smart quotes → ASCII quotes
  s = s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  const tryParse = (txt: string): any[] | null => {
    try {
      const v = JSON.parse(txt);
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") {
        // Common wrapper shapes
        for (const key of ["principles", "learnings", "items", "results", "data", "extractions"]) {
          if (Array.isArray(v[key])) return v[key];
        }
        // If it looks like a single principle object, wrap it
        if (v.principle_name || v.what_i_learned) return [v];
      }
      return null;
    } catch {
      return null;
    }
  };

  // 1. Try the whole string
  let result = tryParse(s);
  if (result) return result;

  // 2. Try after stripping control chars + trailing commas
  const cleaned = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").replace(/,\s*([}\]])/g, "$1");
  result = tryParse(cleaned);
  if (result) return result;

  // 3. Find the outermost JSON array via brace counting
  const arrStart = cleaned.indexOf("[");
  if (arrStart !== -1) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = arrStart; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.substring(arrStart, i + 1);
          result = tryParse(candidate);
          if (result) return result;
          break;
        }
      }
    }
  }

  // 4. Salvage principle objects from anywhere in the buffer (depth-aware).
  // CRITICAL: when the model returns `{ "principles": [ {...}, {...}, ...truncated` the
  // outer wrapper `{` never closes, so depth-0-only salvage finds nothing. We track
  // the start of EVERY balanced `{...}` regardless of nesting depth, then keep the
  // ones that look like principles. Works for both wrapper-truncated and
  // wrapper-less responses.
  const objects: any[] = [];
  const starts: number[] = []; // stack of `{` positions
  let inStr = false;
  let escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") {
      starts.push(i);
    } else if (ch === "}") {
      const start = starts.pop();
      if (start === undefined) continue;
      const candidate = cleaned.substring(start, i + 1);
      try {
        const v = JSON.parse(candidate);
        if (v && typeof v === "object" && !Array.isArray(v) && (v.principle_name || v.what_i_learned)) {
          objects.push(v);
        }
      } catch { /* skip */ }
    }
  }
  if (objects.length > 0) {
    console.log(`JSON repair: salvaged ${objects.length} principle objects via brace-counting`);
  }
  return objects;
}

import { chunkText, dedupePrinciples, prepareBookSections, type DetectedChapter } from "./lib.ts";

async function extractStructuredLearnings(content: string, sourceName: string, apiKey: string): Promise<any[]> {
  // ===== PASS 1: Clean each 10k chunk independently, then concatenate =====
  const rawChunks = chunkText(content, 10000);
  console.log(`Pass 1: cleaning ${rawChunks.length} raw chunks of ~10k chars each`);

  const cleanedParts: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const cleaned = await cleanTranscriptChunk(rawChunks[i], apiKey);
    console.log(`Pass 1 chunk ${i + 1}/${rawChunks.length}: ${rawChunks[i].length} → ${cleaned.length} chars`);
    cleanedParts.push(cleaned);
  }
  const cleanedFull = cleanedParts.join("\n\n");
  console.log(`Pass 1 done. Concatenated cleaned text: ${cleanedFull.length} chars`);

  // ===== PASS 2: Re-chunk the cleaned text at 10k and extract from each =====
  const extractionChunks = chunkText(cleanedFull, 10000);
  console.log(`Pass 2: extracting from ${extractionChunks.length} cleaned chunks`);

  const allLearnings: any[] = [];
  for (let i = 0; i < extractionChunks.length; i++) {
    const chunkLearnings = await extractStructuredLearningsChunk(
      extractionChunks[i],
      sourceName,
      apiKey,
      i,
      extractionChunks.length,
    );
    allLearnings.push(...chunkLearnings);
    console.log(`Pass 2 chunk ${i + 1}/${extractionChunks.length}: extracted ${chunkLearnings.length} principles`);
  }

  const deduped = dedupePrinciples(allLearnings);
  console.log(`Pass 2 done. ${allLearnings.length} raw → ${deduped.length} unique principles`);
  return deduped;
}

// ===== BOOK PIPELINE: Pass 1 (mapping) =====
async function extractBookSkeleton(
  firstPages: string,
  chapterTitles: string[],
  apiKey: string,
): Promise<{ title: string; author: string; core_system: string; what_this_book_teaches: string; chapters: { index: number; title: string; one_line: string }[] } | null> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a book mapper. From the first pages and the detected chapter headings, output a JSON skeleton of the book.

Return EXACTLY this shape:
{
  "title": "...",
  "author": "...",
  "core_system": "one line description of the system the author teaches",
  "what_this_book_teaches": "200-word briefing in plain English aimed at a salesperson — what they will learn and why it matters",
  "chapters": [{ "index": 1, "title": "...", "one_line": "this chapter's role in the book's argument" }]
}

Rules:
- Always include a "chapters" array. If chapter titles are provided, use them. If not, infer 5–10 logical chapters from the content.
- "what_this_book_teaches" must be ~200 words, no bullet lists, no headings.
- No prose outside the JSON.`,
          },
          {
            role: "user",
            content: `FIRST PAGES OF THE BOOK:\n${firstPages.substring(0, 12000)}\n\nDETECTED CHAPTER HEADINGS (in order):\n${chapterTitles.join("\n") || "(none detected — infer from content)"}`,
          },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) {
      console.error("Book skeleton API error:", r.status);
      return null;
    }
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || "";
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.chapters)) {
        return parsed;
      }
    } catch (e) {
      console.error("Book skeleton JSON parse failed:", e);
    }
    return null;
  } catch (e) {
    console.error("extractBookSkeleton failed:", e);
    return null;
  }
}

async function extractBookLearningsChunk(
  content: string,
  sourceName: string,
  chapterTitle: string,
  apiKey: string,
  chunkIndex: number,
  totalChunks: number,
): Promise<any[]> {
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `Extract concise sales learnings from this book section. Return JSON only: {"principles":[{"principle_name":"","category":"Mindset|Prospecting|Opening|Trust Building|Objection Handling|Closing|Follow Up|Leadership|Script|Warning|Framework|Psychology","what_i_learned":"1-2 clear sentences","the_deep_why":"1 sentence psychology","how_to_apply":"2-3 practical steps","exact_words_to_use":"spoken script if useful","when_to_use":"specific trigger situation","trigger_phrases":"3-5 comma-separated phrases","power_level":7}]}. Return 3-5 principles maximum. Prefer fewer complete items over many slow items.` },
          { role: "user", content: `Book: ${sourceName}\nChapter: ${chapterTitle}\nPart: ${chunkIndex + 1}/${totalChunks}\n\n${content}` },
        ],
        temperature: 0.2,
        max_tokens: 4500,
      }),
      signal: AbortSignal.timeout(22000),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return parsePrinciplesJson(data.choices?.[0]?.message?.content || "");
  } catch (e) {
    console.error("Book chunk extraction failed fast:", e);
    return [];
  }
}

// ===== BOOK PIPELINE: Pass 2 (chapter-aware extraction for one chapter) =====
async function extractChapterPrinciples(
  chapter: DetectedChapter,
  bookContext: { title?: string; author?: string; core_system?: string; what_this_book_teaches?: string },
  chapterContext: { title: string; one_line?: string },
  sourceName: string,
  apiKey: string,
  chunkSize = 6000,
): Promise<any[]> {
  const subChunks = chunkText(chapter.text, chunkSize);
  const all: any[] = [];
  const deadlineMs = Date.now() + 95_000;
  for (let i = 0; i < subChunks.length; i++) {
    if (Date.now() > deadlineMs) {
      console.warn(`Chapter ${chapter.index} hit time budget after ${i}/${subChunks.length} subchunks; continuing with ${all.length} principles`);
      break;
    }
    const wrapped = `=== BOOK CONTEXT ===
Title: ${bookContext.title || "Unknown"}
Author: ${bookContext.author || "Unknown"}
Core system: ${bookContext.core_system || "n/a"}
What this book teaches: ${bookContext.what_this_book_teaches || "n/a"}

=== CHAPTER CONTEXT ===
Chapter ${chapter.index}: ${chapterContext.title}
Role in system: ${chapterContext.one_line || "n/a"}

=== CHAPTER TEXT ===
${subChunks[i]}`;
    const learnings = await extractBookLearningsChunk(
      wrapped,
      sourceName,
      chapterContext.title,
      apiKey,
      i,
      subChunks.length,
    );
    all.push(...learnings);
  }
  return dedupePrinciples(all);
}

// Try chapter with small bounded chunks; if one call times out, retry with even
// smaller chunks so hard PDF sections fail soft instead of wedging the whole book.
async function extractChapterWithFallback(
  chapter: DetectedChapter,
  bookContext: { title?: string; author?: string; core_system?: string; what_this_book_teaches?: string },
  chapterContext: { title: string; one_line?: string },
  sourceName: string,
  apiKey: string,
): Promise<any[]> {
  try {
    const first = await extractChapterPrinciples(
      chapter, bookContext, chapterContext, sourceName, apiKey, 6000,
    );
    if (first.length > 0) return first;
    console.warn(`Chapter ${chapter.index} returned 0 principles at 6k — retrying at 3.5k`);
  } catch (e: any) {
    console.warn(`Chapter ${chapter.index} failed at 6k (${e?.message}) — retrying at 3.5k`);
  }
  return await extractChapterPrinciples(
    chapter, bookContext, chapterContext, sourceName, apiKey, 3500,
  );
}

// Generate a 1-2 sentence summary of what the chapter teaches based on the
// extracted principles. Best-effort; failures return empty string.
async function summarizeChapter(
  chapterTitle: string,
  principles: { principle_name: string; what_i_learned?: string }[],
  apiKey: string,
): Promise<string> {
  if (principles.length === 0) return "";
  const list = principles
    .slice(0, 8)
    .map((p, i) => `${i + 1}. ${p.principle_name} — ${(p.what_i_learned || "").substring(0, 160)}`)
    .join("\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You write tight 1-2 sentence chapter takeaways for a salesperson. Plain text, no markdown, max 220 chars." },
          { role: "user", content: `Chapter: ${chapterTitle}\nPrinciples extracted:\n${list}\n\nWrite the takeaway:` },
        ],
        temperature: 0.4,
      }),
    });
    if (!r.ok) return "";
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    return txt.replace(/^["']|["']$/g, "").substring(0, 240);
  } catch {
    return "";
  }
}

// ===== BOOK PIPELINE: Pass 3 (connection layer) =====
async function buildConnectionMap(
  principles: { principle_name: string; what_i_learned?: string }[],
  apiKey: string,
): Promise<Record<string, string[]>> {
  if (principles.length === 0) return {};
  const list = principles
    .map((p, i) => `${i + 1}. ${p.principle_name} — ${(p.what_i_learned || "").substring(0, 140)}`)
    .join("\n");
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You map connections between sales principles.

Input: a numbered list of principles with their core idea.
Output: { "connections": { "<principle_name>": ["<connected_name_1>", "<connected_name_2>"] } }

Rules:
- Only connect principles that genuinely reinforce, sequence with, or contrast meaningfully against each other.
- Prefer 1–4 connections per principle. Some may have zero — omit them.
- Use the EXACT principle names as keys/values. No invented names.
- No prose outside the JSON.`,
          },
          { role: "user", content: list.substring(0, 14000) },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) return {};
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(raw);
      const connections = parsed?.connections;
      if (connections && typeof connections === "object") {
        const out: Record<string, string[]> = {};
        for (const k of Object.keys(connections)) {
          if (Array.isArray(connections[k])) {
            out[k] = connections[k].filter((v: any) => typeof v === "string").slice(0, 6);
          }
        }
        return out;
      }
    } catch { /* ignore */ }
    return {};
  } catch (e) {
    console.error("buildConnectionMap failed:", e);
    return {};
  }
}

// ===== Persist a single learning row + companion chunk (used by both pipelines) =====
async function persistLearning(
  supabase: any,
  userId: string,
  itemId: string,
  brainType: string,
  sourceName: string,
  learning: any,
  apiKey: string,
  seenChunkContent: Set<string>,
): Promise<any | null> {
  const principleName = (learning.principle_name || "Untitled Principle").trim();
  const embeddingText = [
    principleName,
    learning.category,
    learning.what_i_learned,
    learning.exact_words_to_use,
    learning.when_to_use,
    learning.the_deep_why,
    learning.works_best_for,
    learning.trigger_phrases,
  ].filter((s) => typeof s === "string" && s.trim().length > 0).join(" | ");
  const embedding = await generateEmbedding(embeddingText, apiKey);

  const brainRow = {
    user_id: userId,
    source_id: itemId,
    principle_name: principleName,
    what_i_learned: learning.what_i_learned || "",
    how_to_apply: learning.how_to_apply || "",
    source_name: sourceName,
    source_type: "sales_principle",
    brain_type: brainType,
    category: learning.category || "general",
    the_deep_why: learning.the_deep_why || null,
    exact_words_to_use: learning.exact_words_to_use || null,
    words_to_never_use: learning.words_to_never_use || null,
    real_example_or_story: learning.real_example_or_story || null,
    when_to_use: learning.when_to_use || null,
    when_not_to_use: learning.when_not_to_use || null,
    common_mistake: learning.common_mistake || null,
    power_level: learning.power_level ? Number(learning.power_level) : 5,
    works_best_for: learning.works_best_for || null,
    connected_principles: learning.connected_principles || null,
    relevance_score: learning.power_level ? Number(learning.power_level) * 10 : 70,
    metadata: { source: sourceName, chapter: learning._chapter || null },
    embedding,
    workspace_id: null,
  };

  let inserted: any = null;
  const { data: upserted, error: upsertErr } = await supabase
    .from("sales_brain")
    .insert(brainRow)
    .select()
    .single();

  if (upserted) {
    inserted = upserted;
  } else if (upsertErr && /duplicate key|unique/i.test(upsertErr.message || "")) {
    const { data: updated } = await supabase
      .from("sales_brain")
      .update(brainRow)
      .eq("user_id", userId)
      .eq("source_id", itemId)
      .ilike("principle_name", principleName)
      .select()
      .single();
    inserted = updated;
  } else if (upsertErr) {
    // FK violation = parent knowledge_base_items row was deleted (e.g. user removed
    // the upload while a previous background pipeline was still running). Throw a
    // sentinel so callers can abort the chapter/pipeline cleanly instead of logging
    // hundreds of identical FK errors.
    if (/foreign key constraint|sales_brain_source_id_fkey/i.test(upsertErr.message || "")) {
      throw new Error("PARENT_ITEM_DELETED");
    }
    console.error("Insert error for principle:", principleName, upsertErr.message);
  }

  if (inserted) {
    const chunkContent = `${principleName}: ${learning.what_i_learned || ""}\n\nApply: ${learning.how_to_apply || ""}`;
    const chunkKey = chunkContent.trim().toLowerCase();
    if (!seenChunkContent.has(chunkKey)) {
      seenChunkContent.add(chunkKey);
      await supabase.from("knowledge_chunks").insert({
        user_id: userId,
        source_id: itemId,
        category: learning.category || "general",
        content: chunkContent,
        brain_type: brainType,
        trigger_phrases: learning.trigger_phrases || "",
        relevance_score: learning.power_level ? Number(learning.power_level) * 10 : 70,
        source_type: "core_knowledge",
        embedding,
        workspace_id: null,
      });
    }
  }
  return inserted;
}

serve(async (req) => {
  const corsHeaders = defaultCorsHeaders;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemId, url, type, filePath, manualTranscript, retryChapterIndex, continueBook, userId: bodyUserId } = await req.json();

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Resolve user: try auth.getUser, then JWT payload fallback, then body userId (service-to-service)
    const token = authHeader?.replace("Bearer ", "");
    let userIdResolved: string | null = null;

    if (token) {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user?.id) userIdResolved = user.id;
      } catch (e) {
        console.warn("auth.getUser failed, will try JWT payload fallback:", e);
      }
      if (!userIdResolved) {
        try {
          const parts = token.split(".");
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (payload?.sub && typeof payload.sub === "string" && payload.sub.length > 10 && payload.role !== "service_role") {
              userIdResolved = payload.sub;
              console.log("Resolved user ID from JWT payload fallback");
            }
          }
        } catch (e) {
          console.warn("JWT payload parse failed:", e);
        }
      }
    }

    // Service-to-service fallback (e.g. reprocess-brain passes userId explicitly)
    if (!userIdResolved && bodyUserId && typeof bodyUserId === "string") {
      userIdResolved = bodyUserId;
      console.log("Using userId from request body (service-to-service)");
    }

    // Last resort: derive userId from the item itself (service role can read it)
    if (!userIdResolved && itemId) {
      const { data: ownerRow } = await supabase
        .from("knowledge_base_items")
        .select("user_id")
        .eq("id", itemId)
        .maybeSingle();
      if (ownerRow?.user_id) {
        userIdResolved = ownerRow.user_id;
        console.log("Resolved user ID from knowledge_base_items.user_id");
      }
    }

    if (!userIdResolved) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: userIdResolved };

    // Get item info early so book pipeline can update book_brief incrementally
    const { data: itemEarly } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (!itemEarly) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark only fresh jobs as processing. Continuation/retry calls must not touch
    // updated_at before they inspect book_brief, otherwise overlapping resumes can
    // hide a legitimately active section and overwrite each other.
    if (!continueBook && typeof retryChapterIndex !== "number") {
      await supabase.from("knowledge_base_items").update({ status: "processing" }).eq("id", itemId);
    }

    const runPipeline = async () => {
    // Pre-flight: confirm the parent item still exists. The user may have deleted it
    // between request acceptance and background execution, in which case all writes
    // would FK-fail.
    const { data: stillThere } = await supabase
      .from("knowledge_base_items").select("id").eq("id", itemId).maybeSingle();
    if (!stillThere) {
      console.log(`Item ${itemId} was deleted before processing — aborting pipeline.`);
      return;
    }
    let content = "";

    if (manualTranscript && manualTranscript.trim().length > 10) {
      content = manualTranscript.trim();
    } else if (type === "pdf" && (filePath || itemEarly.file_path)) {
      content = await extractPdfContent(filePath || itemEarly.file_path, supabase, itemId, corsHeaders, LOVABLE_API_KEY);
    } else if (url || itemEarly.url) {
      content = await extractUrlContent(url || itemEarly.url, supabaseUrl, supabaseKey, supabase, user.id);
    }

    if (!content || content.length < 20) {
      await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
      console.error("Could not extract enough content for item", itemId);
      return;
    }

    const { data: itemCurrent } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("id", itemId)
      .maybeSingle();
    if (!itemCurrent) {
      console.log(`Item ${itemId} was deleted before processing state read — aborting pipeline.`);
      return;
    }
    const item = itemCurrent;
    const MAX_CONTENT_LENGTH = 600000;
    const contentToProcess = content.substring(0, MAX_CONTENT_LENGTH);
    const sourceName = item.title || "Uploaded Content";

    // ============== BOOK PIPELINE (PDF, long enough to benefit) ==============
    const isBook = type === "pdf" && contentToProcess.length >= 5000;

    if (isBook) {
      console.log(`Book pipeline starting on ${contentToProcess.length} chars`);
      const finishBookIfComplete = async (brief: any, chapters: any[]) => {
        const hasOpenWork = chapters.some((c: any) => c.status === "pending" || c.status === "extracting");
        if (!hasOpenWork) {
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters },
            status: "ready",
          }).eq("id", itemId);
          console.log(`Book pipeline marked ready for ${itemId}.`);
        }
      };
      const seenChunkContent = new Set<string>();
      const allStored: any[] = [];

      // === RETRY MODE: re-run a single chapter ===
      if (typeof retryChapterIndex === "number" && item.book_brief) {
        const brief = item.book_brief;
        const chapters: any[] = Array.isArray(brief.chapters) ? brief.chapters : [];
        const targetMeta = chapters.find((c: any) => c.index === retryChapterIndex);
        const detected = prepareBookSections(contentToProcess);
        const targetDetected = detected.find((c) => c.index === retryChapterIndex) || detected[retryChapterIndex - 1];
        if (!targetMeta || !targetDetected) {
          return new Response(JSON.stringify({ error: "Chapter not found for retry" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Mark as extracting in book_brief
        const updatedChapters = chapters.map((c: any) =>
          c.index === retryChapterIndex ? { ...c, status: "extracting", error: null } : c,
        );
        await supabase.from("knowledge_base_items").update({
          book_brief: { ...brief, chapters: updatedChapters },
          status: "extracting",
        }).eq("id", itemId);

        try {
          // Wipe previous principles for this chapter so retry is clean
          await supabase.from("sales_brain")
            .delete()
            .eq("user_id", user.id)
            .eq("source_id", itemId)
            .filter("metadata->>chapter", "eq", String(retryChapterIndex));

          const principles = await extractChapterWithFallback(
            targetDetected,
            {
              title: brief.title,
              author: brief.author,
              core_system: brief.core_system,
              what_this_book_teaches: brief.what_this_book_teaches,
            },
            { title: targetMeta.title, one_line: targetMeta.one_line },
            sourceName,
            LOVABLE_API_KEY,
          );

          let storedCount = 0;
          const storedForChapter: any[] = [];
          for (const p of principles) {
            const stored = await persistLearning(
              supabase, user.id, itemId, item.brain_type, sourceName,
              { ...p, _chapter: retryChapterIndex }, LOVABLE_API_KEY, seenChunkContent,
            );
            if (stored) { allStored.push(stored); storedForChapter.push(stored); storedCount++; }
          }

          const summary = await summarizeChapter(targetMeta.title, storedForChapter, LOVABLE_API_KEY);
          const finalChapters = updatedChapters.map((c: any) =>
            c.index === retryChapterIndex ? { ...c, status: "done", principle_count: storedCount, error: null, summary } : c,
          );
          // If any chapter still pending/extracting, keep status; else flip to ready
          const stillPending = finalChapters.some((c: any) => c.status === "pending" || c.status === "extracting");
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: finalChapters },
            status: stillPending ? "extracting" : "ready",
          }).eq("id", itemId);

          console.log(`Retry chapter ${retryChapterIndex} done: ${storedCount} principles`);
          return;
        } catch (retryErr: any) {
          if (retryErr?.message === "PARENT_ITEM_DELETED") {
            console.log(`Item ${itemId} deleted during retry of chapter ${retryChapterIndex} — aborting.`);
            return;
          }
          const failChapters = updatedChapters.map((c: any) =>
            c.index === retryChapterIndex ? { ...c, status: "failed", error: retryErr?.message || "Retry failed" } : c,
          );
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: failChapters },
          }).eq("id", itemId);
          throw retryErr;
        }
      }

      // Helper: schedule next pending chapter (or finalize) in a fresh invocation,
      // so each call stays well within the edge function wall-clock limit.
      const scheduleContinue = async () => {
        try {
          const fnUrl = `${supabaseUrl}/functions/v1/process-knowledge`;
          // Kick the next invocation and wait only for its quick 202 acceptance.
          // The heavy work still runs inside that fresh invocation's waitUntil,
          // but awaiting acceptance prevents Deno from dropping fire-and-forget
          // fetches before they leave the current runtime.
          const res = await fetch(fnUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ itemId, type: "pdf", continueBook: true, userId: user.id }),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.error("scheduleContinue was not accepted:", res.status, body.substring(0, 300));
          }
        } catch (e) {
          console.error("scheduleContinue threw:", e);
        }
      };

      // === CONTINUE MODE: process the next pending chapter only ===
      if (continueBook && item.book_brief) {
        const brief: any = item.book_brief;
        const chapters: any[] = Array.isArray(brief.chapters) ? brief.chapters : [];
        const detectedAll = prepareBookSections(contentToProcess);

        // Repair older/stalled mappings produced by the previous detector, which
        // counted numbered bullets as chapters (for example 35 fake sections).
        // Only do this before any section has successfully stored principles.
        const noStoredProgress = chapters.every((c: any) => (c.principle_count || 0) === 0 && c.status !== "done");
        if (noStoredProgress && detectedAll.length > 0 && chapters.length > detectedAll.length) {
          const remapped = detectedAll.map((c) => ({
            index: c.index,
            title: c.title,
            one_line: "",
            status: "pending" as const,
            principle_count: 0,
          }));
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: remapped },
            status: "extracting",
          }).eq("id", itemId);
          console.log(`Continue: remapped stale section list from ${chapters.length} to ${remapped.length}`);
          await scheduleContinue();
          return;
        }

        // Newer pipeline splits oversized parts into smaller safe sections. If an
        // older book is mid-process with fewer giant sections, migrate its brief
        // forward and preserve already-completed headings by title prefix.
        if (detectedAll.length > chapters.length && chapters.length > 0) {
          const doneOld = chapters.filter((c: any) => c.status === "done");
          const remapped = detectedAll.map((section) => {
            const doneMatch = doneOld.find((old: any) =>
              section.title.toLowerCase().startsWith(String(old.title || "").toLowerCase()),
            );
            return doneMatch
              ? { ...doneMatch, index: section.index, title: section.title, status: "done" as const }
              : { index: section.index, title: section.title, one_line: "", status: "pending" as const, principle_count: 0 };
          });
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: remapped },
            status: "extracting",
          }).eq("id", itemId);
          console.log(`Continue: migrated oversized legacy sections from ${chapters.length} to ${remapped.length}`);
          await scheduleContinue();
          return;
        }

        // Recover stale "extracting" chapters: if a chapter has been sitting in
        // extracting state but the parent item hasn't been updated for >90s,
        // treat it as stuck (likely the previous invocation was killed mid-run)
        // and reset it to pending so we can retry it cleanly.
        const updatedAtMs = item.updated_at ? new Date(item.updated_at).getTime() : 0;
        const staleMs = Date.now() - updatedAtMs;
        const STALE_THRESHOLD_MS = 90_000;
        let workingChapters = chapters;
        if (staleMs > STALE_THRESHOLD_MS) {
          const recovered = chapters.map((c: any) =>
            c.status === "extracting"
              ? { ...c, status: "pending", error: "Previous attempt timed out — retrying" }
              : c,
          );
          if (JSON.stringify(recovered) !== JSON.stringify(chapters)) {
            console.log(`Continue: recovered stale extracting chapter(s) after ${Math.round(staleMs / 1000)}s`);
            workingChapters = recovered;
            await supabase.from("knowledge_base_items").update({
              book_brief: { ...brief, chapters: recovered },
            }).eq("id", itemId);
            // Wipe any partial principles for the recovered chapter(s) so retry is clean.
            for (const c of recovered) {
              if (c.error === "Previous attempt timed out — retrying") {
                await supabase.from("sales_brain")
                  .delete()
                  .eq("user_id", user.id)
                  .eq("source_id", itemId)
                  .filter("metadata->>chapter", "eq", String(c.index));
              }
            }
          }
        }

        // If a section is already running, do not start another one. This keeps
        // the chained pipeline strictly one-section-at-a-time and prevents
        // duplicate manual resumes from fighting over book_brief status.
        const activeChapter = workingChapters.find((c: any) => c.status === "extracting");
        if (activeChapter) {
          console.log(`Continue: chapter ${activeChapter.index} is already extracting; waiting for that invocation.`);
          return;
        }

        // Find next chapter that still needs work. Stale extracting chapters are
        // reset to pending above, so pending is the only safe state to claim.
        const nextMeta = workingChapters.find((c: any) => c.status === "pending");

        if (!nextMeta) {
          // All chapters done (or done+failed). Run connection pass and finalize.
          try {
            const { data: stored } = await supabase
              .from("sales_brain")
              .select("principle_name, what_i_learned")
              .eq("user_id", user.id)
              .eq("source_id", itemId);
            if (stored && stored.length > 0) {
              const connections = await buildConnectionMap(stored, LOVABLE_API_KEY);
              for (const principleName of Object.keys(connections)) {
                const connected = connections[principleName].join(", ");
                if (!connected) continue;
                await supabase.from("sales_brain")
                  .update({ connected_principles: connected })
                  .eq("user_id", user.id)
                  .eq("source_id", itemId)
                  .ilike("principle_name", principleName);
              }
            }
          } catch (connErr) {
            console.error("Connection pass failed (non-fatal):", connErr);
          }

          const anyFailed = workingChapters.some((c: any) => c.status === "failed");
          await supabase.from("knowledge_base_items").update({
            status: anyFailed ? "ready" : "ready",
          }).eq("id", itemId);
          console.log(`Book pipeline finalized for ${itemId}.`);
          return;
        }

        const targetDetected = detectedAll.find((c) => c.index === nextMeta.index)
          || detectedAll[nextMeta.index - 1];
        if (!targetDetected) {
          console.error(`Continue: detected chapter not found for index ${nextMeta.index}`);
          // Mark this chapter failed so we don't loop forever.
          const updated = workingChapters.map((c: any) =>
            c.index === nextMeta.index ? { ...c, status: "failed", error: "Chapter text not found" } : c,
          );
          await supabase.from("knowledge_base_items")
            .update({ book_brief: { ...brief, chapters: updated } })
            .eq("id", itemId);
          await scheduleContinue();
          return;
        }

        // Mark extracting (and bump updated_at via the touch from this update so
        // the staleness recovery above can correctly detect long-running attempts).
        const extractingChapters = workingChapters.map((c: any) =>
          c.index === nextMeta.index ? { ...c, status: "extracting", error: null } : c,
        );
        const claim = await supabase.from("knowledge_base_items").update({
          book_brief: { ...brief, chapters: extractingChapters },
          status: "extracting",
        }).eq("id", itemId).eq("updated_at", item.updated_at).select("id");
        if (!claim.data || claim.data.length === 0) {
          console.log(`Continue: chapter ${nextMeta.index} claim skipped because another invocation updated the book first.`);
          return;
        }

        try {
          const principles = await extractChapterWithFallback(
            targetDetected,
            {
              title: brief.title,
              author: brief.author,
              core_system: brief.core_system,
              what_this_book_teaches: brief.what_this_book_teaches,
            },
            { title: nextMeta.title, one_line: nextMeta.one_line },
            sourceName,
            LOVABLE_API_KEY,
          );

          const seen = new Set<string>();
          let storedCount = 0;
          const storedForChapter: any[] = [];
          for (const p of principles) {
            const stored = await persistLearning(
              supabase, user.id, itemId, item.brain_type, sourceName,
              { ...p, _chapter: nextMeta.index }, LOVABLE_API_KEY, seen,
            );
            if (stored) { storedForChapter.push(stored); storedCount++; }
          }

          // If the AI returned zero principles for a real chapter, treat it as a
          // failure so the user sees a Retry option instead of a silent "0 principles done".
          if (storedCount === 0) {
            const failChapters = extractingChapters.map((c: any) =>
              c.index === nextMeta.index
                ? { ...c, status: "failed", error: "AI returned no principles — try retrying this section" }
                : c,
            );
            await supabase.from("knowledge_base_items").update({
              book_brief: { ...brief, chapters: failChapters },
            }).eq("id", itemId);
            console.warn(`Continue: chapter ${nextMeta.index} extracted 0 principles — marked failed`);
            await finishBookIfComplete(brief, failChapters);
          } else {
            const summary = await summarizeChapter(nextMeta.title, storedForChapter, LOVABLE_API_KEY);
            const doneChapters = extractingChapters.map((c: any) =>
              c.index === nextMeta.index
                ? { ...c, status: "done", principle_count: storedCount, summary, error: null }
                : c,
            );
            await supabase.from("knowledge_base_items").update({
              book_brief: { ...brief, chapters: doneChapters },
            }).eq("id", itemId);
            console.log(`Continue: chapter ${nextMeta.index} done (${storedCount} principles)`);
            await finishBookIfComplete(brief, doneChapters);
          }
        } catch (chapErr: any) {
          if (chapErr?.message === "PARENT_ITEM_DELETED") {
            console.log(`Item ${itemId} deleted during continue at chapter ${nextMeta.index}.`);
            return;
          }
          console.error(`Continue chapter ${nextMeta.index} failed:`, chapErr?.message);
          const failChapters = extractingChapters.map((c: any) =>
            c.index === nextMeta.index
              ? { ...c, status: "failed", error: chapErr?.message || "Failed" }
              : c,
          );
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: failChapters },
          }).eq("id", itemId);
          await finishBookIfComplete(brief, failChapters);
        }

        // Schedule next chapter (or finalize) in a fresh invocation.
        await scheduleContinue();
        return;
      }

      // === FRESH RUN: map the book, then hand off to per-chapter invocations ===
      await supabase.from("knowledge_base_items").update({ status: "mapping" }).eq("id", itemId);

      const detected = prepareBookSections(contentToProcess);
      console.log(`Detected ${detected.length} chapter(s) / chunk(s)`);

      // Pass 1 — Book Mapping
      const firstPages = contentToProcess.substring(0, 12000);
      const skeleton = await extractBookSkeleton(
        firstPages,
        detected.map((c) => c.title),
        LOVABLE_API_KEY,
      );

      const bookContext = skeleton ?? {
        title: sourceName,
        author: "Unknown",
        core_system: "",
        what_this_book_teaches: "",
        chapters: detected.map((c) => ({ index: c.index, title: c.title, one_line: "" })),
      };

      const briefChapters = detected.map((c) => {
        const fromAi = (bookContext.chapters || []).find((x: any) => x.index === c.index);
        return {
          index: c.index,
          title: fromAi?.title || c.title,
          one_line: fromAi?.one_line || "",
          status: "pending" as const,
          principle_count: 0,
        };
      });

      const briefToStore = {
        title: bookContext.title || sourceName,
        author: bookContext.author || "Unknown",
        core_system: bookContext.core_system || "",
        what_this_book_teaches: bookContext.what_this_book_teaches || "",
        chapters: briefChapters,
      };

      await supabase.from("knowledge_base_items").update({
        book_brief: briefToStore,
        status: "extracting",
      }).eq("id", itemId);

      // Hand off to per-chapter invocations (each call processes 1 chapter, then chains).
      await scheduleContinue();
      console.log(`Book pipeline mapped (${detected.length} chapters). Handed off to chained invocations.`);
      return;
    }

    // ============== STANDARD PIPELINE (videos / short content) ==============
    console.log(`Three-pass pipeline starting on ${contentToProcess.length} chars`);
    const learnings = await extractStructuredLearnings(contentToProcess, sourceName, LOVABLE_API_KEY);
    console.log(`Pass 2 complete: ${learnings.length} principles extracted`);

    const storedLearnings: any[] = [];
    const seenChunkContent = new Set<string>();
    try {
      for (const learning of learnings) {
        const stored = await persistLearning(
          supabase, user.id, itemId, item.brain_type, sourceName, learning, LOVABLE_API_KEY, seenChunkContent,
        );
        if (stored) {
          storedLearnings.push({
            id: stored.id,
            principle_name: stored.principle_name,
            what_i_learned: stored.what_i_learned,
            how_to_apply: stored.how_to_apply,
            category: stored.category,
            source_name: stored.source_name,
            power_level: stored.power_level,
            cited_principle_name: stored.principle_name,
            cited_source_name: stored.source_name,
          });
        }
      }
    } catch (persistErr: any) {
      if (persistErr?.message === "PARENT_ITEM_DELETED") {
        console.log(`Item ${itemId} deleted mid-pipeline (standard) — aborting.`);
        return;
      }
      throw persistErr;
    }

    console.log(`Stored ${storedLearnings.length} weapon-grade principles (deduped) + matching chunks`);
    await supabase.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);
    };

    // Dispatch the long-running work to the background and respond immediately.
    // The client polls knowledge_base_items.status / book_brief every 3s.
    const bgTask = runPipeline().catch(async (error) => {
      console.error("process-knowledge background error:", error);
      try {
        const { data: current } = await supabase
          .from("knowledge_base_items")
          .select("status, book_brief")
          .eq("id", itemId)
          .maybeSingle();
        const chapters = Array.isArray(current?.book_brief?.chapters) ? current.book_brief.chapters : [];
        if (current?.status === "extracting" && chapters.length > 0) {
          const recovered = chapters.map((c: any) =>
            c.status === "extracting"
              ? { ...c, status: "pending", error: "Previous attempt stopped — queued to retry" }
              : c,
          );
          await supabase.from("knowledge_base_items").update({
            status: "extracting",
            book_brief: { ...current.book_brief, chapters: recovered },
          }).eq("id", itemId);
        } else {
          await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
        }
      } catch (_) { /* ignore */ }
    });

    // @ts-ignore — EdgeRuntime is provided by the Supabase Edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(bgTask);
    }

    return new Response(JSON.stringify({
      success: true,
      status: "processing",
      message: "Processing started in background. Poll item status for completion.",
      itemId,
    }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-knowledge error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ===== CHUNKING UTILITY =====
function breakIntoChunks(text: string, targetTokens: number): string[] {
  const avgCharsPerToken = 4;
  const chunkSize = targetTokens * avgCharsPerToken;
  const overlap = Math.floor(chunkSize * 0.1);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;
    if (end >= text.length) {
      chunks.push(text.substring(start).trim());
      break;
    }
    // Try to break at sentence boundary
    const lastPeriod = text.lastIndexOf(". ", end);
    const lastNewline = text.lastIndexOf("\n", end);
    const breakPoint = Math.max(lastPeriod, lastNewline);
    if (breakPoint > start + chunkSize * 0.5) {
      end = breakPoint + 1;
    }
    const chunk = text.substring(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    start = end - overlap;
  }

  return chunks.filter(c => c.length > 50);
}

// ===== PDF EXTRACTION =====
async function extractPdfContent(
  filePath: string,
  supabase: any,
  itemId: string,
  _corsHeaders: any,
  apiKey: string,
): Promise<string> {
  // See pdf-extract.ts for the architectural rationale (unpdf > Gemini-as-PDF-reader > pdf-parse).
  try {
    // Preferred path: the browser extracts text while uploading and stores a
    // sidecar .txt file. This avoids doing CPU/memory-heavy PDF parsing in the
    // edge runtime on every chained chapter invocation.
    try {
      const { data: textSidecar } = await supabase.storage
        .from("knowledge-files")
        .download(`${filePath}.txt`);
      if (textSidecar) {
        const sidecarText = (await textSidecar.text()).trim();
        if (sidecarText.length >= 100) {
          console.log(`Using browser-extracted PDF text sidecar (${sidecarText.length} chars)`);
          return sidecarText.substring(0, 600000);
        }
      }
    } catch (sidecarErr) {
      console.warn("No PDF text sidecar found; falling back to backend extraction", sidecarErr);
    }

    const { data: fileData, error: fileError } = await supabase.storage
      .from("knowledge-files")
      .download(filePath);

    if (fileError || !fileData) {
      console.error("File download error:", fileError);
      await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
      return "";
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const fileSizeMB = arrayBuffer.byteLength / 1024 / 1024;
    console.log(`PDF size: ${fileSizeMB.toFixed(2)} MB`);

    // 1) Primary: local text extraction via unpdf (instant for born-digital PDFs).
    const t0 = Date.now();
    const { text, pageCount } = await extractPdfBytes(bytes);
    console.log(`unpdf extracted ${text.length} chars from ${pageCount} pages in ${Date.now() - t0}ms`);

    let finalText = text;

    // 2) OCR fallback only when the file looks scanned. Born-digital PDFs skip this entirely.
    if (looksScanned(text.length, arrayBuffer.byteLength)) {
      console.log(`PDF looks scanned (${text.length} chars / ${fileSizeMB.toFixed(2)} MB) — running vision OCR`);
      const ocr = await ocrPdfWithVision(bytes, apiKey);
      if (ocr.length > text.length) finalText = ocr;
    }

    if (finalText.length < 100) {
      // Long enough to clear the downstream "enough content" gate so the user
      // sees a meaningful brief instead of a generic 400.
      return `PDF uploaded (${fileSizeMB.toFixed(2)} MB, ${pageCount} pages) but no readable text could be extracted. The file may be image-only without OCR layer, password-protected, or corrupted. Try a different copy or paste the text manually.`.padEnd(260, ' ');
    }

    return finalText.substring(0, 600000);
  } catch (e) {
    console.error("PDF processing error:", e);
    return "";
  }
}

// ===== URL CONTENT EXTRACTION =====
async function extractUrlContent(url: string, supabaseUrl: string, supabaseKey: string, supabase: any, userId: string | null = null): Promise<string> {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

  if (isInstagram) {
    return await extractInstagramContent(url, supabaseUrl, supabaseKey, supabase);
  } else if (isYouTube) {
    return await extractYouTubeContent(url, userId, supabase);
  } else {
    return await extractWebContent(url);
  }
}

async function extractInstagramContent(url: string, supabaseUrl: string, supabaseKey: string, supabase: any): Promise<string> {
  let content = "";
  const isPost = url.match(/instagram\.com\/(?:p|reel|tv)\//);
  const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

  if (isPost && APIFY_API_KEY) {
    try {
      const actorRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directUrls: [url], resultsLimit: 1 }),
          signal: AbortSignal.timeout(60000),
        }
      );
      if (actorRes.ok) {
        const results = await actorRes.json();
        const post = Array.isArray(results) && results.length > 0 ? results[0] : null;
        if (post) {
          content = [
            `Instagram ${post.type === "Video" ? "Reel/Video" : "Post"} by @${post.ownerUsername || "unknown"}`,
            `Caption: ${post.caption || "No caption"}`,
            `Likes: ${post.likesCount || 0} | Comments: ${post.commentsCount || 0}`,
            post.type === "Video" ? `Video views: ${post.videoViewCount || 0}` : "",
            ...(post.latestComments || []).slice(0, 10).map((c: any) => `Comment by @${c.ownerUsername}: ${c.text}`),
          ].filter(Boolean).join("\n");
        }
      }
    } catch (e) {
      console.error("Apify post scraper error:", e);
    }
  } else {
    try {
      const supabaseFnUrl = `${supabaseUrl}/functions/v1/fetch-instagram`;
      const igRes = await fetch(supabaseFnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify({ username: url }),
        signal: AbortSignal.timeout(90000),
      });
      if (igRes.ok) {
        const igData = await igRes.json();
        content = igData.summary || "";
        if (!content && igData.biography) {
          content = `Instagram Profile: @${igData.username}\nBio: ${igData.biography}\nFollowers: ${igData.followersCount}`;
        }
      }
    } catch (e) {
      console.error("Instagram Apify fetch error:", e);
    }
  }

  if (!content || content.length < 50) {
    content = `Instagram URL: ${url}. Please analyze this Instagram profile/post based on the URL.`;
  }
  return content;
}

async function extractYouTubeContent(url: string, userId: string | null = null, supabaseClient: any = null): Promise<string> {
  let content = "";
  let videoId = "";
  try {
    const urlObj = new URL(url);
    videoId = url.includes("youtu.be") ? urlObj.pathname.slice(1) : (urlObj.searchParams.get("v") || "");
  } catch { /* ignore */ }

  if (videoId) {
    // 1. Try TranscriptAPI.com with user's key first, then global fallback
    let userTranscriptApiKey: string | null = null;
    if (userId && supabaseClient) {
      try {
        const userKey = await getLatestUserApiKey(supabaseClient, userId, ["supadata", "transcriptapi"]);
        if (userKey?.key) {
          userTranscriptApiKey = userKey.key;
          console.log("Using user's TranscriptAPI key from user_api_keys", {
            service: userKey.service,
            ...describeApiKey(userKey.key),
          });
        }
      } catch (e) { console.error("Failed to fetch user API key:", e); }
    }

    // Try TranscriptAPI with available keys, falling back from user key to global key
    const globalKey = Deno.env.get("SUPADATA_API_KEY") || null;
    const seenKeys = new Set<string>();
    const keysToTry: { key: string; label: string }[] = [];
    if (userTranscriptApiKey) {
      keysToTry.push({ key: userTranscriptApiKey, label: "user" });
      seenKeys.add(userTranscriptApiKey);
    }
    if (globalKey && !seenKeys.has(globalKey)) keysToTry.push({ key: globalKey, label: "global" });

    for (const { key, label } of keysToTry) {
      if (content && content.length > 100) break;
      try {
        console.log(`Trying TranscriptAPI.com with ${label} key`, describeApiKey(key));
        const sdRes = await fetch(
          `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json`,
          {
            headers: { "Authorization": `Bearer ${key}` },
            signal: AbortSignal.timeout(30000),
          }
        );
        if (sdRes.ok) {
          const sdData = await sdRes.json();
          let transcript = "";
          if (sdData.transcript && typeof sdData.transcript === "string" && sdData.transcript.length > 50) {
            transcript = sdData.transcript;
          } else if (sdData.text && typeof sdData.text === "string" && sdData.text.length > 50) {
            transcript = sdData.text;
          } else if (Array.isArray(sdData.transcript)) {
            transcript = sdData.transcript.map((c: any) => c.text || c.content || "").join(" ");
          }
          if (transcript.length > 100) {
            let title = "";
            try {
              const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(10000) });
              if (oembedRes.ok) { title = (await oembedRes.json()).title || ""; }
            } catch { /* ignore */ }
            content = `Video Title: ${title}\n\nTranscript:\n${transcript.substring(0, 15000)}`;
            console.log(`TranscriptAPI success (${label} key), content length:`, content.length);
          }
        } else {
          const errBody = await sdRes.text();
          console.warn(`TranscriptAPI error (${label} key):`, sdRes.status, errBody);
          // If 401/402, try next key
          if (sdRes.status === 401 || sdRes.status === 402) continue;
        }
      } catch (e) { console.error(`TranscriptAPI error (${label} key):`, e); }
    }

    // 2. Fallback: YouTube watch page scraping
    if (!content || content.length < 100) {
      try {
        const transcriptRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(15000),
        });
        if (transcriptRes.ok) {
          const html = await transcriptRes.text();
          const titleMatch = html.match(/<meta name="title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/);
          const descMatch = html.match(/<meta name="description" content="([^"]*)"/);
          const title = titleMatch?.[1] || "";
          const description = descMatch?.[1] || "";

          const captionsUrlMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
          if (captionsUrlMatch) {
            try {
              const captionUrl = captionsUrlMatch[1].replace(/\\u0026/g, "&");
              const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
              if (captionRes.ok) {
                const captionXml = await captionRes.text();
                const transcriptText = captionXml
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                  .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                  .replace(/\s+/g, " ").trim();
                if (transcriptText.length > 100) {
                  content = `Video Title: ${title}\n\nTranscript:\n${transcriptText.substring(0, 15000)}`;
                }
              }
            } catch (e) { console.error("Transcript fetch error:", e); }
          }

          if (!content || content.length < 100) {
            const initialDataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
            let additionalContent = "";
            if (initialDataMatch) {
              try {
                const ytData = JSON.parse(initialDataMatch[1]);
                const str = JSON.stringify(ytData);
                const textParts = str.match(/"text":"([^"]{20,})"/g);
                if (textParts) {
                  additionalContent = textParts.map(p => p.replace(/"text":"/, "").replace(/"$/, "")).join(" ").substring(0, 5000);
                }
              } catch { /* ignore */ }
            }
            content = `YouTube Video: ${title}\n\nDescription: ${description}\n\n${additionalContent}`.substring(0, 15000);
          }
        }
      } catch (e) { console.error("YouTube fetch error:", e); }
    }
  }

  if (!content || content.length < 50) {
    content = `YouTube video URL: ${url}. Please analyze this video based on the URL.`;
  }
  return content;
}

async function extractWebContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesCoachBot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = await res.text();
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 15000);
    }
  } catch (e) {
    console.error("Fetch error:", e);
  }
  return "";
}
