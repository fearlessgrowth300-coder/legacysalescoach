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
  const match = input.match(/tiktok\.com\/@?([^/?#]+)/);
  if (match) return match[1].replace(/^@/, "");
  return input.replace(/^@/, "").trim();
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url, workspaceId, prospectId } = await req.json();
    if (!url) throw new Error("TikTok URL or username required");

    const username = extractUsername(url);
    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY is not configured");

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

    console.log(`Fetching TikTok profile for: @${username}`);

    // Use cloud9_ai/tiktok-scraper to get profile + recent videos
    const actorResponse = await fetch(
      `https://api.apify.com/v2/acts/cloud9_ai~tiktok-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: [username],
          maxVideos: 5,
          includeVideoDetails: true,
        }),
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!actorResponse.ok) {
      const errText = await actorResponse.text();
      console.error("Apify TikTok error:", actorResponse.status, errText);
      throw new Error(`Apify API error: ${actorResponse.status}`);
    }

    const results = await actorResponse.json();
    console.log("TikTok Apify results count:", results?.length);

    if (!Array.isArray(results) || results.length === 0) {
      return new Response(JSON.stringify({ error: "Profile not found", username }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Separate profile data from video data
    const profileItem = results.find((r: any) => r.type === "profile" || r.profileUrl || r.fans !== undefined) || results[0];
    const videos = results.filter((r: any) => r.type === "video" || r.videoUrl || r.text);

    const profileData = {
      username: profileItem.uniqueId || profileItem.username || username,
      nickname: profileItem.nickname || profileItem.name || "",
      bio: profileItem.signature || profileItem.bio || profileItem.biography || "",
      followersCount: profileItem.fans || profileItem.followersCount || profileItem.followerCount || 0,
      followingCount: profileItem.following || profileItem.followingCount || 0,
      likesCount: profileItem.heart || profileItem.likesCount || profileItem.totalLikes || 0,
      videoCount: profileItem.video || profileItem.videoCount || 0,
      profilePicUrl: profileItem.avatarLarger || profileItem.avatarMedium || profileItem.profilePicUrl || "",
      verified: profileItem.verified || false,
      recentVideos: videos.slice(0, 5).map((v: any) => ({
        caption: (v.text || v.desc || v.caption || "").substring(0, 500),
        likes: v.diggCount || v.likes || v.likesCount || 0,
        comments: v.commentCount || v.comments || v.commentsCount || 0,
        shares: v.shareCount || v.shares || 0,
        views: v.playCount || v.views || v.viewsCount || 0,
        url: v.webVideoUrl || v.videoUrl || "",
        hashtags: v.hashtags || [],
      })),
    };

    // Build summary for AI
    const summary = [
      `TikTok Profile: @${profileData.username} (${profileData.nickname})`,
      `Bio: ${profileData.bio}`,
      `Followers: ${profileData.followersCount} | Following: ${profileData.followingCount} | Likes: ${profileData.likesCount}`,
      `Videos: ${profileData.videoCount}`,
      "",
      "Recent Videos:",
      ...profileData.recentVideos.map((v: any, i: number) =>
        `${i + 1}. "${v.caption}" (${v.views} views, ${v.likes} likes, ${v.comments} comments)${v.hashtags?.length ? ` #${v.hashtags.join(" #")}` : ""}`
      ),
    ].filter(Boolean).join("\n");

    // Generate suggested comment using AI
    let suggestedComment = "";
    if (workspaceId && profileData.recentVideos.length > 0) {
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", workspaceId)
        .eq("user_id", user.id)
        .single();

      if (workspace) {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          const mostRecentVideo = profileData.recentVideos[0];
          const aiPrompt = `You are a TikTok engagement strategist. Your goal is to craft a comment on a prospect's recent TikTok video that will make them curious about you and trigger them to check your profile, follow you, or DM you.

MY BUSINESS CONTEXT:
- Business: ${workspace.name}
- Niche: ${workspace.niche_description || "Not specified"}
- Products: ${workspace.products_detected || "Not specified"}

PROSPECT'S PROFILE:
${summary}

MOST RECENT VIDEO TO COMMENT ON:
Caption: "${mostRecentVideo.caption}"
Views: ${mostRecentVideo.views}, Likes: ${mostRecentVideo.likes}
${mostRecentVideo.hashtags?.length ? `Hashtags: #${mostRecentVideo.hashtags.join(" #")}` : ""}

RULES:
1. The comment must feel natural, not salesy or spammy
2. Reference something SPECIFIC from their video caption or content
3. Add genuine value or a relatable insight from the same niche
4. Create curiosity that makes them want to check your profile
5. Keep it 1-3 sentences max
6. Don't use excessive emojis (max 1-2)
7. Position yourself as a peer in the same space, not a fan

Return JSON: { "comment": "...", "strategy": "brief explanation of why this works", "targetVideoCaption": "..." }`;

          try {
            const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: "You are a TikTok engagement expert. Return valid JSON only." },
                  { role: "user", content: aiPrompt },
                ],
                temperature: 0.7,
              }),
            });

            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const aiContent = aiData.choices?.[0]?.message?.content || "";
              try {
                const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);
                  suggestedComment = parsed.comment || "";
                  profileData.commentStrategy = parsed.strategy || "";
                  profileData.targetVideoCaption = parsed.targetVideoCaption || mostRecentVideo.caption;
                  profileData.targetVideoUrl = mostRecentVideo.url;
                }
              } catch { suggestedComment = aiContent.substring(0, 300); }
            }
          } catch (e) { console.error("AI comment generation error:", e); }
        }
      }
    }

    // Update prospect if prospectId provided
    if (prospectId) {
      await supabase.from("prospects").update({
        detected_interests: profileData.bio?.substring(0, 300) || null,
        profile_pic_url: profileData.profilePicUrl || null,
        tiktok_url: `https://tiktok.com/@${profileData.username}`,
        name: profileData.nickname || profileData.username,
        suggested_comment: suggestedComment || null,
      }).eq("id", prospectId);
    }

    return new Response(JSON.stringify({
      ...profileData,
      summary,
      suggestedComment,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("fetch-tiktok error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
