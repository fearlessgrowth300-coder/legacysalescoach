

## Plan: Fix Malformed JSON in Structured Learnings Extraction

### Problem

The `process-knowledge` edge function extracts knowledge chunks successfully (9 stored), but the structured learnings extraction fails because the AI model returns malformed JSON (single quotes or unquoted property names). The raw `JSON.parse()` on line 86 throws and returns 0 learnings, causing "No structured learnings found" in the UI.

### Fix

**File: `supabase/functions/process-knowledge/index.ts`** (lines 81-88)

Add robust JSON repair before parsing:

1. Strip markdown code fences (` ```json ... ``` `)
2. Replace single-quoted property names with double quotes
3. Remove trailing commas before `]` or `}`
4. Remove control characters
5. If `JSON.parse` still fails after repair, attempt a second extraction with a smaller temperature or return a fallback

```typescript
// After extracting jsonMatch[0]:
let jsonStr = jsonMatch[0];
// Strip control chars
jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, ' ');
// Fix single-quoted keys/values → double quotes
jsonStr = jsonStr.replace(/'/g, '"');
// Remove trailing commas
jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
try {
  return JSON.parse(jsonStr);
} catch {
  // Try to salvage partial array by finding complete objects
  const objects: any[] = [];
  const objRegex = /\{[^{}]+\}/g;
  let match;
  while ((match = objRegex.exec(jsonStr)) !== null) {
    try { objects.push(JSON.parse(match[0])); } catch { /* skip */ }
  }
  return objects;
}
```

This is a single-file backend fix. No UI changes needed — once the JSON parsing is robust, the structured learnings will be stored correctly and show up in "View All."

