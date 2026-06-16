// Conversion learning loop.
//
// When a prospect is marked "won", embed the AI suggestions that were actually
// used in that conversation, find the closest principles in the user's brain, and
// boost their ranking (relevance_score) + a win counter. Over time the brain
// leans on the principles that genuinely CLOSE deals for this user — not just
// what a book said. Non-destructive, idempotent-ish (each win adds a small boost).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserEmbedTarget, userEmbed, NoUserAiKeyError } from "../_shared/user-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WIN_BOOST = 6;       // relevance_score points added per win
const MAX_SCORE = 100;
const MATCH_COUNT = 12;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { prospectId } = await req.json();
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    if (!prospectId) return new Response(JSON.stringify({ error: "prospectId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const json = (body: any) => new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });

    // 1. The AI suggestions that were actually used in this (won) conversation —
    //    plus any replies the user thumbs-upped. That's the "what closed it" signal.
    const [{ data: usedMsgs }, { data: liked }] = await Promise.all([
      supabase.from("chat_messages")
        .select("content")
        .eq("prospect_id", prospectId).eq("user_id", user.id)
        .eq("is_ai_suggestion", true).eq("direction", "outbound")
        .order("created_at", { ascending: true }).limit(40),
      supabase.from("suggestion_feedback")
        .select("suggestion_text")
        .eq("prospect_id", prospectId).eq("user_id", user.id).eq("feedback", "positive")
        .limit(40),
    ]);

    const winningText = [
      ...(usedMsgs || []).map((m: any) => m.content),
      ...(liked || []).map((m: any) => m.suggestion_text),
    ].filter((t: any) => typeof t === "string" && t.trim()).join("\n").slice(0, 6000);

    if (winningText.trim().length < 10) {
      return json({ success: true, boosted: 0, reason: "no used/liked suggestions to learn from yet" });
    }

    // 2. Embed the winning replies (user's own embedding key) and find closest principles.
    let embedTarget;
    try {
      embedTarget = await resolveUserEmbedTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) return json({ success: true, boosted: 0, reason: "no embedding key" });
      throw e;
    }
    const emb = await userEmbed(embedTarget, winningText);
    if (!emb) return json({ success: true, boosted: 0, reason: "embedding failed" });

    const { data: matches } = await supabase.rpc("match_sales_brain", {
      query_embedding: JSON.stringify(emb),
      match_count: MATCH_COUNT,
      match_threshold: 0.1,
      p_user_id: user.id,
    });
    const ids = (matches || []).map((m: any) => m.id).filter(Boolean);
    if (ids.length === 0) return json({ success: true, boosted: 0, reason: "no matching principles" });

    // 3. Boost those principles: +WIN_BOOST relevance (capped) and a win counter.
    const { data: rows } = await supabase.from("sales_brain")
      .select("id, relevance_score, metadata, principle_name")
      .in("id", ids);

    let boosted = 0;
    const names: string[] = [];
    for (const r of rows || []) {
      const meta = (r.metadata && typeof r.metadata === "object") ? r.metadata : {};
      const wins = (Number(meta.wins) || 0) + 1;
      const newScore = Math.min(MAX_SCORE, (Number(r.relevance_score) || 70) + WIN_BOOST);
      const { error } = await supabase.from("sales_brain")
        .update({ relevance_score: newScore, metadata: { ...meta, wins, last_won_at: new Date().toISOString() } })
        .eq("id", r.id);
      if (!error) { boosted++; if (r.principle_name) names.push(r.principle_name); }
    }

    console.log(`[record-conversion] prospect ${prospectId}: boosted ${boosted} principles`);
    return json({ success: true, boosted, principles: names.slice(0, 8) });
  } catch (e) {
    console.error("record-conversion error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
