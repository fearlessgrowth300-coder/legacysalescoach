

# Fix All "Failed to Fetch" Errors + Instagram Apify Integration + OTP Sign Up

## Issues Found

### 1. CORS Headers Broken on ALL Edge Functions (ROOT CAUSE of "fail to fetch")
All 4 edge functions (`chat-suggest`, `process-knowledge`, `ocr-screenshot`, `analyze-profile`) have **incomplete CORS headers**. The app uses `@supabase/supabase-js@2.95.3` which sends additional headers (`x-supabase-client-platform`, `x-supabase-client-platform-version`, `x-supabase-client-runtime`, `x-supabase-client-runtime-version`). These are NOT listed in the `Access-Control-Allow-Headers`, so the browser blocks the preflight OPTIONS request, causing "Failed to fetch" for every edge function call (workspace creation, PDF upload, URL processing, chat suggestions, etc.).

**Fix**: Update CORS headers in all 4 edge functions to include the full set of allowed headers.

### 2. Instagram Scraping via Apify API
Currently the app tries to scrape Instagram directly with `fetch()`, which Instagram blocks. The user has provided an Apify API key (`apify_api_l4V98dj5TbYLNuh74lfDFk0RhSNGba2g3Cwq`) to use the Instagram Scraper actor instead.

**Fix**: 
- Store the Apify API key as a secret
- Create a new `fetch-instagram` edge function that calls Apify's Instagram Profile Scraper
- Update `process-knowledge` to use this function for Instagram URLs
- Update the Chats page to fetch prospect details via Apify when an Instagram URL is pasted during new chat creation

### 3. Sign Up: OTP Code Instead of Email Link
Currently sign up sends a confirmation link. User wants a verification code (OTP) sent to email instead.

**Fix**:
- Enable auto-confirm on sign up (so users can log in immediately), OR
- Implement OTP flow: use `supabase.auth.signUp()` then `supabase.auth.verifyOtp()` with a code input screen
- Update `SignUp.tsx` to show a code verification step after sign up

### 4. New Chat: Auto-fetch Instagram Prospect Details
When creating a new chat and pasting an Instagram URL, the app should automatically fetch the prospect's bio, interests, and profile info via Apify to generate a better first message.

**Fix**: When a prospect is created with an Instagram URL, call the `fetch-instagram` edge function and save the scraped data (bio, interests, followers) to the prospect record.

---

## Implementation Steps

### Step 1: Fix CORS on ALL Edge Functions
Update the `corsHeaders` in all 4 files to:
```text
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
```

Files: `chat-suggest/index.ts`, `process-knowledge/index.ts`, `ocr-screenshot/index.ts`, `analyze-profile/index.ts`

### Step 2: Add Apify API Key as Secret
Store `apify_api_l4V98dj5TbYLNuh74lfDFk0RhSNGba2g3Cwq` as `APIFY_API_KEY` secret.

### Step 3: Create `fetch-instagram` Edge Function
New edge function that:
- Takes an Instagram username or URL
- Calls the Apify Instagram Profile Scraper API
- Returns bio, follower count, posts, interests, niche info
- Used by both knowledge base processing and new chat creation

### Step 4: Update `process-knowledge` for Instagram
Replace the direct Instagram `fetch()` with a call to the Apify-based scraper for much richer data extraction.

### Step 5: Update Chat Creation with Instagram Auto-Fetch
In `Chats.tsx`, after creating a prospect with an Instagram URL:
- Call `fetch-instagram` to get profile details
- Update the prospect record with scraped bio, interests, detected niche
- Use this data to inform the AI's first message strategy

### Step 6: Implement OTP Email Verification on Sign Up
Update `SignUp.tsx`:
- After `signUp()`, show a code input field
- User enters the OTP code from their email
- Call `supabase.auth.verifyOtp({ email, token, type: 'signup' })` to verify
- On success, navigate to `/chats`

### Step 7: Update `supabase/config.toml`
Add the new `fetch-instagram` function with `verify_jwt = false`.

### Step 8: Deploy All Edge Functions
Deploy all updated and new edge functions.

---

## Files to Modify
1. `supabase/functions/chat-suggest/index.ts` -- Fix CORS headers
2. `supabase/functions/process-knowledge/index.ts` -- Fix CORS + use Apify for Instagram
3. `supabase/functions/ocr-screenshot/index.ts` -- Fix CORS headers
4. `supabase/functions/analyze-profile/index.ts` -- Fix CORS headers (already correct)
5. `supabase/functions/fetch-instagram/index.ts` -- NEW: Apify Instagram scraper
6. `supabase/config.toml` -- Add fetch-instagram function
7. `src/pages/SignUp.tsx` -- Add OTP verification step
8. `src/pages/Chats.tsx` -- Auto-fetch Instagram details on prospect creation

