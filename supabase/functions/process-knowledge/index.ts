import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { itemId, url, type, filePath } = await req.json();
    
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

    if (type === "pdf" && filePath) {
      // Download PDF from storage and extract text
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

      // Extract text from PDF using AI vision
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

      const pdfExtractResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
                { type: "text", text: "Extract ALL text content from this PDF document. Return the full text content, preserving important structure. Do not summarize." },
                { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
              ],
            },
          ],
          temperature: 0.1,
        }),
      });

      if (pdfExtractResponse.ok) {
        const pdfData = await pdfExtractResponse.json();
        content = pdfData.choices?.[0]?.message?.content || "";
      }
    } else if (url) {
      // Check URL type
      const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
      const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

      if (isInstagram) {
        // Instagram URL - scrape page content
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const html = await res.text();
            // Extract meta content, alt text, and any JSON-LD data
            const metaDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)?.[1] || "";
            const metaTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/)?.[1] || "";
            const altTexts = [...html.matchAll(/alt="([^"]{10,})"/g)].map(m => m[1]).join("\n");
            const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
            let jsonLdText = "";
            if (jsonLdMatch) {
              try {
                const ld = JSON.parse(jsonLdMatch[1]);
                jsonLdText = JSON.stringify(ld, null, 2).substring(0, 3000);
              } catch { /* ignore */ }
            }
            // Strip HTML for remaining text
            const bodyText = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .substring(0, 5000);

            content = `Instagram Content from: ${url}\n\nTitle: ${metaTitle}\nDescription: ${metaDesc}\n\nImage descriptions:\n${altTexts}\n\nStructured data:\n${jsonLdText}\n\nPage text:\n${bodyText}`.substring(0, 15000);
          }
        } catch (e) {
          console.error("Instagram fetch error:", e);
        }

        if (!content || content.length < 50) {
          content = `Instagram URL: ${url}. Please analyze this Instagram profile/post based on the URL and extract any sales-relevant knowledge.`;
        }
      } else if (isYouTube) {
        // Extract video ID
        let videoId = "";
        try {
          const urlObj = new URL(url);
          if (url.includes("youtu.be")) {
            videoId = urlObj.pathname.slice(1);
          } else {
            videoId = urlObj.searchParams.get("v") || "";
          }
        } catch { /* ignore */ }

        if (videoId) {
          // Use AI to analyze YouTube video via its publicly available info
          // First try to get the transcript via an unofficial API
          try {
            const transcriptRes = await fetch(
              `https://www.youtube.com/watch?v=${videoId}`,
              {
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                signal: AbortSignal.timeout(15000),
              }
            );
            if (transcriptRes.ok) {
              const html = await transcriptRes.text();
              // Try to extract captions/transcript data from the page
              const captionMatch = html.match(/"captions":\s*(\{[^}]*"playerCaptionsTracklistRenderer"[^}]*\})/);
              
              // Extract video title and description from meta tags
              const titleMatch = html.match(/<meta name="title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/);
              const descMatch = html.match(/<meta name="description" content="([^"]*)"/);
              const title = titleMatch?.[1] || "";
              const description = descMatch?.[1] || "";

              // Get initial data JSON for more content
              const initialDataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
              let additionalContent = "";
              if (initialDataMatch) {
                try {
                  const ytData = JSON.parse(initialDataMatch[1]);
                  // Extract any available text content
                  const str = JSON.stringify(ytData);
                  const textParts = str.match(/"text":"([^"]{20,})"/g);
                  if (textParts) {
                    additionalContent = textParts
                      .map(p => p.replace(/"text":"/, "").replace(/"$/, ""))
                      .join(" ")
                      .substring(0, 5000);
                  }
                } catch { /* ignore */ }
              }

              // Try to get transcript via timedtext API
              const captionsUrlMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
              if (captionsUrlMatch) {
                try {
                  const captionUrl = captionsUrlMatch[1].replace(/\\u0026/g, "&");
                  const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
                  if (captionRes.ok) {
                    const captionXml = await captionRes.text();
                    const transcriptText = captionXml
                      .replace(/<[^>]+>/g, " ")
                      .replace(/&amp;/g, "&")
                      .replace(/&lt;/g, "<")
                      .replace(/&gt;/g, ">")
                      .replace(/&#39;/g, "'")
                      .replace(/&quot;/g, '"')
                      .replace(/\s+/g, " ")
                      .trim();
                    if (transcriptText.length > 100) {
                      content = `Video Title: ${title}\n\nTranscript:\n${transcriptText.substring(0, 15000)}`;
                    }
                  }
                } catch (e) {
                  console.error("Transcript fetch error:", e);
                }
              }

              // Fallback: use title + description + extracted text
              if (!content || content.length < 100) {
                content = `YouTube Video: ${title}\n\nDescription: ${description}\n\n${additionalContent}`.substring(0, 15000);
              }
            }
          } catch (e) {
            console.error("YouTube fetch error:", e);
          }
        }

        // Final fallback: ask AI to analyze based on whatever we have
        if (!content || content.length < 50) {
          content = `YouTube video URL: ${url}. Please analyze this video based on the URL and any knowledge you have about it.`;
        }
      } else {
        // Regular URL - fetch and extract text
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesCoachBot/1.0)" },
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) {
            const html = await res.text();
            content = html
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
      }
    }

    if (!content || content.length < 20) {
      await supabase
        .from("knowledge_base_items")
        .update({ status: "error" })
        .eq("id", itemId);
      return new Response(JSON.stringify({ error: "Could not extract content" }), {
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

    // Use AI to extract knowledge chunks
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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
            content: `You are a sales knowledge extractor. Extract actionable sales knowledge from the content below.

Categorize each insight into one of these categories:
- opening_lines: Good ways to start conversations
- rapport_building: How to build trust and connection
- pain_discovery: How to uncover pain points and needs
- objection_handling: How to handle objections and resistance
- closing_techniques: How to close deals and get commitments
- trust_building: How to establish credibility
- general: General sales wisdom

Return JSON array of objects with: { "category": "...", "content": "...", "triggerPhrases": "..." }
Extract 5-15 chunks. Each chunk should be a standalone, actionable insight.
Also include a "summary" field in each chunk that is a 1-sentence summary of what was learned.`
          },
          { role: "user", content: `Extract sales knowledge from:\n\n${content}` }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      console.error("AI error:", aiResponse.status);
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
