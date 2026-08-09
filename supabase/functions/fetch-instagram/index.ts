import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  extractInstagramUsername,
  isInstagramPostUrl,
  normalizeInstagramProfile,
  pickInstagramProfilePicture,
} from "./lib.ts";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const configuredOrigins = [Deno.env.get("SITE_URL"), Deno.env.get("APP_URL")].filter(Boolean) as string[];
  const isAllowed = origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://[::1]:") ||
    configuredOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

async function fetchInstagramProfile(username: string, apiKey: string): Promise<any | null> {
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

async function cacheProfilePicture(supabaseAdmin: any, userId: string, username: string, sourceUrl: string): Promise<string> {
  if (!sourceUrl) return "";
  try {
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LegacySalesCoach/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return sourceUrl;

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return sourceUrl;
    const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const safeUsername = username.replace(/[^a-z0-9._-]/gi, "_").toLowerCase() || "instagram";
    const path = `${userId}/instagram/${safeUsername}.${extension}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const { error } = await supabaseAdmin.storage.from("prospect-avatars").upload(path, bytes, {
      contentType,
      cacheControl: "86400",
      upsert: true,
    });
    if (error) {
      console.warn("Instagram avatar cache upload failed:", error.message);
      return sourceUrl;
    }
    return supabaseAdmin.storage.from("prospect-avatars").getPublicUrl(path).data.publicUrl || sourceUrl;
  } catch (error) {
    console.warn("Instagram avatar cache failed:", error);
    return sourceUrl;
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

  try {
    // Auth gate: require valid JWT or service-role key
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claims, error: claimsErr } = await supabaseAuth.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { username: rawInput } = await req.json();
    if (!rawInput) {
      return new Response(JSON.stringify({ error: "username or URL required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const username = extractInstagramUsername(rawInput);
    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) {
      throw new Error("APIFY_API_KEY is not configured");
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
        }
      );

      if (!postResponse.ok) {
        const errText = await postResponse.text();
        console.error("Apify Instagram post error:", postResponse.status, errText);
        throw new Error(`Apify Instagram post API error: ${postResponse.status}`);
      }

      const postResults = await postResponse.json();
      const post = Array.isArray(postResults) && postResults.length > 0 ? postResults[0] : null;
      if (!post) {
        return new Response(JSON.stringify({ error: "Instagram post not found", url: rawInput }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const postData = summarizePost(post, rawInput);
      let enriched: any = postData;
      if (postData.username && postData.username !== "unknown") {
        try {
          const profile = await fetchInstagramProfile(postData.username, APIFY_API_KEY);
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

      return new Response(JSON.stringify(enriched), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Fetching Instagram profile for: ${username}`);

    const profile = await fetchInstagramProfile(username, APIFY_API_KEY);

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found", username }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = normalizeInstagramProfile(profile, username);
    data.profilePicUrl = await cacheProfilePicture(supabaseAdmin, userId, data.username, data.profilePicUrl);
    const summary = buildProfileSummary(data);

    return new Response(JSON.stringify({ ...data, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("fetch-instagram error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
