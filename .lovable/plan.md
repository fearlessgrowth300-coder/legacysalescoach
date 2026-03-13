

## Plan: Unlimited Insights + Clickable Items to View All Learnings

### What's changing

**Two issues to fix:**

1. **Hardcoded limit of 8-12 learnings** — The `process-knowledge` edge function tells the AI to extract "EXACTLY 8-12 learnings" and "10-25 chunks". This artificially caps what gets extracted from rich content. We'll remove these caps and tell the AI to extract ALL learnings proportional to content length.

2. **No way to view insights per item** — Currently each knowledge base card shows only 5 insights with a non-clickable "+ N more" label. We'll make the entire insights section clickable so tapping any item opens a dialog showing ALL insights (from `sales_brain`) learned from that specific source.

---

### Changes

**Edge Function: `supabase/functions/process-knowledge/index.ts`**
- Change the structured learnings prompt from "Extract EXACTLY 8-12 learnings" to "Extract ALL meaningful learnings — as many as the content supports" with guidance to scale based on content length (short video = 5-10, long book = 30-50+)
- Change the chunks prompt from "Extract 10-25 chunks" to "Extract as many chunks as the content warrants"
- Remove the `arrayBuffer.byteLength > 25 * 1024 * 1024` server-side PDF size limit to match the client-side removal

**Frontend: `src/pages/KnowledgeBase.tsx`**
- Add state for tracking which item's learnings to show (`selectedItemId`)
- Query `allBrainLearnings` already exists — filter by `source_id` matching the clicked item
- Make the insights section on each card clickable (cursor-pointer, hover effect)
- Make the "+ N more insights" text clickable too
- When clicked, open the existing `learningsDialogOpen` dialog filtered to that item's learnings from `sales_brain`
- Show all insights (not just 5) in the popup with the category badges and full principle details

