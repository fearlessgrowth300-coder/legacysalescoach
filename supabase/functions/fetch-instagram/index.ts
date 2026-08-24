import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  avatarExtensionForContentType,
  avatarStoragePath,
  classifyApifyRunStatus,
  extractInstagramUsername,
  isInstagramPostUrl,
  normalizeInstagramProfile,
  pickInstagramProfilePicture,
} from "./lib.ts";

const AVATAR_BUCKET = "prospect-avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const configuredOrigins = [Deno.env.get("SITE_URL"), Deno.env.get("APP_URL")].filter(Boolean) as string[];
  const isAllowed = origin.endsWith(".vercel.app") || origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://[::1]:") ||
    configuredOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

async function startProfileRun(username: string, apiKey: string) {
  const response = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], resultsLimit: 1 }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) {
    const errText = await response.text();
    console.error("Apify run start error:", response.status, errText);
    throw new Error(`Apify Instagram profile API error: ${response.status}`);
  }
  const payload = await response.json();
  return {
    runId: payload?.data?.id as string,
    datasetId: payload?.data?.defaultDatasetId as string,
  };
}

async function getRunStatus(runId: string, apiKey: string): Promise<string> {
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const errText = await response.text();
    console.error("Apify run status error:", response.status, errText);
    throw new Error(`Apify run status error: ${response.status}`);
  }
  const payload = await response.json();
  return payload?.data?.status || "";
}

async function readFirstDatasetItem(datasetId: string, apiKey: string): Promise<any | null> {
  const response = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?limit=1&token=${apiKey}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) {
    const errText = await response.text();
    console.error("Apify dataset read error:", response.status, errText);
    throw new Error(`Apify dataset read error: ${response.status}`);
  }
  const items = await response.json();
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

/** Synchronous profile fetch, used only to enrich a post/reel owner. */
async function fetchInstagramProfileSync(username: string, apiKey: string): Promise<any | null> {
  const response = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], resultsLimit: 1 }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const errText = await response.text();
    console.error("Apify Instagram profile error:", response.status, errText);
    throw new Error(`Apify Instagram profile API error: ${response.status}`);
  }
  const results = await response.json();
  return Array.isArray(results) && results.length > 0 ? results[0] : null;
}

/**
 * Downloads the Instagram CDN avatar and stores it permanently in Cloud storage.
 * Returns "" when caching fails so the client can retry later instead of
 * persisting an expiring CDN URL.
 */
async function cacheProfilePicture(supabaseAdmin: any, userId: string, username: string, sourceUrl: string): Promise<string> {
  if (!sourceUrl) return "";
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LegacySalesCoach/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.warn("Instagram avatar download failed:", response.status);
      return "";
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      console.warn("Instagram avatar is not an image:", contentType);
      return "";
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_BYTES) {
      console.warn("Instagram avatar rejected by size:", bytes.byteLength);
      return "";
    }

    const extension = avatarExtensionForContentType(contentType);
    const path = avatarStoragePath(userId, username, extension);
    const { error } = await supabaseAdmin.storage.from(AVATAR_BUCKET).upload(path, bytes, {
      contentType,
      cacheControl: "86400",
      upsert: true,
    });
    if (error) {
      console.warn("Instagram avatar cache upload failed:", error.message);
      return "";
    }

    const { data: bucket } = await supabaseAdmin.storage.getBucket(AVATAR_BUCKET);
    if (bucket?.public) {
      return supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl || "";
    }
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError) {
      console.warn("Instagram avatar signing failed:", signError.message);
      return "";
    }
    return signed?.signedUrl || "";
  } catch (error) {
    console.warn("Instagram avatar cache failed:", error);
    return "";
  }
}

function buildProfileSummary(data: any): string {
  return [
    `Instagram Profile: @${data.username} (${data.fullName})`,
    `Bio: ${data.biography}`,
    `Followers: ${data.followersCount} | Following: ${data.followsCount} | Posts: ${data.postsCount}`,
    data.isBusinessAccount ? `Business Category: ${data.businessCategory}` : "",
    data.externalUrl ? `Website: ${data.externalUrl}` : "",
    "",
    "Recent Posts:",
    ...data.recentPosts.map((p: any, i: number) => `${i + 1}. ${p.caption || "No caption"} (${p.likes} likes, ${p.comments} comments)`),
  ].filter(Boolean).join("\n");
}

function summarizePost(post: any, inputUrl: string) {
  const shortcode = post.shortCode || post.shortcode || inputUrl.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i)?.[1] || "";
  const ownerUsername = post.ownerUsername || post.owner?.username || post.username || "unknown";
  const postUrl = post.url || post.inputUrl || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : inputUrl);
  const caption = post.caption || post.text || post.alt || "";
  const likes = post.likesCount || post.likes || 0;
  const comments = post.commentsCount || post.comments || 0;
  const views = post.videoViewCount || post.videoPlayCount || post.videoViewCountLatest || 0;
  const type = post.type || (views ? "Video" : "Post");

  const targetPost = {
    caption: caption.substring(0, 1200),
    likes,
    comments,
    views,
    type,
    url: postUrl,
    shortcode,
  };

  const summary = [
    `Instagram ${type === "Video" ? "Reel/Video" : "Post"} by @${ownerUsername}`,
    `Post URL: ${postUrl}`,
    caption ? `Caption: ${caption}` : "Caption: No caption found",
    `Likes: ${likes} | Comments: ${comments}${views ? ` | Views: ${views}` : ""}`,
    ...(post.latestComments || []).slice(0, 8).map((c: any) => `Comment by @${c.ownerUsername || c.username || "unknown"}: ${c.text || c.comment || ""}`),
  ].filter(Boolean).join("\n");

  return {
    username: ownerUsername,
    fullName: post.ownerFullName || post.owner?.fullName || "",
    biography: "",
    followersCount: 0,
    followsCount: 0,
    postsCount: 0,
    isVerified: post.ownerIsVerified || false,
    isBusinessAccount: false,
    businessCategory: "",
    externalUrl: "",
    profilePicUrl: pickInstagramProfilePicture(post),
    recentPosts: [targetPost],
    targetPost,
    isPost: true,
    summary,
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Auth gate: require valid JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { username: rawInput, runId, datasetId } = await req.json();
    if (!rawInput) {
      return json({ error: "username or URL required" }, 400);
    }

    const username = extractInstagramUsername(rawInput);
    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) {
      return json({ error: "APIFY_API_KEY is not configured — add it in Cloud secrets" }, 400);
    }
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userId = String(claims.claims.sub);

    if (isInstagramPostUrl(rawInput)) {
      console.log(`Fetching Instagram post/reel for: ${rawInput}`);
      const postResponse = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ directUrls: [rawInput], resultsLimit: 1 }),
          signal: AbortSignal.timeout(60000),
        },
      );

      if (!postResponse.ok) {
        const errText = await postResponse.text();
        console.error("Apify Instagram post error:", postResponse.status, errText);
        throw new Error(`Apify Instagram post API error: ${postResponse.status}`);
      }

      const postResults = await postResponse.json();
      const post = Array.isArray(postResults) && postResults.length > 0 ? postResults[0] : null;
      if (!post) {
        return json({ error: "Instagram post not found", url: rawInput }, 404);
      }

      const postData = summarizePost(post, rawInput);
      let enriched: any = postData;
      if (postData.username && postData.username !== "unknown") {
        try {
          const profile = await fetchInstagramProfileSync(postData.username, APIFY_API_KEY);
          if (profile) {
            const profileData = normalizeInstagramProfile(profile, postData.username);
            enriched = {
              ...profileData,
              isPost: true,
              targetPost: postData.targetPost,
              recentPosts: [postData.targetPost, ...profileData.recentPosts.filter((item: any) => item.url !== postData.targetPost.url)].slice(0, 5),
              summary: `${buildProfileSummary(profileData)}\n\nExact post/reel selected:\n${postData.summary}`,
            };
          }
        } catch (error) {
          console.warn("Owner profile enrichment failed; using exact post only:", error);
        }
      }
      enriched.profilePicUrl = await cacheProfilePicture(
        supabaseAdmin,
        userId,
        enriched.username || postData.username,
        enriched.profilePicUrl || postData.profilePicUrl,
      );

      return json(enriched);
    }

    // Asynchronous profile flow: start a run, then poll it from the client.
    if (!runId || !datasetId) {
      console.log(`Starting async Instagram profile run for: ${username}`);
      const started = await startProfileRun(username, APIFY_API_KEY);
      if (!started.runId || !started.datasetId) {
        return json({ error: "Could not start Instagram analysis — please try again" }, 502);
      }
      return json({ pending: true, runId: started.runId, datasetId: started.datasetId, retryAfterMs: 3000 }, 202);
    }

    const status = await getRunStatus(String(runId), APIFY_API_KEY);
    const state = classifyApifyRunStatus(status);
    if (state === "pending") {
      return json({ pending: true, runId, datasetId, retryAfterMs: 3000, status }, 202);
    }
    if (state === "failed") {
      return json({ error: `Instagram analysis ${status.toLowerCase() || "failed"} — please try again`, status }, 502);
    }

    const profile = await readFirstDatasetItem(String(datasetId), APIFY_API_KEY);
    if (!profile) {
      return json({ error: "Profile not found", username }, 404);
    }

    const data = normalizeInstagramProfile(profile, username);
    data.profilePicUrl = await cacheProfilePicture(supabaseAdmin, userId, data.username, data.profilePicUrl);
    const summary = buildProfileSummary(data);

    return json({ ...data, summary });
  } catch (error) {
    console.error("fetch-instagram error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
