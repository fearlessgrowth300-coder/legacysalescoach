import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemId, url, type, filePath, manualTranscript } = await req.json();
    
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
      try {
        const { data: fileData, error: fileError } = await supabase.storage
          .from("knowledge-files")
          .download(filePath);
        
        if (fileError || !fileData) {
          console.error("File download error:", fileError);
          await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
          return new Response(JSON.stringify({ error: "Could not download file" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const arrayBuffer = await fileData.arrayBuffer();
        const fileSizeKB = arrayBuffer.byteLength / 1024;
        const fileSizeMB = fileSizeKB / 1024;
        console.log(`PDF file size: ${fileSizeMB.toFixed(2)} MB`);

        // For files over 25MB, reject gracefully
        if (arrayBuffer.byteLength > 25 * 1024 * 1024) {
          await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
          return new Response(JSON.stringify({ error: "PDF too large. Max 25MB. Please split into smaller files." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Convert PDF to base64 and send to Gemini which natively supports PDF
        const bytes = new Uint8Array(arrayBuffer);
        const CHUNK_SIZE = 32768;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
          const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
          binary += String.fromCharCode(...chunk);
        }
        const base64Pdf = btoa(binary);
        
        console.log("Sending PDF to Gemini for direct reading...");
        
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

        const pdfReadResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
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
              content = extractedText.substring(0, 50000);
            }
          } catch (jsonErr) {
            console.error("Gemini response JSON parse failed, using fallback:", jsonErr);
          }
        } else {
          console.error("Gemini PDF read failed:", pdfReadResponse.status);
          try { await pdfReadResponse.text(); } catch {}
        }

        // Fallback: manual binary text extraction if Gemini failed
        if (!content || content.length < 100) {
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
            content = extractedText.substring(0, 50000);
          } else {
            content = `PDF file uploaded: ${filePath}. The text could not be extracted automatically. Please paste the content manually.`;
          }
        }
      } catch (e) {
        console.error("PDF processing error:", e);
        // Don't fail entirely - if we got some content from fallback, continue
        if (!content || content.length < 100) {
          await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
          return new Response(JSON.stringify({ error: `PDF processing failed: ${e instanceof Error ? e.message : "Unknown error"}. Try a smaller file or paste text manually.` }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log("PDF had errors but fallback content available, continuing...");
      }
    } else if (url) {
      content = await extractUrlContent(url, supabaseUrl, supabaseKey, supabase);
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

    // For very long content, process in chunks to avoid AI token limits
    const MAX_CONTENT_LENGTH = 50000;
    const contentToProcess = content.substring(0, MAX_CONTENT_LENGTH);
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    console.log(`Processing ${contentToProcess.length} chars of content...`);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a sales & network marketing knowledge extractor. Extract actionable sales and prospecting knowledge from the content below.

Categorize each insight into one of these categories:
- opening_lines: Good ways to start conversations
- rapport_building: How to build trust and connection
- pain_discovery: How to uncover pain points and needs
- objection_handling: How to handle objections and resistance
- closing_techniques: How to close deals and get commitments
- trust_building: How to establish credibility
- prospecting: How to find and approach prospects
- network_marketing: Network marketing specific strategies
- general: General sales wisdom

Return JSON array of objects with: { "category": "...", "content": "...", "triggerPhrases": "..." }
Extract 10-25 chunks. Each chunk should be a standalone, actionable insight. 
For books, extract specific techniques, frameworks, scripts, and word-for-word phrases when available.
Make each chunk detailed enough to be useful on its own.`
          },
          { role: "user", content: `Extract sales knowledge from:\n\n${contentToProcess}` }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI error:", aiResponse.status);
      if (aiResponse.status === 429) {
        await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a minute." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabase.from("knowledge_base_items").update({ status: "error" }).eq("id", itemId);
      return new Response(JSON.stringify({ error: "AI processing failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let chunks: any[] = [];
    try {
      const jsonMatch = aiContent.match(/\[[\s\S]*\]/);
      chunks = JSON.parse(jsonMatch ? jsonMatch[0] : aiContent);
    } catch {
      chunks = [{ category: "general", content: aiContent.substring(0, 500), triggerPhrases: "" }];
    }

    // Store chunks
    for (const chunk of chunks) {
      await supabase.from("knowledge_chunks").insert({
        user_id: user.id,
        source_id: itemId,
        category: chunk.category || "general",
        content: chunk.content,
        brain_type: item.brain_type,
        trigger_phrases: chunk.triggerPhrases || "",
        relevance_score: 70,
        source_type: "content",
      });
    }

    // Update item status
    await supabase.from("knowledge_base_items").update({ status: "ready" }).eq("id", itemId);

    console.log(`Successfully processed ${chunks.length} knowledge chunks`);
    return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
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

// Extract content from URLs (YouTube, Instagram, regular web pages)
async function extractUrlContent(url: string, supabaseUrl: string, supabaseKey: string, supabase: any): Promise<string> {
  const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
  const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

  if (isInstagram) {
    return await extractInstagramContent(url, supabaseUrl, supabaseKey, supabase);
  } else if (isYouTube) {
    return await extractYouTubeContent(url);
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
    content = `Instagram URL: ${url}. Please analyze this Instagram profile/post based on the URL and extract any sales-relevant knowledge.`;
  }
  return content;
}

async function extractYouTubeContent(url: string): Promise<string> {
  let content = "";
  let videoId = "";
  try {
    const urlObj = new URL(url);
    videoId = url.includes("youtu.be") ? urlObj.pathname.slice(1) : (urlObj.searchParams.get("v") || "");
  } catch { /* ignore */ }

  if (videoId) {
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
          } catch (e) {
            console.error("Transcript fetch error:", e);
          }
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
    } catch (e) {
      console.error("YouTube fetch error:", e);
    }
  }

  if (!content || content.length < 50) {
    content = `YouTube video URL: ${url}. Please analyze this video based on the URL and any knowledge you have about it.`;
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
