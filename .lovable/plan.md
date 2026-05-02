I found two separate problems causing what you are seeing:

1. The Knowledge Base page loads only the default first 1000 rows from `sales_brain` and `knowledge_chunks`. Your backend already has thousands of learned insights, so older items lower down the page, including the compensation plan, can show as if they have no learned insights even though the data exists.
2. On reload, the page fetches every item, every chunk, and every brain learning up front. That makes the page slow before the visible cards populate.

Plan to fix it properly:

1. Replace the heavy global data fetches on `KnowledgeBase.tsx`
   - Stop loading all `sales_brain` and all `knowledge_chunks` rows at page load.
   - Load the knowledge items first, then fetch only lightweight per-item counts and previews.
   - This removes the 1000-row cutoff problem and makes reload much faster.

2. Add paginated / batched loading for learned insights
   - When the user taps an item, fetch that item’s full learned insights by `source_id` with pagination instead of relying on the page-level cache.
   - Do the same for chunks only as fallback.
   - This will make every item, including older ones lower down like the compensation plan, show its learned insights.

3. Fix card visibility logic
   - Change the item cards so they show “Learned X insights · View all” based on real counts from the database, not only whether the first global `chunks` query happened to include that item.
   - Add a safe fallback state if an item is ready but its preview has not loaded yet.

4. Fix the “Brain Learnings” dialog
   - Convert “All Brain Learnings” from a single default-limited query into paginated loading.
   - Show an accurate total/count behavior and avoid silently hiding rows after the first 1000.

5. Improve processing polling without slowing reload
   - Keep polling active items, but only query counts for currently processing items.
   - Invalidate the correct query keys after uploads, retries, and deletes so the UI refreshes reliably.

6. Clean up the React warning shown in the console
   - Adjust the small `Badge` usage that is receiving a ref indirectly so the warning does not keep appearing on the Knowledge Base page.

Expected result:
- Compensation plan and every older/lower item will show the learned insights.
- Reload should be noticeably faster.
- No more hidden insights due to the 1000-row default query limit.
- The page will scale better as you add more books and PDFs.

Technical details:
- Main file: `src/pages/KnowledgeBase.tsx`
- Likely small supporting UI cleanup: `src/components/BookBriefCard.tsx` or the relevant trigger/Badge usage if needed
- No database schema change is required for this specific fix because useful indexes already exist on `sales_brain(user_id, source_id)` and `knowledge_chunks(user_id, source_id)`.