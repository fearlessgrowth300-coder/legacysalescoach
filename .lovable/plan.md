

## Plan: Fix Truncated Brain Responses

### Root Cause

The first screenshot (Val's chat) shows a response that got **cut off mid-sentence** — it never finished rendering. The second screenshot (Desirae's chat) shows a complete response. The cause is the **`max_tokens: 16384` limit** in the brain-chat edge function.

When the Brain generates a long, detailed response with multiple source citations, strategic breakdowns, and a full copy-paste reply, it can easily exceed 16,384 output tokens — especially when the system prompt is already massive (hundreds of principles + chunks injected). The model hits the token ceiling and the stream ends abruptly without a proper `[DONE]` signal.

The client-side code already detects this (`wasTruncated` flag on line 126), but it doesn't do anything visible to help the user — the response just appears cut off.

### Fix

**File: `supabase/functions/brain-chat/index.ts`**
- Increase `max_tokens` from `16384` to `32768` — this gives the model 2x more room to complete long strategic responses with full source citations
- The model (`google/gemini-3-flash-preview`) supports this output size

**File: `src/pages/AiChat.tsx`**
- When `wasTruncated` is true, automatically append a "Continue" button or auto-send a follow-up request asking the model to continue from where it left off
- Show a subtle indicator like "⚠️ Response was cut short — click to continue" so the user knows what happened and can recover

### Technical Details

- Line 418 in `brain-chat/index.ts`: change `max_tokens: 16384` → `max_tokens: 32768`
- In the `onDone` callback in `AiChat.tsx`: when `wasTruncated === true`, either auto-continue or show a "Continue generating" button that re-sends the conversation with the partial response included, asking the model to finish

