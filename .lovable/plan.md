

# Clean Up Sales Brain + Fix Embedding Errors + Re-Process All Uploads

## Root Cause of the Error

The `108d46782f06b3e49fe98201db0f6b69` error traces back to **Embedding API 400 errors** visible in the process-knowledge logs. The function calls the Lovable AI Gateway with model `text-embedding-3-small`, which is returning HTTP 400 for every embedding request. This means:
- Principles ARE being extracted (10 per upload) but stored WITHOUT embeddings
- Raw vector chunks fail entirely ("Stored 0 raw embedded chunks")
- The Brain's semantic search (`match_sales_brain`, `match_knowledge_chunks`) returns nothing because embeddings are null

**The fix**: Switch to a supported embedding model on the gateway, then re-process everything.

## Current State
- **sales_brain**: 242 rows (most without working embeddings)
- **knowledge_base_items**: 129 uploads (91 URLs + 37 PDFs), all status "ready"
- **sales_brain table**: Missing `relevance_score` column

---

## Implementation Steps

### Step 1: Add `relevance_score` column to `sales_brain`
Add a float column `relevance_score` with a default of 70 for better search ranking.

### Step 2: Fix the embedding model in `process-knowledge`
Change the embedding call from `text-embedding-3-small` to a model supported by the Lovable AI Gateway. The gateway supports Google and OpenAI models -- we need to verify which embedding model works and switch to it. If the gateway doesn't support embeddings at all, we'll skip embeddings and rely on text-based retrieval (which the brain-chat function already does).

### Step 3: Create a `reprocess-brain` edge function
A new backend function that:
1. Deletes all existing `sales_brain` rows for the authenticated user
2. Deletes all existing `knowledge_chunks` rows for the user
3. Fetches all `knowledge_base_items` for the user
4. For each item: calls the existing `process-knowledge` function internally (or duplicates the extraction logic) to re-extract content and generate 12-15 principles
5. Returns a report: "Cleaned! Added X new principles from Y uploads."

This function will need a longer timeout since it processes 129 items. To handle this within edge function limits, it will:
- Process items in batches
- Use `EdgeRuntime.waitUntil` for background processing
- Update a status row the frontend can poll

### Step 4: Add a "Re-process Brain" button to the UI
Add a button (likely in the Knowledge Base or Brain Stats page) that:
- Calls the `reprocess-brain` function
- Shows a progress indicator
- Displays the final report toast: "Cleaned! Added X new principles from Y uploads."

### Step 5: Deploy and test

---

## Technical Details

### Database Migration
```sql
ALTER TABLE public.sales_brain 
ADD COLUMN IF NOT EXISTS relevance_score float DEFAULT 70;
```

### New Edge Function: `reprocess-brain`
- Authenticates the user
- Truncates their sales_brain + knowledge_chunks
- Loops through each knowledge_base_item
- For videos/URLs: re-fetches transcript via the preview-url function
- For PDFs: re-downloads from storage and re-extracts via Gemini
- Generates 12-15 principles per item using the same AI extraction
- Inserts into sales_brain with full metadata, workspace_id = null
- Attempts embeddings with corrected model (or skips if unsupported)
- Returns summary report

### Files to Create/Modify
1. **Database migration** -- Add `relevance_score` column
2. **`supabase/functions/reprocess-brain/index.ts`** -- NEW: bulk re-processing function
3. **`supabase/functions/process-knowledge/index.ts`** -- Fix embedding model
4. **`supabase/config.toml`** -- Add reprocess-brain function config
5. **`src/pages/KnowledgeBase.tsx`** or **`src/pages/BrainStats.tsx`** -- Add re-process button + progress UI

### Edge Function Timeout Strategy
Since 129 items cannot be processed in a single 60s function call, the reprocess-brain function will:
1. Delete old data immediately
2. Process items in the foreground (batch of ~5 at a time)
3. Use streaming response to keep the connection alive
4. Or: use a job-based approach where it kicks off processing and the frontend polls for completion

