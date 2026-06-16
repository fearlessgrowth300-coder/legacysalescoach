import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { describeApiKey, getLatestUserApiKey, getAllUserApiKeys } from "../_shared/api-key-utils.ts";

const defaultCorsHeaders = {
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
  const match = url.match(/instagram\.com\/([A-Za-z0-9_.]+)\/?$/);
  return match ? match[1] : null;
}

function extractUserIdFromJwt(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded));

    return typeof decoded?.sub === "string" ? decoded.sub : null;
  } catch (error) {
    console.warn("Failed to decode auth token payload:", error);
    return null;
  }
}

async function resolveUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      console.warn("Auth lookup failed, falling back to JWT payload:", error.message);
    }

    if (data?.user?.id) {
      return data.user.id;
    }
  } catch (error) {
    console.warn("Auth lookup threw, falling back to JWT payload:", error);
  }

  const fallbackUserId = extractUserIdFromJwt(token);
  if (fallbackUserId) {
    console.log("Resolved user ID from JWT payload fallback");
  }

  return fallbackUserId;
}

async function getUserTranscriptApiKeys(userId: string | null): Promise<{ key: string; label: string }[]> {
  if (!userId) return [];
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rows = await getAllUserApiKeys(supabase, userId, ["supadata", "transcriptapi"]);
    return rows.map((r) => ({ key: r.key, label: `user:${r.label}` }));
  } catch (e) { console.error("Failed to fetch user API keys:", e); return []; }
}

async function fetchYouTubeData(videoId: string, userId: string | null = null) {
  let title = "";
  let transcript = "";
  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  // 1. Get title via oembed API (reliable)
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      title = oembed.title || "";
    }
  } catch (e) { console.error("YouTube oembed error:", e); }

  // 2. Try TranscriptAPI.com — rotate through ALL user keys, then global fallback.
  const userKeys = await getUserTranscriptApiKeys(userId);
  const globalKey = Deno.env.get("SUPADATA_API_KEY");
  const seen = new Set<string>();
  const keysToTry: { key: string; label: string }[] = [];
  for (const k of userKeys) {
    if (seen.has(k.key)) continue;
    keysToTry.push(k); seen.add(k.key);
  }
  if (globalKey && !seen.has(globalKey)) keysToTry.push({ key: globalKey, label: "global fallback" });
  console.log(`[preview-url] Trying ${keysToTry.length} transcript key(s)`);

  for (const { key, label } of keysToTry) {
    if (transcript && transcript.length > 50) break;
    try {
      console.log(`Trying TranscriptAPI.com (${label})`, describeApiKey(key));
      const sdRes = await fetch(
        `https://transcriptapi.com/api/v2/youtube/transcript?video_url=${videoId}&format=json`,
        {
          headers: { "Authorization": `Bearer ${key}` },
          signal: AbortSignal.timeout(30000),
        }
      );
      console.log(`TranscriptAPI status (${label}):`, sdRes.status);
      if (sdRes.ok) {
        const sdData = await sdRes.json();
        if (sdData.transcript && typeof sdData.transcript === "string" && sdData.transcript.length > 50) {
          transcript = sdData.transcript;
        } else if (sdData.text && typeof sdData.text === "string" && sdData.text.length > 50) {
          transcript = sdData.text;
        } else if (Array.isArray(sdData.transcript)) {
          transcript = sdData.transcript.map((c: any) => c.text || c.content || "").join(" ");
        } else if (sdData.content && typeof sdData.content === "string" && sdData.content.length > 50) {
          transcript = sdData.content;
        }
        console.log(`TranscriptAPI transcript length (${label}):`, transcript.length);
      } else {
        const errBody = await sdRes.text();
        console.warn(`TranscriptAPI error (${label}):`, sdRes.status, errBody);
        if ([401, 402, 403, 429].includes(sdRes.status)) continue;
      }
    } catch (e) { console.error(`TranscriptAPI error (${label}):`, e); }
  }

  // 3. Fallback: watch page scraping
  if (!transcript || transcript.length < 50) {
    try {
      console.log("Trying watch page method for transcript...");
      const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Cookie": "CONSENT=PENDING+987",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (watchRes.ok) {
        const html = await watchRes.text();
        const captionUrls = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/g);
        if (captionUrls && captionUrls.length > 0) {
          const captionUrl = captionUrls[0]
            .replace(/"baseUrl":"/, "")
            .replace(/"$/, "")
            .replace(/\\u0026/g, "&");
          const captionRes = await fetch(captionUrl, { signal: AbortSignal.timeout(10000) });
          if (captionRes.ok) {
            const captionXml = await captionRes.text();
            transcript = captionXml
              .replace(/<[^>]+>/g, " ")
              .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
              .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
              .replace(/\s+/g, " ").trim();
          }
        }
        if (!transcript || transcript.length < 50) {
          const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
          if (descMatch) {
            const desc = descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
            if (desc.length > 50) transcript = `[Video Description]\n${desc}`;
          }
        }
      }
    } catch (e) { console.error("YouTube transcript error:", e); }
  }

  return { thumbnail, title, transcript: transcript.substring(0, 15000) };
}

async function fetchInstagramData(url: string, shortcode: string | null, username: string | null) {
  const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
  let thumbnail = "";
  let title = "";
  let transcript = "";

  if (!APIFY_API_KEY) {
    console.error("APIFY_API_KEY not configured");
    return { thumbnail, title, transcript };
  }

  if (shortcode) {
    // It's a post/reel - use Instagram Reel Scraper (accepts both reel and post URLs via "username" field)
    try {
      console.log("Fetching Instagram content via Apify:", url);
      
      const actorRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: [url],
            resultsLimit: 1,
            includeTranscript: true,
          }),
          signal: AbortSignal.timeout(120000),
        }
      );
      console.log("Apify reel scraper status:", actorRes.status);
      
      if (actorRes.ok) {
        const results = await actorRes.json();
        console.log("Apify results count:", results?.length);
        const post = Array.isArray(results) && results.length > 0 ? results[0] : null;
        if (post) {
          console.log("Post keys:", Object.keys(post).join(", "));
          if (post.error) {
            console.log("Apify post warning:", post.error, post.errorDescription);
          }
          // Extract whatever data is available (even partial from restricted pages)
          thumbnail = post.displayUrl || post.thumbnailUrl || post.imageUrl || post.videoThumbnailUrl || "";
          const postCaption = post.caption || "";
          title = postCaption.substring(0, 200) || (post.ownerUsername ? `@${post.ownerUsername}` : "");
          const caption = postCaption || "No caption available (restricted content)";
          const isVideo = post.type === "Video" || !!post.videoUrl;
          const reelTranscript = post.transcript || "";
          
          if (postCaption || post.likesCount || reelTranscript) {
            transcript = isVideo
              ? `[Instagram Reel/Video]\nCaption: ${caption}\nLikes: ${post.likesCount || 0}\nComments: ${post.commentsCount || 0}\nOwner: @${post.ownerUsername || "unknown"}${reelTranscript ? "\n\nTranscript:\n" + reelTranscript : ""}`
              : `[Instagram Post]\nCaption: ${caption}\nLikes: ${post.likesCount || 0}\nComments: ${post.commentsCount || 0}\nOwner: @${post.ownerUsername || "unknown"}`;
          } else if (post.error === "restricted_page") {
            transcript = `[Instagram Content - Restricted Access]\nThis content has restricted access. Limited data could be extracted.\nURL: ${url}`;
          }
        }
      } else {
        const errText = await actorRes.text();
        console.error("Apify reel scraper error:", actorRes.status, errText);
      }
    } catch (e) { console.error("Apify scraper error:", e); }
  } else if (username) {
    // It's a profile URL
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
        signal: AbortSignal.timeout(90000),
      });
      if (igRes.ok) {
        const profileData = await igRes.json();
        thumbnail = profileData.profilePicUrl || "";
        title = `@${profileData.username} - ${profileData.fullName || ""}`;
        transcript = profileData.summary || `Bio: ${profileData.biography || "N/A"}\nFollowers: ${profileData.followersCount}\nPosts: ${profileData.postsCount}`;
      }
    } catch (e) { console.error("IG profile fetch error:", e); }
  }

  return { thumbnail, title, transcript: transcript.substring(0, 10000) };
}

serve(async (req) => {
  const corsHeaders = defaultCorsHeaders;
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url) throw new Error("URL required");

    const userId = await resolveUserId(req.headers.get("Authorization"));
    if (!userId) {
      console.log("No authenticated user resolved for preview-url; using global fallback only");
    }

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");
    const isInstagram = url.includes("instagram.com") || url.includes("instagr.am");

    if (isYouTube) {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return new Response(JSON.stringify({ error: "Invalid YouTube URL" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ytData = await fetchYouTubeData(videoId, userId);
      return new Response(JSON.stringify({
        type: "youtube",
        videoId,
        ...ytData,
        hasTranscript: ytData.transcript.length > 50,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (isInstagram) {
      const shortcode = extractInstagramShortcode(url);
      const username = extractInstagramUsername(url);
      const igData = await fetchInstagramData(url, shortcode, username);
      return new Response(JSON.stringify({
        type: "instagram",
        ...igData,
        hasTranscript: igData.transcript.length > 20,
        shortcode,
        username,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Regular URL
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
      type: "webpage", thumbnail: ogImage, title, transcript: "", hasTranscript: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("preview-url error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
