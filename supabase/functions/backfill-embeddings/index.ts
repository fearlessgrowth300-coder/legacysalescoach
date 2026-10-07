import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserEmbedTarget } from "../_shared/user-ai.ts";
import { embedBatch } from "../_shared/embedding-batch.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };

/** Embed up to 32 rows for one user; reindex also re-embeds rows from another model. */
async function indexBatch(db: any, userId: string, reindex: boolean) {
  const target = await resolveUserEmbedTarget(db, userId);
  const modelId = `${target.provider}:${target.model}:768`;
  const filter = (query: any) => reindex
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
    const vectors = await embedBatch(target, valid.map(textOf), "document");
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
  return { success: failed.length === 0, model: modelId, updatedBrain, updatedChunks,
    remainingBrain, remainingChunks, failed, done: remainingBrain === 0 && remainingChunks === 0 };
}

/**
 * Re-extraction queue. The Knowledge Base "Update outdated sources" button marks
 * items status='queued'; each scheduled run starts the oldest one with the same
 * request the Re-extract button sends (the owner's own AI key is used). Only one
 * extraction runs at a time so free Gemini quotas are not burst.
 */
/** Gemini free quotas reset at midnight Pacific; 08:00 UTC is safely after it all year. */
export function quotaResumeAt(blockedAt: string): Date {
  const blocked = new Date(blockedAt);
  const resume = new Date(Date.UTC(blocked.getUTCFullYear(), blocked.getUTCMonth(), blocked.getUTCDate(), 8));
  if (resume <= blocked) resume.setUTCDate(resume.getUTCDate() + 1);
  return resume;
}

async function startNextQueuedExtraction(db: any, serviceKey: string) {
  // Free AI quota exhausted: don't burn the rest of the queue on guaranteed
  // failures. Wait for the reset, then put the quota-blocked items back in line.
  const { data: blocked } = await db.from("knowledge_base_items").select("id, book_brief")
    .eq("status", "error").not("book_brief->>quota_blocked_at", "is", null).limit(200);
  const now = new Date();
  const waiting = (blocked || []).filter((row: any) => quotaResumeAt(row.book_brief.quota_blocked_at) > now);
  if (waiting.length) {
    return { queue: "paused_quota", resume_at: quotaResumeAt(waiting[0].book_brief.quota_blocked_at).toISOString() };
  }
  if (blocked?.length) {
    await db.from("knowledge_base_items").update({ status: "queued" }).in("id", blocked.map((row: any) => row.id));
  }
  const busySince = new Date(Date.now() - 20 * 60_000).toISOString();
  // Extractions killed mid-run sit in "processing" forever, and one bad AI
  // window fails a whole source (2026-10-08: 4 books stuck, 2 videos failed).
  // Put them back in line, at most 3 times each so a hopeless one can't burn quota.
  const [{ data: stuck }, { data: failed }] = await Promise.all([
    db.from("knowledge_base_items").select("id, auto_retry_count")
      .in("status", ["processing", "mapping", "extracting"]).lt("updated_at", busySince).limit(50),
    db.from("knowledge_base_items").select("id, auto_retry_count")
      .eq("status", "error").eq("book_brief->insight_extraction->>status", "failed").lt("auto_retry_count", 3).limit(50),
  ]);
  for (const row of [...(stuck || []), ...(failed || [])]) {
    const retries = row.auto_retry_count || 0;
    await db.from("knowledge_base_items")
      .update(retries < 3 ? { status: "queued", auto_retry_count: retries + 1 } : { status: "error" })
      .eq("id", row.id);
  }
  const { data: busy } = await db.from("knowledge_base_items").select("id")
    .in("status", ["processing", "mapping", "extracting"]).gt("updated_at", busySince).limit(1);
  if (busy?.length) return { queue: "waiting", running: busy[0].id };
  const { data: next } = await db.from("knowledge_base_items")
    .select("id, user_id, type, url, file_path").eq("status", "queued")
    .order("updated_at", { ascending: true }).limit(1);
  const item = next?.[0];
  if (!item) return { queue: "empty" };
  await db.from("knowledge_base_items").update({
    status: "processing", book_brief: null, source_index_version: 0, source_chunk_count: 0, indexed_at: null,
  }).eq("id", item.id);
  const body: Record<string, unknown> = { itemId: item.id, type: item.type, userId: item.user_id };
  if (item.type === "pdf" && item.file_path) {
    body.filePath = item.file_path;
    const { data: text } = await db.storage.from("knowledge-files").download(`${item.file_path}.txt`);
    const extracted = text ? await text.text() : "";
    if (extracted.length >= 100) body.manualTranscript = extracted;
  } else if (item.url) {
    body.url = item.url;
  }
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/process-knowledge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).catch((error) => ({ ok: false, status: 0, error } as any));
  if (!response.ok) await db.from("knowledge_base_items").update({ status: "error" }).eq("id", item.id);
  return { queue: "started", itemId: item.id, status: response.status };
}

/**
 * Scheduled mode (pg_cron every 5 min, x-cron-secret): keep every account's
 * vault indexed with the current model so nobody has to click Repair Search -
 * e.g. rows saved while the embedding server was down, or accounts that still
 * hold vectors from an older model. Runs for ~100s, user by user.
 */
async function runScheduled(db: any) {
  const target = await resolveUserEmbedTarget(db, null);
  const modelId = `${target.provider}:${target.model}:768`;
  const pending = `embedding.is.null,metadata->>embedding_model.is.null,metadata->>embedding_model.neq.${modelId}`;
  const started = Date.now();
  const skipped = new Set<string>();
  let updated = 0;
  while (Date.now() - started < 100_000) {
    let userId: string | null = null;
    for (const table of ["sales_brain", "knowledge_chunks"]) {
      let query = db.from(table).select("user_id").or(pending).not("user_id", "is", null);
      if (skipped.size) query = query.not("user_id", "in", `(${[...skipped].join(",")})`);
      const { data, error } = await query.limit(1);
      if (error) throw error;
      if (data?.[0]?.user_id) { userId = data[0].user_id; break; }
    }
    if (!userId) break;
    const batch = await indexBatch(db, userId, true);
    updated += batch.updatedBrain + batch.updatedChunks;
    if (batch.done || batch.updatedBrain + batch.updatedChunks === 0) skipped.add(userId);
  }
  return { scheduled: true, updated, seconds: Math.round((Date.now() - started) / 1000) };
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({}));
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key);
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) {
      const extraction = await startNextQueuedExtraction(db, key).catch((error) => ({ queue: "failed", error: String(error) }));
      return json({ ...(await runScheduled(db)), extraction });
    }
    const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    const auth = token === key && typeof body.user_id === "string"
      ? await db.auth.admin.getUserById(body.user_id) : await db.auth.getUser(token || "");
    if (auth.error || !auth.data.user) return json({ error: "Unauthorized" }, 401);
    return json(await indexBatch(db, auth.data.user.id, Boolean(body.reindex)));
  } catch (error) {
    return json({ success: false, done: false, error: error instanceof Error ? error.message : "Indexing failed" }, 503);
  }
});
