

# Fix All Issues + Add Tonality Learning + Conversation Analytics

## Issues Identified

### 1. White Screen / Loading on Every Page (ROOT CAUSE)
The `DashboardLayout` component (line 40-46) shows "Loading..." forever when `useAuth` stays in `loading: true` state. The `useAuth` hook properly handles errors in `getSession`, but the issue is that on the **published site** the latest code changes may not be deployed. Additionally, if the Supabase connection is slow or fails silently (e.g. network timeout), the `onAuthStateChange` callback may never fire, leaving `loading: true` forever.

**Fix**: Add a timeout fallback in `useAuth.tsx` -- if `loading` is still `true` after 5 seconds, force it to `false`. This prevents the white screen in all edge cases.

### 2. Login Page Stops at "Sign In" 
The Login page itself does NOT use `DashboardLayout`, so its loading issue is different. The `handleSubmit` has proper error handling. The issue is likely that after login succeeds, navigating to `/chats` triggers `DashboardLayout` which gets stuck on loading (same root cause as #1).

**Fix**: Same timeout fix in `useAuth.tsx` resolves this.

### 3. Workspace Creation Hangs
The `createWorkspace` mutation in `Workspaces.tsx` already has `onError` handlers from the previous fix. But the mutation could hang if the Supabase insert promise never resolves. 

**Fix**: Add explicit `try/catch` wrapping in each `mutationFn` and ensure all error paths call `toast.error`.

### 4. PDF Upload / URL Paste Not Working
The Knowledge Base `addUrl` and `addPdf` mutations fire the edge function in the background (`.then()`) but if the initial DB insert fails silently, nothing happens.

**Fix**: Add `onError` handlers to mutations and ensure the edge function call is properly error-handled.

### 5. Tonality Learning
The `chat-suggest` edge function already has consultative selling prompts. But it does NOT currently learn tonality from past conversations. Need to:
- Analyze the prospect's detected tones from previous messages
- Feed that pattern back into the AI prompt so it adapts

**Fix**: Update `chat-suggest` to aggregate `detected_tone` from past messages and include a tonality analysis section in the prompt.

### 6. Conversation Analytics (New Feature)
Track which questioning patterns lead to wins so the AI improves over time.

**Fix**: 
- Create a new `conversation_analytics` table to store per-prospect analytics (questioning patterns used, outcome, conversation length, key moments)
- Update `chat-suggest` to save the detected questioning pattern after each suggestion
- Update the Analytics page to show pattern-based win rates
- Feed winning patterns back into the AI prompt

---

## Implementation Steps

### Step 1: Fix Auth Loading (White Screen Fix)
**File: `src/hooks/useAuth.tsx`**
- Add a 5-second timeout: if `loading` is still `true` after 5 seconds, force `setLoading(false)`
- This catches all edge cases: slow network, failed Supabase connection, unresolved promises

### Step 2: Fix Workspace & Knowledge Base Error Handling
**File: `src/pages/Workspaces.tsx`**
- Wrap `mutationFn` bodies in explicit `try/catch` for `createWorkspace`, `setActive`, `deleteWorkspace`

**File: `src/pages/KnowledgeBase.tsx`**  
- Add `onError` handlers to `addUrl` and `addPdf` mutations if missing
- Add `try/catch` around edge function invocations

### Step 3: Add Tonality Learning to Chat AI
**File: `supabase/functions/chat-suggest/index.ts`**
- Query past messages for this prospect and aggregate `detected_tone` values
- Add a "TONALITY ANALYSIS" section to the prompt showing the prospect's tone patterns
- After generating suggestions, save the `detectedTone` back to the inbound message record
- Include instructions for the AI to mirror and adapt to the prospect's communication style

### Step 4: Create Conversation Analytics Table
**Database migration**:
- Create `conversation_analytics` table with columns:
  - `id`, `user_id`, `prospect_id`, `workspace_id`
  - `questioning_pattern` (text -- which pattern was used: situation, problem, implication, etc.)
  - `outcome` (text -- won, lost, ghosted, active)
  - `messages_count` (integer)
  - `ai_suggestions_used` (integer)
  - `conversation_duration_days` (integer)
  - `key_insights` (text -- AI-generated summary of what worked)
  - `created_at`, `updated_at`
- Add RLS policies for user access

### Step 5: Update Chat-Suggest to Track Patterns
**File: `supabase/functions/chat-suggest/index.ts`**
- After generating suggestions, detect which questioning pattern was used (situation, problem, implication, need-payoff, emotional trigger)
- Save/update the `conversation_analytics` record for this prospect
- When generating new suggestions, query winning patterns from past prospects and include them in the prompt as "what has worked before"

### Step 6: Update Analytics Page
**File: `src/pages/Analytics.tsx`**
- Add a new "Conversation Patterns" section showing:
  - Which questioning patterns lead to the most wins
  - Average conversation length for won vs lost prospects  
  - Most effective opening approaches
  - AI learning progress over time
- Use cards with progress bars to show win rates by pattern

---

## Technical Details

### Auth Timeout (useAuth.tsx)
```text
Add useEffect with 5-second setTimeout:
- If loading is still true after 5s, set loading to false
- Clear timeout on cleanup or when loading becomes false
```

### Conversation Analytics Table Schema
```text
conversation_analytics:
  - id: uuid (PK, default gen_random_uuid())
  - user_id: uuid (NOT NULL)
  - prospect_id: uuid (FK to prospects, ON DELETE CASCADE)
  - workspace_id: uuid (FK to workspaces, ON DELETE CASCADE)
  - questioning_patterns_used: text[] (array of patterns detected)
  - outcome: text (default 'active')
  - messages_count: integer (default 0)
  - ai_suggestions_used: integer (default 0)
  - avg_response_time_mins: integer
  - key_insights: text
  - tone_progression: text[] (array of tones over time)
  - created_at: timestamptz
  - updated_at: timestamptz

RLS: Users can only read/write their own rows
```

### Chat-Suggest Enhancements
- Query `conversation_analytics` for won prospects in the same workspace
- Extract patterns that led to wins
- Include in prompt: "PROVEN WINNING PATTERNS: [patterns from won prospects]"
- After response, update analytics record with new pattern data
- Save detected tone to the inbound message

### Files to Modify
1. `src/hooks/useAuth.tsx` -- Add loading timeout
2. `src/pages/Workspaces.tsx` -- Strengthen error handling  
3. `src/pages/KnowledgeBase.tsx` -- Strengthen error handling
4. `supabase/functions/chat-suggest/index.ts` -- Add tonality learning + pattern tracking
5. `src/pages/Analytics.tsx` -- Add conversation pattern analytics UI
6. Database migration -- Create `conversation_analytics` table with RLS

