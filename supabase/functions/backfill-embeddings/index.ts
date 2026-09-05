import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserEmbedTarget } from "../_shared/user-ai.ts";
import { embedBatch } from "../_shared/embedding-batch.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key);
    const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    const auth = token === key && typeof body.user_id === "string"
      ? await db.auth.admin.getUserById(body.user_id) : await db.auth.getUser(token || "");
    if (auth.error || !auth.data.user) return json({ error: "Unauthorized" }, 401);
    const userId = auth.data.user.id;
    const target = await resolveUserEmbedTarget(db, userId);
    const modelId = `${target.provider}:${target.model}:768`;
    const filter = (query: any) => body.reindex
      ? query.or(`embedding.is.null,metadata->>embedding_model.is.null,metadata->>embedding_model.neq.${modelId}`)
      : query.is("embedding", null);
    let updatedBrain = 0, updatedChunks = 0;
    let attempted = 0;
    const failed: string[] = [];
    for (const table of ["sales_brain", "knowledge_chunks"] as const) {
      const budget = 32 - attempted;
      if (budget <= 0) break;
      const fields = table === "sales_brain" ? "id,metadata,principle_name,what_i_learned,how_to_apply,source_name" : "id,metadata,content";
      const result = await filter(db.from(table).select(fields).eq("user_id", userId)).order("id").limit(budget);
      if (result.error) throw result.error;
      const rows = (result.data || []) as any[];
      attempted += rows.length;
      const textOf = (row: any) => table === "sales_brain"
        ? [row.source_name,row.principle_name,row.what_i_learned,row.how_to_apply].filter(Boolean).join("\n") : (row.content || "").trim();
      const valid = rows.filter(row => textOf(row).length > 0);
      rows.filter(row => !textOf(row)).forEach(row => failed.push(row.id));
      if (!valid.length) continue;
      const vectors = await embedBatch(target, valid.map(textOf));
      for (let i = 0; i < valid.length; i++) {
        const row = valid[i];
        const result = await db.from(table).update({ embedding: vectors[i], metadata: {
          ...(row.metadata || {}), embedding_model: modelId, embedded_at: new Date().toISOString(),
        }}).eq("id", row.id).eq("user_id", userId);
        if (result.error) { failed.push(row.id); continue; }
        if (table === "sales_brain") updatedBrain++; else updatedChunks++;
      }
    }
    const counts = await Promise.all(["sales_brain", "knowledge_chunks"].map(table =>
      filter(db.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId))));
    for (const result of counts) if (result.error || result.count === null) throw new Error("Could not verify remaining indexing work");
    const [remainingBrain, remainingChunks] = counts.map(r => r.count!);
    return json({ success: failed.length === 0, model: modelId, updatedBrain, updatedChunks,
      remainingBrain, remainingChunks, failed, done: remainingBrain === 0 && remainingChunks === 0 });
  } catch (error) {
    return json({ success: false, done: false, error: error instanceof Error ? error.message : "Indexing failed" }, 503);
  }
});
