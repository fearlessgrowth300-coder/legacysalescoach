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

function extractUsername(input: string): string {
  // Handle full URLs or plain usernames
  const match = input.match(/instagram\.com\/([^/?#]+)/);
  if (match) return match[1];
  return input.replace(/^@/, "").trim();
}

function isInstagramPostUrl(input: string): boolean {
  return /instagram\.com\/(?:p|reel|tv)\//i.test(input);
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
    profilePicUrl: post.ownerProfilePicUrl || "",
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

    const username = extractUsername(rawInput);
    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) {
      throw new Error("APIFY_API_KEY is not configured");
    }

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

      return new Response(JSON.stringify(summarizePost(post, rawInput)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Fetching Instagram profile for: ${username}`);

    // Run the Apify Instagram Profile Scraper actor synchronously
    const actorResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: [username],
          resultsLimit: 1,
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!actorResponse.ok) {
      const errText = await actorResponse.text();
      console.error("Apify error:", actorResponse.status, errText);
      throw new Error(`Apify API error: ${actorResponse.status}`);
    }

    const results = await actorResponse.json();
    const profile = Array.isArray(results) && results.length > 0 ? results[0] : null;

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found", username }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract the most useful data
    const data = {
      username: profile.username || username,
      fullName: profile.fullName || "",
      biography: profile.biography || "",
      followersCount: profile.followersCount || 0,
      followsCount: profile.followsCount || 0,
      postsCount: profile.postsCount || 0,
      isVerified: profile.verified || false,
      isBusinessAccount: profile.isBusinessAccount || false,
      businessCategory: profile.businessCategoryName || "",
      externalUrl: profile.externalUrl || "",
      profilePicUrl: profile.profilePicUrlHD || profile.profilePicUrl || "",
      // Recent posts for context
      recentPosts: (profile.latestPosts || []).slice(0, 5).map((post: any) => ({
        caption: (post.caption || "").substring(0, 300),
        likes: post.likesCount || 0,
        comments: post.commentsCount || 0,
        type: post.type || "unknown",
      })),
    };

    // Build a text summary for AI consumption
    const summary = [
      `Instagram Profile: @${data.username} (${data.fullName})`,
      `Bio: ${data.biography}`,
      `Followers: ${data.followersCount} | Following: ${data.followsCount} | Posts: ${data.postsCount}`,
      data.isBusinessAccount ? `Business Category: ${data.businessCategory}` : "",
      data.externalUrl ? `Website: ${data.externalUrl}` : "",
      "",
      "Recent Posts:",
      ...data.recentPosts.map((p: any, i: number) => `${i + 1}. ${p.caption} (${p.likes} likes, ${p.comments} comments)`),
    ].filter(Boolean).join("\n");

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
