import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (url.includes("youtu.be")) return u.pathname.slice(1);
    return u.searchParams.get("v");
  } catch { return null; }
}

function extractInstagramShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function extractInstagramUsername(url: string): string | null {
  // Match profile URLs like instagram.com/username (not /p/, /reel/, etc.)
  const match = url.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?$/);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url) throw new Error("URL required");

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
    const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

    // ===== YOUTUBE =====
    if (isYouTube) {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return new Response(JSON.stringify({ error: "Invalid YouTube URL" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      let title = "";
      let transcript = "";

      // Fetch page to get title and transcript
      try {
        const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const html = await res.text();
          const titleMatch = html.match(/<meta name="title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/);
          title = titleMatch?.[1]?.replace(" - YouTube", "") || "";

          // Try to get transcript
          const captionsUrlMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
          if (captionsUrlMatch) {
            try {
              const captionUrl = captionsUrlMatch[1].replace(/\\u0026/g, "&");
              const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
              if (captionRes.ok) {
                const captionXml = await captionRes.text();
                transcript = captionXml
                  .replace(/<[^>]+>/g, " ")
                  .replace(/&amp;/g, "&")
                  .replace(/&lt;/g, "<")
                  .replace(/&gt;/g, ">")
                  .replace(/&#39;/g, "'")
                  .replace(/&quot;/g, '"')
                  .replace(/\s+/g, " ")
                  .trim();
              }
            } catch (e) { console.error("Transcript fetch error:", e); }
          }
        }
      } catch (e) { console.error("YouTube fetch error:", e); }

      return new Response(JSON.stringify({
        type: "youtube",
        videoId,
        thumbnail,
        title,
        transcript: transcript.substring(0, 10000),
        hasTranscript: transcript.length > 50,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== INSTAGRAM =====
    if (isInstagram) {
      const shortcode = extractInstagramShortcode(url);
      const username = extractInstagramUsername(url);
      const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

      let thumbnail = "";
      let title = "";
      let transcript = "";
      let profileData: any = null;

      if (APIFY_API_KEY) {
        if (shortcode) {
          // It's a post/reel - use Instagram Post Scraper
          try {
            const actorRes = await fetch(
              `https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  directUrls: [url],
                  resultsLimit: 1,
                }),
                signal: AbortSignal.timeout(60000),
              }
            );
            if (actorRes.ok) {
              const results = await actorRes.json();
              const post = Array.isArray(results) && results.length > 0 ? results[0] : null;
              if (post) {
                thumbnail = post.displayUrl || post.thumbnailUrl || "";
                title = (post.caption || "").substring(0, 200);
                // For video/reel posts, the caption IS the transcript context
                if (post.type === "Video" || post.videoUrl) {
                  transcript = `[Instagram Reel/Video]\nCaption: ${post.caption || "No caption"}\nLikes: ${post.likesCount || 0}\nComments: ${post.commentsCount || 0}\n\nThis is a video post. The AI will analyze the caption and context to extract sales knowledge.`;
                } else {
                  transcript = `[Instagram Post]\nCaption: ${post.caption || "No caption"}\nLikes: ${post.likesCount || 0}\nComments: ${post.commentsCount || 0}`;
                }
              }
            }
          } catch (e) { console.error("Apify post scraper error:", e); }
        } else if (username) {
          // It's a profile URL - use Instagram Profile Scraper
          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const igRes = await fetch(`${supabaseUrl}/functions/v1/fetch-instagram`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({ username }),
              signal: AbortSignal.timeout(60000),
            });
            if (igRes.ok) {
              profileData = await igRes.json();
              thumbnail = profileData.profilePicUrl || "";
              title = `@${profileData.username} - ${profileData.fullName || ""}`;
              transcript = profileData.summary || `Bio: ${profileData.biography || "N/A"}\nFollowers: ${profileData.followersCount}\nPosts: ${profileData.postsCount}`;
            }
          } catch (e) { console.error("IG profile fetch error:", e); }
        }
      }

      return new Response(JSON.stringify({
        type: "instagram",
        thumbnail,
        title,
        transcript: transcript.substring(0, 10000),
        hasTranscript: transcript.length > 20,
        shortcode,
        username,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== REGULAR URL =====
    let title = "";
    let ogImage = "";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Bot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
        title = titleMatch?.[1] || "";
        const ogMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/) ||
                        html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:image"/);
        ogImage = ogMatch?.[1] || "";
      }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({
      type: "webpage",
      thumbnail: ogImage,
      title,
      transcript: "",
      hasTranscript: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("preview-url error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
