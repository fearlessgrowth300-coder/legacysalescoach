

## Plan: Fix Brain Chat Edit Duplication + "Nothing in Brain" False Negatives

### Problem 1: Edit/Resend Shows Old + New Response
The `saveEdit` function correctly truncates messages in state, but there's a subtle issue: the `idsToDelete` logic uses `messages.slice(editingMsgIdx)` which captures the stale closure of `messages`. If a React re-render happened between edit start and save, the indices could be off. Additionally, the duplicate DB update on lines 800-801 and 809-811 is redundant and wastes a round trip.

**Fix in `src/pages/AiChat.tsx`:**
- Remove the duplicate `update` call (lines 800-801 duplicate lines 809-811)
- Change the delete logic to use `conversation_id` + `created_at` ordering instead of relying on message IDs from stale state — delete ALL messages in DB after the edited message's `created_at` timestamp
- Add a guard so that if `messages` state hasn't changed, the truncation is clean

### Problem 2: Brain Says "Nothing Covers This" Despite 4,354 Principles + 5,276 Chunks
The system prompt's contextual jail is **too restrictive**. Line 369 tells the model: "If NO relevant chunks exist → say Nothing in your Brain." But the model interprets this too literally — when a user shares a screenshot and says "she said this," the model can't find an *exact semantic match* for that specific conversation, so it falls back to the empty response even though thousands of general sales principles are in context.

**Fix in `supabase/functions/brain-chat/index.ts`:**
- Rewrite the fallback rule to only trigger when `hasKnowledge` is false (brain truly empty) — remove the model's discretion to say "nothing covers this"
- Add an explicit instruction: "Your brain contains ${totalChunks} chunks of sales wisdom. You ALWAYS have knowledge to draw from. NEVER say 'Nothing in your Brain covers this.' Instead, find the closest applicable principles and apply them strategically."
- When images are shared, instruct the model to analyze the image content and match it against the general sales frameworks and principles already in context
- Remove the line that says "If they share an image/screenshot and no matching uploaded knowledge exists, reply: Nothing in your Brain..." — this is the primary cause of false negatives
- Keep the empty-brain fallback ONLY for when `hasKnowledge` is literally false

### Technical Details

**File 1: `src/pages/AiChat.tsx` (saveEdit function, ~lines 785-908)**
- Remove duplicate DB update (lines 800-801)
- Change delete strategy: instead of collecting IDs from potentially stale state, delete by `conversation_id` and `created_at > edited_message_created_at` to guarantee all subsequent messages are removed
- Add `await` on the delete before setting state to ensure DB is clean before UI updates

**File 2: `supabase/functions/brain-chat/index.ts` (system prompt, ~lines 296-398)**
- Remove the "If NO relevant chunks exist" fallback when `hasKnowledge` is true
- Remove the image-specific "nothing covers this" fallback
- Add: "You have a MASSIVE library of ${totalChunks} sales principles. For ANY prospect message, conversation screenshot, or sales scenario, you CAN and MUST find applicable wisdom from your brain. Apply the closest matching frameworks, objection handlers, and closing techniques."
- Only keep the empty fallback inside the `${!hasKnowledge ? ...}` conditional block

