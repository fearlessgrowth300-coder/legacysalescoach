import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { describeApiKey, getLatestUserApiKey } from "../_shared/api-key-utils.ts";

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
        model: "google/gemini-3-flash-preview",
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

Return a JSON array of principle objects. No extra text. No markdown. Just the raw JSON array starting with [ and ending with ].`,
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
      console.error("Structured learnings API error:", response.status);
      return [];
    }

    const data = await response.json();
    const aiContent = data.choices?.[0]?.message?.content || "";
    const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      // Strip control chars
      jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, ' ');
      // Fix single-quoted keys/values → double quotes
      jsonStr = jsonStr.replace(/'/g, '"');
      // Remove trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(jsonStr);
      } catch {
        // Salvage individual objects if full array parse fails
        const objects: any[] = [];
        const objRegex = /\{[^{}]+\}/g;
        let match;
        while ((match = objRegex.exec(jsonStr)) !== null) {
          try { objects.push(JSON.parse(match[0])); } catch { /* skip */ }
        }
        console.log(`JSON repair: salvaged ${objects.length} objects from malformed response`);
        return objects;
      }
    }
    return [];
  } catch (e) {
    console.error("Structured learnings extraction failed:", e);
    return [];
  }
}

async function extractStructuredLearnings(content: string, sourceName: string, apiKey: string): Promise<any[]> {
  // Pass 2 chunk size: small chunks force the AI to go deep on each idea
  // instead of summarising. 10k chars ≈ 2.5k tokens of dense source.
  const CHUNK_SIZE = 10000;
  const chunks: string[] = [];

  if (content.length <= CHUNK_SIZE) {
    chunks.push(content);
  } else {
    let start = 0;
    while (start < content.length) {
      let end = start + CHUNK_SIZE;
      if (end >= content.length) {
        chunks.push(content.substring(start));
        break;
      }
      const lastPeriod = content.lastIndexOf(". ", end);
      const lastNewline = content.lastIndexOf("\n", end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + CHUNK_SIZE * 0.5) end = breakPoint + 1;
      chunks.push(content.substring(start, end));
      start = end;
    }
  }

  console.log(`Three-pass pipeline: ${chunks.length} chunks of ~${CHUNK_SIZE} chars each`);
  const allLearnings: any[] = [];
  for (let i = 0; i < chunks.length; i++) {
    // Pass 1: clean
    const cleaned = await cleanTranscriptChunk(chunks[i], apiKey);
    console.log(`Chunk ${i + 1}/${chunks.length}: cleaned ${chunks[i].length} → ${cleaned.length} chars`);
    // Pass 2: extract weapon-grade principles
    const chunkLearnings = await extractStructuredLearningsChunk(cleaned, sourceName, apiKey, i, chunks.length);
    allLearnings.push(...chunkLearnings);
    console.log(`Chunk ${i + 1}/${chunks.length}: extracted ${chunkLearnings.length} principles`);
  }
  return allLearnings;
}

serve(async (req) => {
  const corsHeaders = defaultCorsHeaders;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemId, url, type, filePath, manualTranscript } = await req.json();
    
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let content = "";

    // Use manual transcript if provided
    if (manualTranscript && manualTranscript.trim().length > 10) {
      content = manualTranscript.trim();
      console.log("Using manual transcript, length:", content.length);
    } else if (type === "pdf" && filePath) {
      content = await extractPdfContent(filePath, supabase, itemId, corsHeaders, LOVABLE_API_KEY);
    } else if (url) {
      content = await extractUrlContent(url, supabaseUrl, supabaseKey, supabase, user.id);
    }

    if (!content || content.length < 20) {
      await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
      return new Response(JSON.stringify({ error: "Could not extract enough content. Try pasting the text manually." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get item info
    const { data: item } = await supabase
      .from("knowledge_base_items")
      .select("*")
      .eq("id", itemId)
      .single();

    if (!item) {
      return new Response(JSON.stringify({ error: "Item not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Raised cap so longer videos benefit from the new 10k-chunk pipeline
    const MAX_CONTENT_LENGTH = 200000;
    const contentToProcess = content.substring(0, MAX_CONTENT_LENGTH);
    const sourceName = item.title || "Uploaded Content";

    console.log(`Three-pass pipeline starting on ${contentToProcess.length} chars`);

    // ===== PASSES 1 + 2: Clean each 10k chunk, then extract weapon-grade principles =====
    const learnings = await extractStructuredLearnings(contentToProcess, sourceName, LOVABLE_API_KEY);
    console.log(`Pass 2 complete: ${learnings.length} principles extracted`);

    // ===== PASS 3: Rich-field embedding + insert into sales_brain =====
    const storedLearnings: any[] = [];
    for (const learning of learnings) {
      // Concatenate ALL meaningful fields so semantic search finds the right
      // technique even when the user phrases it completely differently.
      const embeddingText = [
        learning.principle_name,
        learning.category,
        learning.what_i_learned,
        learning.exact_words_to_use,
        learning.when_to_use,
        learning.the_deep_why,
        learning.works_best_for,
        learning.trigger_phrases,
      ].filter((s) => typeof s === "string" && s.trim().length > 0).join(" | ");
      const embedding = await generateEmbedding(embeddingText, LOVABLE_API_KEY);

      const { data: inserted, error: insertErr } = await supabase.from("sales_brain").insert({
        user_id: user.id,
        source_id: itemId,
        principle_name: learning.principle_name || "Untitled Principle",
        what_i_learned: learning.what_i_learned || "",
        how_to_apply: learning.how_to_apply || "",
        source_name: sourceName,
        source_type: "sales_principle",
        brain_type: item.brain_type,
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
        metadata: { source: sourceName },
        embedding: embedding,
        workspace_id: null,
      }).select().single();

      if (!insertErr && inserted) {
        storedLearnings.push({
          principle_name: learning.principle_name,
          what_i_learned: learning.what_i_learned,
          how_to_apply: learning.how_to_apply,
          category: learning.category,
        });

        // Also store a compact knowledge_chunks row for keyword/hybrid fallback
        await supabase.from("knowledge_chunks").insert({
          user_id: user.id,
          source_id: itemId,
          category: learning.category || "general",
          content: `${learning.principle_name}: ${learning.what_i_learned}\n\nApply: ${learning.how_to_apply}`,
          brain_type: item.brain_type,
          trigger_phrases: learning.trigger_phrases || "",
          relevance_score: learning.power_level ? Number(learning.power_level) * 10 : 70,
          source_type: "core_knowledge",
          embedding: embedding,
          workspace_id: null,
        });
      } else if (insertErr) {
        console.error("Insert error for principle:", learning.principle_name, insertErr.message);
      }
    }

    console.log(`Stored ${storedLearnings.length} weapon-grade principles + matching chunks`);

    // Update item status
    await supabase.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);

    return new Response(JSON.stringify({
      success: true,
      chunks: storedLearnings.length,
      learnings: storedLearnings,
      embeddedChunks: storedLearnings.length,
      sourceName,
    }), {
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
async function extractPdfContent(filePath: string, supabase: any, itemId: string, corsHeaders: any, apiKey: string): Promise<string> {
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
    const fileSizeMB = arrayBuffer.byteLength / 1024 / 1024;
    console.log(`PDF file size: ${fileSizeMB.toFixed(2)} MB`);

    // No file size limit — let Gemini handle what it can

    // Convert PDF to base64 for Gemini
    const bytes = new Uint8Array(arrayBuffer);
    const CHUNK_SIZE = 32768;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    const base64Pdf = btoa(binary);
    
    console.log("Sending PDF to Gemini for reading...");
    
    const pdfReadResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Read this entire PDF document and extract ALL the text content from it. Return the full text content exactly as it appears in the document. Do not summarize - return the complete text.",
              },
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${base64Pdf}` },
              },
            ],
          },
        ],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (pdfReadResponse.ok) {
      try {
        const pdfData = await pdfReadResponse.json();
        const extractedText = pdfData.choices?.[0]?.message?.content || "";
        console.log("Gemini PDF extraction length:", extractedText.length);
        if (extractedText.length > 100) {
          return extractedText.substring(0, 50000);
        }
      } catch (jsonErr) {
        console.error("Gemini response JSON parse failed:", jsonErr);
      }
    }

    // Fallback: manual binary text extraction
    console.log("Falling back to manual PDF text extraction...");
    const rawText = new TextDecoder("latin1").decode(bytes);
    const textParts: string[] = [];
    const tjMatches = rawText.matchAll(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g);
    for (const match of tjMatches) {
      textParts.push(match[1].replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
    }
    const tjArrayMatches = rawText.matchAll(/\[([^\]]*)\]\s*TJ/gi);
    for (const match of tjArrayMatches) {
      const parts = match[1].match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/g) || [];
      for (const p of parts) {
        textParts.push(p.slice(1, -1));
      }
    }
    let extractedText = textParts.join(' ').replace(/\s+/g, ' ').trim();
    if (extractedText.length < 200) {
      const readable = rawText.match(/[A-Za-z0-9\s,.!?;:'"()\-]{15,}/g) || [];
      extractedText = readable.join(' ').substring(0, 50000);
    }
    if (extractedText.length > 100) {
      return extractedText.substring(0, 50000);
    }
    return `PDF file uploaded: ${filePath}. The text could not be extracted automatically.`;
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
