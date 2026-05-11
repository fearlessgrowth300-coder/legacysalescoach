## What I found

- The older Val reply in your first screenshot is saved in the backend from **Apr 12** and has **empty Brain metadata**. That means the old Brain was not using the current strict `selected_principles` + citation-footer system.
- The newer Val reply from **May 6** has metadata with only **one selected principle** from **The_22_Immutable_Laws_of_Marketing...**, which is why the Sources footer shows only one source.
- So the issue is not that your Brain has no principles. The issue is the newer Brain pipeline now forces the answer through a small selected-principles gate and citation system, which can still collapse to one source.

## Plan to restore the old behavior

1. **Restore the old answer style**
   - Change the Brain response prompt back toward the first screenshot style:
     - Direct conversation diagnosis first.
     - Inline source names inside the answer.
     - Strong script section.
     - Strategic breakdown using multiple sources.
     - No forced citation tokens inside every tactical sentence.

2. **Stop the one-source choke point**
   - Keep the improved retrieval search, but stop making the final answer depend only on `pipeline.selected`.
   - Pass a wider “vault evidence pack” into the final response, including:
     - selected principles,
     - top reranked candidates from multiple sources,
     - supporting chunks from PDFs/videos,
     - previous Val conversation context.
   - This lets the Brain reason like the old version instead of being trapped by one selected principle.

3. **Make screenshots/conversations drive retrieval first**
   - Keep the screenshot-reading brief, but make it extract:
     - who the prospect is,
     - the exact last message,
     - the emotional state,
     - the business context from prior Val messages,
     - what reply/action the user needs.
   - Use that expanded brief to pull from categories like trust, psychology, objections, leadership, closing, rapport, mindset, and frameworks.

4. **Hide or downgrade the Sources footer for Brain chat**
   - Match the first screenshot behavior by not forcing a big Sources block at the bottom when the answer already names sources inline.
   - Keep metadata saved for debugging, but make the visible answer feel like the old Brain: source-backed without the footer dominating the message.

5. **Add deterministic multi-source fallback**
   - If the final selected set has fewer than 3 sources, automatically add extra relevant principles/chunks from different categories before generation.
   - The response prompt will be told to weave these into the answer naturally, not list them mechanically.

6. **Validate against the Val conversation**
   - Test with the saved Val conversation context.
   - Confirm the new output resembles the first screenshot:
     - understands Val’s trauma/context,
     - gives a strong ready-to-send reply,
     - references multiple books/videos/principles throughout,
     - does not collapse to one source,
     - does not rely on a single Sources footer to prove grounding.

## Technical files to update

- `supabase/functions/_shared/brain-pipeline.ts`
  - Return a broader evidence pack, not just final selected principles.
  - Expose more candidate/chunk source titles in debug metadata.

- `supabase/functions/brain-chat/index.ts`
  - Replace the strict citation-heavy prompt with an old-style Brain prompt.
  - Feed the wider evidence pack into response generation.
  - Keep screenshot-first reasoning and Val conversation context.

- `src/pages/AiChat.tsx` and/or `src/components/BrainCitations.tsx`
  - Adjust rendering so Brain answers can show inline source-backed writing without always showing the big Sources footer.

## Expected result

The Brain should go back to the first screenshot behavior: it reads the full conversation, understands Val’s emotional/business context, pulls from multiple principles/books/videos, and writes a complete strategic reply instead of producing a one-source, citation-footer-heavy answer.