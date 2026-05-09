## Goal
Make the AI Brain behave like the older strong responses again: first understand the actual user message or screenshot conversation, then search the whole uploaded vault across PDFs/videos/chunks/categories, then combine the best principles into one grounded reply.

## What is wrong now
- Screenshot/image messages are passed to the final answer model, but the retrieval query is only the typed text like “Analyze this image”; so the Brain searches the vault with the wrong query.
- The pipeline selects too narrowly in practice: recent assistant messages show only 1 selected principle and 1 source, even though the vault has 4,212 principles.
- `knowledge_chunks` are included only as weak background; they do not help choose which categories/sources/principles should drive the answer.
- Assistant metadata saved to chat history drops `debug`, so it is hard to verify what was retrieved after reload.
- The prompt says multi-source, but the selection step can still return one source and the answer then parrots that one book.

## Plan

### 1. Add a “conversation understanding” step before retrieval
In `supabase/functions/brain-chat/index.ts`:
- Detect whether the last user message contains images/screenshots.
- Use a fast vision/text model to produce a retrieval-ready brief before `runPipeline`, including:
  - extracted screenshot text / DM conversation
  - prospect’s last message
  - user’s goal
  - likely objection/category: salary, price, trust, rapport, closing, follow-up, leadership, mindset, etc.
  - sales intent and emotional context
- Use that enriched brief as the retrieval `question`, while still passing the original screenshot/message to the final answer model.

### 2. Make retrieval search wider and category-aware
In `supabase/functions/_shared/brain-pipeline.ts`:
- Expand query generation to use the enriched brief and recent conversation, not only the raw user text.
- Increase semantic matches per subquery from small pools to a wider pool, then dedupe/rerank.
- Pull more `knowledge_chunks` and use their categories/content to influence principle selection.
- Add category balancing so one category/source cannot crowd everything out when the request clearly spans multiple angles.

### 3. Force multi-source selection unless the vault truly has only one match
In `selectPrinciples`:
- Require 3–6 primary/supporting principles when candidates span enough sources.
- Enforce at code level after model selection: if the selector returns only one source, backfill top relevant candidates from other sources/categories.
- Keep max 2 per source, but prefer at least 3 different source titles.
- Include source title/type/category in the selection prompt so the model can choose across books/videos intentionally.

### 4. Use chunks as reasoning support, not invisible filler
- Add selected/top chunks into the reasoning prompt with category/source context.
- Tell the final model to use chunks to understand the situation and reinforce the chosen principles.
- Keep citations tied to principles only, but let chunks guide what the reply should address.

### 5. Improve final answer instructions for “read message/screenshot first”
In `brain-chat/index.ts` system prompt:
- Add a mandatory flow:
  1. Read the screenshot/text and identify what the prospect actually means.
  2. Diagnose the stage/objection/emotion.
  3. Pull from multiple vault sources.
  4. Combine them into THE STRATEGY / THE REPLY / WHY THIS WORKS.
- Make it avoid random/general replies and avoid answering from one book when more sources are available.

### 6. Save retrieval debug metadata so we can verify it
When saving assistant messages in `src/pages/AiChat.tsx`:
- Preserve `debug`, selected source count, unique source titles, and framework metadata.
- This lets the Sources footer and database history show whether the Brain actually pulled from multiple sources after reload.

## Validation
- Check recent assistant metadata after a test message: selected principles should usually be 3+ with 3+ unique source titles when the vault has matches.
- Test a screenshot conversation: the retrieval query should be based on the screenshot’s extracted conversation, not “Analyze this image.”
- Confirm the answer names multiple sources in prose and gives a specific copy/paste reply grounded in the vault.