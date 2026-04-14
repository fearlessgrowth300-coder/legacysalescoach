
## Plan: Fix TranscriptAPI key usage for YouTube extraction

### What is actually happening
- The app is trying to use your saved key first.
- But your saved key is stored encrypted in `user_api_keys`.
- `preview-url` and `process-knowledge` are reading that encrypted value and sending it directly to TranscriptAPI.
- That is why the logs show the “user-provided” key length is `153` and TranscriptAPI returns `401 Invalid API key`.
- After that, the app falls back to the project-level key, and that account returns `402 no_active_paid_plan`.

So the issue is:
1. App bug: encrypted user key is not being decrypted before use
2. Backup key/account issue: the fallback TranscriptAPI account does not have an active paid plan

### Changes to make
1. **Decrypt saved user keys before using them**
   - Update `supabase/functions/preview-url/index.ts`
   - Update `supabase/functions/process-knowledge/index.ts`
   - Reuse the same AES-GCM decrypt logic already used in `manage-api-keys`
   - Send only the decrypted key in the `Authorization` header

2. **Keep the existing fallback order**
   - Try decrypted user key first
   - If it fails with `401` or `402`, try the project fallback key
   - Keep the current scraping fallback as last resort

3. **Improve logs and error states**
   - Keep logs safe: source of key only, never raw key
   - Make it clearer whether failure is:
     - invalid saved key
     - no active paid plan
     - no transcript available for that video

4. **Fix misleading Settings copy**
   - Update `src/pages/Settings.tsx`
   - Remove wording that implies a free account always works
   - Clarify that TranscriptAPI may require an active paid plan depending on their account rules

5. **Retest the exact failing flow**
   - Paste the YouTube URL again
   - Confirm preview fetches transcript
   - Confirm processing stores chunks and structured learnings
   - Confirm “View All” shows learnings instead of the raw-chunk fallback

### Files to update
- `supabase/functions/preview-url/index.ts`
- `supabase/functions/process-knowledge/index.ts`
- `src/pages/Settings.tsx`

### Expected result
- Your saved TranscriptAPI key will be used correctly instead of the encrypted blob
- If your TranscriptAPI account is valid, transcript extraction should work again
- If it still fails after decryption, the remaining problem is with the provider account status, not the app

### Technical details
- Current evidence:
  - user key log length: `153` → looks like encrypted `enc:...` data, not a real API key
  - fallback key log length: `46` → plain fallback key is being sent
  - provider responses:
    - user key: `401 Invalid API key`
    - fallback key: `402 You don’t have an active paid plan yet`
- Root mismatch in code:
  - `manage-api-keys` encrypts on save
  - `preview-url` and `process-knowledge` do not decrypt on read
