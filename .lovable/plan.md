## Goal
Stop the 546 errors and make chat replies start quickly instead of hanging for a long time.

## What I found
The chat request path is timing out in the backend:
- `brain-chat` waits for the full retrieval pipeline before streaming anything.
- `_shared/brain-pipeline.ts` currently pages through large vault datasets, generates embeddings for multiple subqueries, runs multiple semantic RPCs, then does extra enrichment and balancing work in the same request.
- The backend logs show `CPU Time exceeded`, which lines up with the 546 errors and the long typing spinner.

## Plan
1. **Shrink the hot path in retrieval**
   - Replace the full-vault page scans on every request with a lighter candidate strategy.
   - Cap the number of subqueries/semantic runs used for live chat.
   - Reduce expensive enrichment and source-balancing work before first response.

2. **Add a fast-response mode for `brain-chat`**
   - Introduce a chat-specific pipeline mode optimized for speed.
   - Keep strong relevance scoring, but use smaller candidate pools and earlier cutoffs.
   - Preserve multi-source reasoning without forcing a huge preselection pass.

3. **Start streaming sooner**
   - Make `brain-chat` emit an immediate SSE event so the UI is not stuck waiting for the whole retrieval stack.
   - Keep the final answer format intact, but remove unnecessary delay before the first token.

4. **Guard against CPU-limit failures**
   - Add hard limits and graceful fallbacks when retrieval is too expensive.
   - If the deep pass cannot finish in time, fall back to the strongest smaller candidate set instead of dying with 546.

5. **Validate the message path**
   - Re-test the chat function and confirm the request no longer hits the CPU ceiling.
   - Verify the response begins quickly and still cites relevant principles from the vault.

## Technical details
- **Primary files:**
  - `supabase/functions/_shared/brain-pipeline.ts`
  - `supabase/functions/brain-chat/index.ts`
- **Likely implementation approach:**
  - Add a lightweight retrieval profile for interactive chat.
  - Reduce `fetchAllRows` dependence in live requests.
  - Trim semantic calls and downstream candidate enrichment.
  - Stream an early event before the full generation work completes.
  - Keep the stronger, wider retrieval path available only where latency matters less.

## Expected result
- No more 546 timeout loop when sending a message.
- Typing/streaming starts fast.
- Replies still use relevant vault principles, but without the current 30+ minute wait.