

# Fix All Issues + Add Instagram Processing, Profile Analysis & Playlist Import

## Issues Found

### 1. Workspace Creation Hangs (White Screen)
The `createWorkspace` mutation in `Workspaces.tsx` lacks error handling around the unhandled promise. When the Supabase insert fails silently (or the `setActive` mutation fires without error handling), the app crashes with an unhandled rejection, causing the white screen. The `App.tsx` also has no global unhandled rejection safety net.

### 2. Knowledge Base Processing
The `process-knowledge` edge function works but needs Instagram URL support added alongside YouTube/PDF/regular URL handling.

---

## Plan

### Step 1: Fix Workspace Creation Crash
- Add `try/catch` in all mutation functions in `Workspaces.tsx` 
- Add a global `unhandledrejection` listener in `App.tsx` to prevent white screens from any unhandled async errors
- Add `onError` handlers to `setActive` and `deleteWorkspace` mutations

### Step 2: Add Instagram URL Processing to Knowledge Base
- Update `KnowledgeBase.tsx` to detect Instagram URLs and show an Instagram icon
- Update `process-knowledge` edge function to handle Instagram URLs:
  - Fetch the Instagram page HTML
  - Extract post captions, bio text, profile info
  - Use AI to analyze and extract sales knowledge from the content
  - Store extracted knowledge chunks in the database

### Step 3: Profile Analysis via Web Scraping (Workspace)
- Create a new edge function `analyze-profile` that:
  - Takes workspace Instagram/TikTok/store URLs
  - Scrapes each URL to get real content (bio, posts, products)
  - Uses AI to generate a profile analysis and detect products
  - Updates the workspace's `profile_analysis` and `products_detected` columns
- Add an "Analyze Profile" button to each workspace card in `Workspaces.tsx`
- Show a loading state while analysis runs

### Step 4: YouTube Playlist / Multiple URL Import
- Add a new "Batch Import" dialog in `KnowledgeBase.tsx` with a textarea for pasting multiple YouTube URLs (one per line)
- For each URL, create a `knowledge_base_items` row with status "processing"
- Process them sequentially by calling `process-knowledge` for each URL
- Show progress as items complete (using the existing polling mechanism)

### Step 5: Dark Mode Already Working
Dark mode toggle is already implemented in `DashboardLayout.tsx` -- no changes needed.

---

## Technical Details

### Files to Modify
1. **`src/App.tsx`** -- Add global `unhandledrejection` listener
2. **`src/pages/Workspaces.tsx`** -- Add error handling to mutations, add "Analyze Profile" button
3. **`src/pages/KnowledgeBase.tsx`** -- Add Instagram icon detection, add batch URL import dialog
4. **`supabase/functions/process-knowledge/index.ts`** -- Add Instagram URL scraping logic
5. **`supabase/functions/analyze-profile/index.ts`** (new) -- Workspace profile scraping and analysis
6. **`supabase/config.toml`** -- Register new `analyze-profile` function

### Edge Function: analyze-profile
- Accepts `workspaceId`
- Fetches the workspace record to get URLs
- For each URL (Instagram, TikTok, store), fetches HTML content
- Sends all scraped content to AI with a prompt to analyze the business profile, detect products, and summarize the niche
- Updates workspace `profile_analysis` and `products_detected` columns

### Instagram Processing in process-knowledge
- Detect Instagram URLs (`instagram.com` or `instagr.am`)
- Fetch the page HTML with a browser-like User-Agent
- Extract any available text (captions, bio, alt text from images)
- Pass to AI for knowledge extraction (same flow as regular URLs)

### Batch URL Import
- User pastes multiple URLs (one per line) in a textarea
- Frontend creates one `knowledge_base_items` record per URL
- Calls `process-knowledge` for each in sequence with a small delay
- Uses existing polling to update status badges as items complete

