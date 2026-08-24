import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, userChat } from "../_shared/user-ai.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";


function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed =
    origin.endsWith(".vercel.app") || origin.endsWith(".lovable.app") ||
    origin.endsWith(".lovableproject.com") ||
    origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.vercel.app",
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
    const { url, workspaceId, prospectId, stashOutreach } = await req.json();
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

    const looksLikeVideo = (r: any) =>
      r && (r.type === "video" || r.webVideoUrl || r.videoUrl || r.playCount !== undefined ||
        r.diggCount !== undefined || typeof r.desc === "string" ||
        (typeof r.text === "string" && (r.diggCount !== undefined || r.playCount !== undefined || r.webVideoUrl)));

    // 1) Videos that came back as their own top-level dataset items
    let videoItems = results.filter(looksLikeVideo);

    // 2) Some scrapers nest the video list inside the profile object under one
    //    of several field names. Pull those in if the top level had none.
    if (videoItems.length === 0) {
      const nestedKeys = ["videos", "posts", "itemList", "topVideos", "latestVideos", "aweme_list", "items"];
      for (const item of results) {
        for (const key of nestedKeys) {
          if (Array.isArray(item?.[key]) && item[key].length) {
            videoItems = item[key].filter(looksLikeVideo);
            if (videoItems.length) break;
          }
        }
        if (videoItems.length) break;
      }
    }

    // Diagnostic: if we STILL have no videos, log the raw shape so we can see
    // what the actor actually returned for accounts that clearly have posts.
    if (videoItems.length === 0) {
      console.log("No videos parsed. results length:", results.length,
        "| profileItem keys:", profileItem ? Object.keys(profileItem).join(",") : "none",
        "| first result keys:", results[0] ? Object.keys(results[0]).join(",") : "none");
    } else {
      console.log(`Parsed ${videoItems.length} video items for @${username}`);
    }

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
          const hasPosts = profileData.recentVideos.length > 0;

          // ─── PULL THE USER'S BRAIN PRINCIPLES (RAG) ───
          // Embed a query built from the prospect + niche and semantically match
          // the user's sales_brain so the comment/DM apply their learned playbook.
          let principlesBlock = "";
          try {
            const brainQuery = [
              `Niche: ${workspace.niche_description || workspace.name}`,
              `Prospect bio: ${profileData.bio}`,
              hasPosts ? `Their recent posts: ${profileData.recentVideos.map((v: any) => v.caption).filter(Boolean).join(" | ")}` : "",
              "Write a relatable, magnetic comment/DM that makes them want to reach out.",
            ].filter(Boolean).join("\n");

            const emb = await generateEmbedding(brainQuery, supabase, user.id);
            if (emb) {
              const { data: matched } = await supabase.rpc("match_sales_brain", {
                query_embedding: JSON.stringify(emb),
                match_count: 40,
                match_threshold: 0.12,
                p_user_id: user.id,
              });
              const principles = (matched || [])
                .filter((p: any) => ["core_knowledge", "sales_principle", "content", "video", "pdf"].includes(p.source_type))
                .slice(0, 15);
              if (principles.length) {
                principlesBlock = principles.map((p: any) => {
                  const parts = [
                    p.principle_name && `• ${p.principle_name}`,
                    p.what_i_learned && `  What: ${p.what_i_learned}`,
                    p.how_to_apply && `  Apply: ${p.how_to_apply}`,
                    p.exact_words_to_use && `  Exact words: ${p.exact_words_to_use}`,
                  ].filter(Boolean);
                  return parts.join("\n");
                }).join("\n\n");
              }
            }
          } catch (e) { console.error("Brain retrieval error:", e); }

          const aiPrompt = `You are an elite TikTok outreach strategist. From a prospect's TikTok profile you produce outreach that makes the prospect WANT to talk to me — never salesy, never needy. You study their BIO and their POSTS to understand who they are, what they care about, what they're struggling with, and how they talk.

MY BUSINESS CONTEXT:
- Business: ${workspace.name}
- Niche: ${workspace.niche_description || "Not specified"}
- Products: ${workspace.products_detected || "Not specified"}
${principlesBlock ? `
MY SALES BRAIN — PRINCIPLES YOU MUST APPLY (my learned playbook from books/training):
${principlesBlock}

Every comment and DM you write MUST reflect these principles — the psychology, the framing, the exact-words style above. This is HOW I win. Do not ignore it.
` : ""}
PROSPECT'S PROFILE:
${summary}

${hasPosts ? `THEIR POSTS (analyze ALL of them):
${profileData.recentVideos.map((v: any, i: number) => `${i + 1}. Caption: "${v.caption}" | Views: ${v.views} | Likes: ${v.likes} | Comments: ${v.comments} | URL: ${v.url}`).join("\n")}` : `THIS PROSPECT HAS NO ANALYZABLE POSTS. Work from their bio and profile only. Set "hasPosts": false, leave "comment", "targetVideoCaption", "targetVideoUrl" empty, and focus everything on the DM opener built from their bio.`}

DEEPLY UNDERSTAND THE PERSON FIRST:
Read the bio and every post. Figure out: their niche, their goal/dream, their frustration or struggle, their personality and tone. Everything you write must sound like it came from someone who actually watched their content — specific, human, and impossible to mistake for a copy-paste.

${hasPosts ? `STEP 1 — PICK THE ONE POST TO COMMENT ON:
Choose the single post that gives the strongest opening — one where they revealed a real opinion, struggle, or win you can genuinely relate to. Not so viral your comment gets buried. Note its position number (1 = most recent), exact likes and views.

STEP 2 — WRITE THE COMMENT (this is the most important output):
Write a comment to leave ON that post that makes the owner think "I NEED to talk to this person — it would be dumb not to." Rules:
- RELATABLE FIRST: reference the SPECIFIC point they made and agree with it in a way that makes them nod "yes, exactly / so true." They should feel understood and seen.
- Then add ONE sharp, specific insight or lived experience that proves you actually know this space at a level they'd want access to — plant an open loop / curiosity so NOT reaching out feels like leaving value on the table.
- Peer to peer, never a fan. No "great content", no generic praise, no emojis-spam (1-2 max).
- DO NOT beg for a DM or pitch anything. No "DM me to learn more". Make them WANT to come to you. A soft open-ended hook is fine ("wild how few people talk about X"), but the pull comes from value + relatability, not a demand.
- 2-4 sentences, sounds like how a real person types.` : `STEP 1 — SKIP THE COMMENT (no posts). Build the DM opener from the bio.`}

STEP 3 — WRITE A DM / INBOX OPENER ("dmMessage"):
A first message I can send straight to their inbox. It must:
- Open by referencing something real from their bio or a post so it's clearly personal, not a template
- Be warm, human, curious — like a peer reaching out, NOT a sales pitch (never mention my product/offer)
- End with a genuine, easy-to-answer question that makes replying feel natural
- 1-3 short sentences. This should get a reply.

Return JSON: { "comment": "${hasPosts ? "the relatable, magnetic comment" : ""}", "strategy": "why the comment works on THIS person (empty if no posts)", "targetVideoCaption": "exact caption of the chosen post (empty if no posts)", "targetVideoUrl": "URL of the chosen post (empty if no posts)", "whyThisVideo": "why this post over the others (empty if no posts)", "postNumber": ${hasPosts ? "1" : "null"}, "videoLikes": ${hasPosts ? "1234" : "null"}, "videoViews": ${hasPosts ? "56789" : "null"}, "dmMessage": "the non-salesy inbox opener", "hasPosts": ${hasPosts} }`;

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
                  profileData.whyThisVideo = parsed.whyThisVideo || "";
                  profileData.dmMessage = parsed.dmMessage || "";
                  profileData.hasPosts = parsed.hasPosts !== false;

                  // CRITICAL: Use postNumber to look up the REAL scraped video
                  // Never trust AI-fabricated URLs/captions/stats.
                  const pNum = Number(parsed.postNumber);
                  const chosenVideo = (pNum && pNum >= 1 && pNum <= profileData.recentVideos.length)
                    ? profileData.recentVideos[pNum - 1]
                    : profileData.recentVideos[0];

                  if (chosenVideo) {
                    const idx = profileData.recentVideos.indexOf(chosenVideo);
                    profileData.postNumber = idx + 1;
                    profileData.targetVideoCaption = chosenVideo.caption || "";
                    profileData.targetVideoUrl = chosenVideo.url || "";
                    profileData.videoLikes = chosenVideo.likes || null;
                    profileData.videoViews = chosenVideo.views || null;
                  }
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

      // Stash the pre-follow outreach asset (DM opener) in the
      // existing suggested_first_message column as a JSON object. Pending
      // prospects never open the chat before Follow Back overwrites this with a
      // suggestions array, so there's no collision with the chat consumer.
      // Only the Analyze (pending-prospect) flow stashes these; the New
      // Conversation flow opens the chat immediately and needs
      // suggested_first_message left for its opener suggestions array.
      const outreachAssets = (stashOutreach && profileData.dmMessage)
        ? JSON.stringify({ dm: profileData.dmMessage || "" })
        : undefined;

      await supabase.from("prospects").update({
        detected_interests: profileData.bio?.substring(0, 300) || null,
        profile_pic_url: profileData.profilePicUrl || null,
        tiktok_url: `https://tiktok.com/@${profileData.username}`,
        name: profileData.nickname || profileData.username,
        suggested_comment: suggestedComment || null,
        target_video_url: profileData.targetVideoUrl || null,
        target_video_caption: enrichedCaption,
        ...(outreachAssets !== undefined ? { suggested_first_message: outreachAssets } : {}),
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
