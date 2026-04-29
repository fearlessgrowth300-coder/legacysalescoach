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
async function extractStructuredLearningsChunk(content: string, sourceName: string, apiKey: string, chunkIndex: number, totalChunks: number): Promise<any[]> {
  try {
    const chunkLabel = totalChunks > 1 ? ` (Part ${chunkIndex + 1}/${totalChunks})` : "";
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

Extract every single distinct learning. There is no limit. If the chunk has 40 learnings, extract all 40. Miss nothing.

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

Return a single JSON object with this exact shape: { "principles": [ ...principle objects... ] }. No extra text. No markdown. No code fences. Always include the "principles" key even if you only extract one item. Extract as many principles as the chunk supports — minimum 5, no upper limit.`,
          },
          {
            role: "user",
            content: `Extract ALL learnings from this material titled "${sourceName}"${chunkLabel}:\n\n${content}`,
          },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("Structured learnings API error:", response.status, errBody.substring(0, 500));
      return [];
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "";
    if (!aiContent || aiContent.length < 5) {
      console.warn("Empty AI extraction response. Full payload keys:", Object.keys(data || {}));
      return [];
    }
    const parsed = parsePrinciplesJson(aiContent);
    if (parsed.length === 0) {
      console.warn(
        `Pass 2 returned 0 principles. Raw AI output (first 800 chars): ${aiContent.substring(0, 800)}`,
      );
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

  // 4. Salvage individual top-level JSON objects (depth-aware)
  const objects: any[] = [];
  let depth = 0;
  let inStr = false;
  let escape = false;
  let objStart = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const candidate = cleaned.substring(objStart, i + 1);
        try {
          const v = JSON.parse(candidate);
          if (v && typeof v === "object" && (v.principle_name || v.what_i_learned)) {
            objects.push(v);
          }
        } catch { /* skip */ }
        objStart = -1;
      }
    }
  }
  if (objects.length > 0) {
    console.log(`JSON repair: salvaged ${objects.length} principle objects via brace-counting`);
  }
  return objects;
}

import { chunkText, dedupePrinciples, detectChapters, type DetectedChapter } from "./lib.ts";

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

// ===== BOOK PIPELINE: Pass 2 (chapter-aware extraction for one chapter) =====
async function extractChapterPrinciples(
  chapter: DetectedChapter,
  bookContext: { title?: string; author?: string; core_system?: string; what_this_book_teaches?: string },
  chapterContext: { title: string; one_line?: string },
  sourceName: string,
  apiKey: string,
  chunkSize = 10000,
): Promise<any[]> {
  const subChunks = chunkText(chapter.text, chunkSize);
  const all: any[] = [];
  for (let i = 0; i < subChunks.length; i++) {
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
    const learnings = await extractStructuredLearningsChunk(
      wrapped,
      `${sourceName} — ${chapterContext.title}`,
      apiKey,
      i,
      subChunks.length,
    );
    all.push(...learnings);
  }
  return dedupePrinciples(all);
}

// Try chapter at default size; if it returns 0 or throws, retry once with a larger
// chunk size so the model sees more context per call.
async function extractChapterWithFallback(
  chapter: DetectedChapter,
  bookContext: { title?: string; author?: string; core_system?: string; what_this_book_teaches?: string },
  chapterContext: { title: string; one_line?: string },
  sourceName: string,
  apiKey: string,
): Promise<any[]> {
  try {
    const first = await extractChapterPrinciples(
      chapter, bookContext, chapterContext, sourceName, apiKey, 10000,
    );
    if (first.length > 0) return first;
    console.warn(`Chapter ${chapter.index} returned 0 principles at 10k — retrying at 20k`);
  } catch (e: any) {
    console.warn(`Chapter ${chapter.index} failed at 10k (${e?.message}) — retrying at 20k`);
  }
  return await extractChapterPrinciples(
    chapter, bookContext, chapterContext, sourceName, apiKey, 20000,
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
    const { itemId, url, type, filePath, manualTranscript, retryChapterIndex, userId: bodyUserId } = await req.json();

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

    // Mark as processing immediately, then run the heavy pipeline in the background
    // to avoid the 150s edge function idle timeout. Client already polls status + book_brief.
    await supabase.from("knowledge_base_items").update({ status: "processing" }).eq("id", itemId);

    const runPipeline = async () => {
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

    const item = itemEarly;
    const MAX_CONTENT_LENGTH = 200000;
    const contentToProcess = content.substring(0, MAX_CONTENT_LENGTH);
    const sourceName = item.title || "Uploaded Content";

    // ============== BOOK PIPELINE (PDF, long enough to benefit) ==============
    const isBook = type === "pdf" && contentToProcess.length >= 5000;

    if (isBook) {
      console.log(`Book pipeline starting on ${contentToProcess.length} chars`);
      const seenChunkContent = new Set<string>();
      const allStored: any[] = [];

      // === RETRY MODE: re-run a single chapter ===
      if (typeof retryChapterIndex === "number" && item.book_brief) {
        const brief = item.book_brief;
        const chapters: any[] = Array.isArray(brief.chapters) ? brief.chapters : [];
        const targetMeta = chapters.find((c: any) => c.index === retryChapterIndex);
        const detected = detectChapters(contentToProcess);
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
          const stillPending = finalChapters.some((c: any) => c.status === "pending" || c.status === "extracting" || c.status === "failed");
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: finalChapters },
            status: stillPending ? "extracting" : "ready",
          }).eq("id", itemId);

          console.log(`Retry chapter ${retryChapterIndex} done: ${storedCount} principles`);
          return;
        } catch (retryErr: any) {
          const failChapters = updatedChapters.map((c: any) =>
            c.index === retryChapterIndex ? { ...c, status: "failed", error: retryErr?.message || "Retry failed" } : c,
          );
          await supabase.from("knowledge_base_items").update({
            book_brief: { ...brief, chapters: failChapters },
          }).eq("id", itemId);
          throw retryErr;
        }
      }

      // === FRESH RUN ===
      await supabase.from("knowledge_base_items").update({ status: "mapping" }).eq("id", itemId);

      const detected = detectChapters(contentToProcess);
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

      // Align skeleton chapters to detected chapters (use detected count as source of truth)
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

      // Pass 2 — Chapter-Aware Deep Extraction (per chapter)
      let workingChapters = [...briefChapters];
      for (const chap of detected) {
        // Mark as extracting
        workingChapters = workingChapters.map((c) =>
          c.index === chap.index ? { ...c, status: "extracting" as any } : c,
        );
        await supabase.from("knowledge_base_items").update({
          book_brief: { ...briefToStore, chapters: workingChapters },
        }).eq("id", itemId);

        try {
          const meta = workingChapters.find((c) => c.index === chap.index)!;
          const principles = await extractChapterWithFallback(
            chap,
            briefToStore,
            { title: meta.title, one_line: meta.one_line },
            sourceName,
            LOVABLE_API_KEY,
          );
          let storedCount = 0;
          const storedForChapter: any[] = [];
          for (const p of principles) {
            const stored = await persistLearning(
              supabase, user.id, itemId, item.brain_type, sourceName,
              { ...p, _chapter: chap.index }, LOVABLE_API_KEY, seenChunkContent,
            );
            if (stored) { allStored.push(stored); storedForChapter.push(stored); storedCount++; }
          }
          const summary = await summarizeChapter(meta.title, storedForChapter, LOVABLE_API_KEY);
          workingChapters = workingChapters.map((c) =>
            c.index === chap.index ? { ...c, status: "done" as any, principle_count: storedCount, summary } : c,
          );
        } catch (chapErr: any) {
          console.error(`Chapter ${chap.index} failed:`, chapErr?.message);
          workingChapters = workingChapters.map((c) =>
            c.index === chap.index ? { ...c, status: "failed" as any, error: chapErr?.message || "Failed" } : c,
          );
        }
        await supabase.from("knowledge_base_items").update({
          book_brief: { ...briefToStore, chapters: workingChapters },
        }).eq("id", itemId);
      }

      // Pass 3 — Connection Layer
      try {
        const connections = await buildConnectionMap(
          allStored.map((s) => ({ principle_name: s.principle_name, what_i_learned: s.what_i_learned })),
          LOVABLE_API_KEY,
        );
        for (const principleName of Object.keys(connections)) {
          const connected = connections[principleName].join(", ");
          if (!connected) continue;
          await supabase.from("sales_brain")
            .update({ connected_principles: connected })
            .eq("user_id", user.id)
            .eq("source_id", itemId)
            .ilike("principle_name", principleName);
        }
      } catch (connErr) {
        console.error("Connection pass failed (non-fatal):", connErr);
      }

      await supabase.from("knowledge_base_items").update({
        book_brief: { ...briefToStore, chapters: workingChapters },
        status: "ready",
      }).eq("id", itemId);

      console.log(`Book pipeline complete: ${allStored.length} principles`);
      return;
    }

    // ============== STANDARD PIPELINE (videos / short content) ==============
    console.log(`Three-pass pipeline starting on ${contentToProcess.length} chars`);
    const learnings = await extractStructuredLearnings(contentToProcess, sourceName, LOVABLE_API_KEY);
    console.log(`Pass 2 complete: ${learnings.length} principles extracted`);

    const storedLearnings: any[] = [];
    const seenChunkContent = new Set<string>();
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

    console.log(`Stored ${storedLearnings.length} weapon-grade principles (deduped) + matching chunks`);
    await supabase.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);
    };

    // Dispatch the long-running work to the background and respond immediately.
    // The client polls knowledge_base_items.status / book_brief every 3s.
    const bgTask = runPipeline().catch(async (error) => {
      console.error("process-knowledge background error:", error);
      try {
        await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
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

    return finalText.substring(0, 200000);
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
