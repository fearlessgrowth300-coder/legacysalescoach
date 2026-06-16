import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat } from "../_shared/user-ai.ts";


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
    // Some scrapers return a single merged object with both profile + video fields
    const profileItem = results.find((r: any) => r.type === "profile" || r.profileUrl || r.fans !== undefined) || results[0];
    const videos = results.filter((r: any) => r.type === "video" || r.videoUrl || r.text || r.desc || r.playCount);
    
    // If no separate videos found, treat all results as potential videos (scrapers sometimes merge everything)
    const videoItems = videos.length > 0 ? videos : results.filter((r: any) => r.text || r.desc || r.playCount);

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
      recentVideos: videoItems.slice(0, 5).map((v: any) => ({
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
    if (workspaceId) {
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("*")
        .eq("id", workspaceId)
        .eq("user_id", user.id)
        .single();

      if (workspace) {
        let chat: any = null;
        try { chat = await resolveUserChatTarget(supabase, user.id); } catch { /* skip AI when no key */ }
        if (chat) {
          const mostRecentVideo = profileData.recentVideos[0] || null;

          const videoContext = mostRecentVideo
            ? `MOST RECENT VIDEO TO COMMENT ON:\nCaption: "${mostRecentVideo.caption}"\nViews: ${mostRecentVideo.views}, Likes: ${mostRecentVideo.likes}\n${mostRecentVideo.hashtags?.length ? `Hashtags: #${mostRecentVideo.hashtags.join(" #")}` : ""}`
            : `No specific videos found. Use their bio and profile info to craft a comment that would work on any of their posts.`;

          const aiPrompt = `You are a TikTok engagement strategist and DM funnel expert. Your goal is to craft a comment that is SO compelling the prospect HAS to reply, DM you, or follow you. The comment must act as a MAGNET that pulls them into your inbox.

MY BUSINESS CONTEXT:
- Business: ${workspace.name}
- Niche: ${workspace.niche_description || "Not specified"}
- Products: ${workspace.products_detected || "Not specified"}

PROSPECT'S PROFILE:
${summary}

AVAILABLE VIDEOS TO COMMENT ON:
${profileData.recentVideos.map((v: any, i: number) => `${i + 1}. Caption: "${v.caption}" | Views: ${v.views} | Likes: ${v.likes} | Comments: ${v.comments} | URL: ${v.url}`).join("\n")}

STEP 1 — CHOOSE THE BEST VIDEO TO COMMENT ON:
Analyze ALL their videos above. Pick the ONE video that:
- Is most relevant to my niche/business
- Has good engagement (not dead, but not so viral that my comment gets buried)
- Has content that gives you the best opening to write a compelling, niche-specific comment
- Allows you to naturally position yourself as someone they'd want to connect with

IMPORTANT: Note the video's position number from the list above (1 = most recent, 2 = second most recent, etc.) and include its exact likes and views count so the user can find it on TikTok.

STEP 2 — WRITE A KILLER COMMENT WITH CTA:
The comment MUST include:
1. **Specific Reference**: Mention something SPECIFIC from that video's caption or content
2. **Peer Positioning**: Show you're in the same space, not a fan — you're an equal
3. **Value Hook**: Share a quick insight, relatable experience, or bold take that adds value
4. **STRONG CTA**: End with a clear call-to-action that drives them to DM you or check your profile. Examples:
   - "I've been testing something similar — can you DM me? Would love to compare notes 🤝"
   - "I actually have some ideas on this that might help — shoot me a DM if you're open to it"
   - "This is exactly what I've been working on too — let's connect, DM me!"
   - "Would love to pick your brain on this — mind if we chat in DMs?"

RULES:
- The comment must feel natural, not spammy — like a peer genuinely engaging
- The CTA must feel like a BENEFIT to them, not just for you
- Keep it 2-4 sentences max
- Max 1-2 emojis
- NO generic praise like "great content!" or "love this!"
- The comment should make OTHER viewers curious about you too
- Position the DM request as mutually beneficial

Return JSON: { "comment": "the full comment with CTA", "strategy": "why this comment + CTA will work on this specific prospect", "targetVideoCaption": "exact caption of the chosen video", "targetVideoUrl": "URL of the chosen video", "whyThisVideo": "why you picked this specific video over others", "postNumber": 1, "videoLikes": 1234, "videoViews": 56789 }`;

          try {
            const aiRes = await userChat(chat, {
              model: chat.models.reasoning,
              messages: [
                { role: "system", content: "You are a TikTok engagement expert. Return valid JSON only." },
                { role: "user", content: aiPrompt },
              ],
              temperature: 0.7,
              response_format: { type: "json_object" },
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
                  profileData.targetVideoCaption = parsed.targetVideoCaption || "";
                  profileData.targetVideoUrl = parsed.targetVideoUrl || "";
                  profileData.whyThisVideo = parsed.whyThisVideo || "";
                  profileData.postNumber = parsed.postNumber || null;
                  profileData.videoLikes = parsed.videoLikes || null;
                  profileData.videoViews = parsed.videoViews || null;
                }
              } catch { suggestedComment = aiContent.substring(0, 300); }
            }
          } catch (e) { console.error("AI comment generation error:", e); }
        }
      }
    }

    // Update prospect if prospectId provided
    if (prospectId) {
      // Build enriched caption with stats for easy identification
      const statsPrefix = [
        profileData.postNumber ? `Post #${profileData.postNumber} from top` : null,
        profileData.videoLikes ? `❤️ ${profileData.videoLikes.toLocaleString()} likes` : null,
        profileData.videoViews ? `👁 ${profileData.videoViews.toLocaleString()} views` : null,
      ].filter(Boolean).join(" · ");
      const enrichedCaption = statsPrefix 
        ? `${statsPrefix}\n${profileData.targetVideoCaption || ""}`
        : profileData.targetVideoCaption || null;

      await supabase.from("prospects").update({
        detected_interests: profileData.bio?.substring(0, 300) || null,
        profile_pic_url: profileData.profilePicUrl || null,
        tiktok_url: `https://tiktok.com/@${profileData.username}`,
        name: profileData.nickname || profileData.username,
        suggested_comment: suggestedComment || null,
        target_video_url: profileData.targetVideoUrl || null,
        target_video_caption: enrichedCaption,
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
