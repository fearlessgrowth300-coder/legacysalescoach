

## Plan: Fix Text Overflowing Past Margins in AI Chat

### Problem

The assistant message text in Val's conversation overflows past the container margins on mobile. The bubble should stay within bounds like Desirae's conversation does. This is a CSS text-wrapping issue, not a truncation issue.

### Root Cause

The markdown prose wrapper on line 1277 uses `max-w-none` which removes the max-width constraint inside the bubble. Combined with long bold text and inline formatting, some content pushes past the bubble boundary on narrow screens. The bubble itself (line 1221) has `max-w-[85%]` and `overflow-hidden`, but the inner prose content can still cause layout issues when words or bold phrases don't naturally break.

### Fix

**File: `src/pages/AiChat.tsx`**

1. On the assistant message prose div (line 1277), add `overflow-wrap: anywhere` and `word-break: break-word` to force long text to wrap within the bubble:
   - Change the className to include `[&_*]:overflow-wrap-anywhere` or apply via inline style `style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}`

2. On the bubble container (line 1221), add `min-w-0` to ensure the flex child can shrink properly below its content size on mobile.

### Changes Summary

- **Line 1221**: Add `min-w-0` to the bubble div className
- **Line 1277**: Replace `max-w-none` with `max-w-full` and add `style={{ overflowWrap: 'anywhere' }}` to the prose wrapper so all nested text elements wrap correctly within the container

This is a 2-line CSS fix. No backend changes needed.

