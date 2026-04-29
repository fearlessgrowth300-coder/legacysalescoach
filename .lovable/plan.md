## Diagnosis (from edge logs + DB inspection)

**Phase 1 fix is healthy.** The edge logs show:

```
unpdf extracted 667828 chars from 279 pages in 1142ms
Detected 5 chapter(s) / chunk(s)
```

A 3.41 MB book that previously timed out at 180s now extracts in **~1 second**. The "PDF won't process" surface symptom is gone.

**Real bug uncovered by the logs:**

```
ERROR Insert error for principle: ... violates foreign key constraint "sales_brain_source_id_fkey"
```

Every principle insert fails with the same FK error. The constraint is `source_id → knowledge_base_items(id) ON DELETE CASCADE`. From the timeline:

- 23:37:36 — first upload of "Psychology of Persuasion" booted, started extracting in the background
- 23:38:08 — a **new** `knowledge_base_items` row was created (user re-uploaded the file after deleting the failed one)
- 23:38:09 — second pipeline booted (the one we see succeeding at PDF extraction)
- 23:38:27–31 — inserts arrive carrying the **old** itemId from the still-running first background task. The old parent row was cascade-deleted when the user removed the failed item, so every insert FK-fails.

The DB confirms this: the current item row (`2713791d…`) exists fine, has zero `sales_brain` rows. The new pipeline never got past Pass 1 mapping in the second invocation either (it returned 0 principles at 10k, retried at 20k — separate Pass 2 prompt issue, secondary).

So the user sees a red error icon and an empty briefing because the orphaned background task spammed FK errors and the second pipeline silently aborted on its retry.

## Fix (small, surgical)

**1. Treat FK violation as "parent deleted" — abort gracefully**
In `persistLearning` (`supabase/functions/process-knowledge/index.ts` ~line 645): when the insert error message matches `foreign key constraint` or `sales_brain_source_id_fkey`, throw a `PARENT_ITEM_DELETED` sentinel error instead of logging and continuing.

**2. Catch the sentinel in the two callers that run the persist loop** (Pass 2 chapter loop ~line 833 and the non-book single-chunk path ~line 991): when caught, log once and `return` from the background task. No more 100-line error spam, no more zombie writes.

**3. Pre-flight existence check at the top of `runPipeline`**
Before any heavy work, confirm `knowledge_base_items` still has the row for `itemId`. If not, log "item deleted before processing" and return. This catches the race where the user deletes the upload during the first 1–2 seconds.

**4. (Bonus) Pass 2 retry-at-20k issue**
Logs also show "Pass 2 returned 0 principles. Raw AI output: { principles: [ ... " — the AI returned valid JSON with principles but the parser counted 0. Likely the JSON was truncated mid-stream at 800 chars in the log but the parser got the full payload — needs a quick check of the JSON-parse path in the Pass 2 chapter handler. Will inspect during implementation; if it's a truncation issue from token cap, raise the cap. If it's a parser strictness issue, add a permissive fallback.

## Files touched

- `supabase/functions/process-knowledge/index.ts` only — three small edits in `persistLearning`, the two persist-loop catch blocks, and the top of `runPipeline`. Plus the Pass 2 parse audit.

No DB changes, no new dependencies, no migrations.

## Expected result

- Re-uploading a previously-failed file no longer poisons the new pipeline with orphan inserts.
- The "Psychology of Persuasion" upload will populate principles into the briefing card instead of showing the red error icon.
- Logs become readable again (one "item deleted, aborting" line instead of 50 FK errors).
