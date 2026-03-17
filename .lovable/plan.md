

## Problem Analysis

Looking at your screenshots, I can see two distinct issues:

1. **Truncated AI responses** — The `brain-chat` edge function calls the AI gateway with `stream: true` but **never sets `max_tokens`**. When the model generates a long, detailed response (like the first screenshot shows), it can hit the default output limit and get cut off mid-sentence. This is why the second/third screenshots show scattered, incomplete responses.

2. **Long messages overflow the chat UI** — When the AI does generate a full response, very long messages with bold text, scripts, and references can visually break the layout, making it hard to scroll back to see what you originally asked or pasted.

## Plan

### 1. Add `max_tokens` to brain-chat AI call
In `supabase/functions/brain-chat/index.ts` (line ~395), add `max_tokens: 16384` to the API request body. This ensures the model has enough room to complete long strategic responses without truncation.

### 2. Add network retry logic for streaming
Wrap the streaming fetch in `src/pages/AiChat.tsx` `streamChat` function with a retry mechanism — if the fetch fails due to network issues, retry up to 2 times with a short delay before showing an error. This handles the "bad network" scenario.

### 3. Add truncated response detection
After streaming completes in the `onDone` callback, check if the response appears truncated (e.g., ends mid-sentence without punctuation, or is suspiciously short). If detected, show a "Response may be incomplete — tap to regenerate" button.

### 4. Improve long message rendering in chat UI
Add a collapsible wrapper for assistant messages longer than ~2000 characters — show the first portion with a "Show full response" button. This prevents the user's original question from being pushed off-screen by massive AI replies.

### 5. Auto-scroll to user's message first
After sending a message, scroll to the user's message position first (not the bottom), so the user always sees their input. Then as the AI streams in, progressively scroll down.

