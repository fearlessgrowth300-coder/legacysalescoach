// Dev-only debug surface for the Layer-2 reasoning prompt.
// POST { question: string, candidatePrincipleIds?: string[] }  (if omitted, uses live retrieval)
// Returns the JSON the selection prompt produced + retrieval debug info.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { runPipeline, buildSessionContext, selectPrinciples } from "../_shared/brain-pipeline.ts";
import { resolveUserChatTarget, NoUserAiKeyError } from "../_shared/user-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { question, candidatePrincipleIds } = await req.json();
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const session = await buildSessionContext(supabase, null, [{ role: "user", content: question }]);

    // Mode A: caller provided explicit candidate ids — load and run only Step 4
    if (Array.isArray(candidatePrincipleIds) && candidatePrincipleIds.length > 0) {
      const { data: rows } = await supabase.from("sales_brain")
        .select("id, principle_name, what_i_learned, how_to_apply, source_name, source_id, category, source_type, relevance_score, power_level, exact_words_to_use, the_deep_why, when_to_use, when_not_to_use, common_mistake, real_example_or_story")
        .in("id", candidatePrincipleIds).eq("user_id", user.id);
      const reasoning = await selectPrinciples(apiKey, question, (rows || []) as any, session);
      return new Response(JSON.stringify({ mode: "manual", question, reasoning }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Mode B: full pipeline (Layers 1+2)
    const out = await runPipeline({ apiKey, supabaseAdmin: supabase, userId: user.id, question, session });
    return new Response(JSON.stringify({ mode: "full", question, ...out }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
