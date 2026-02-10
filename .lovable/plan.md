

# Fix Authentication - Session Persistence and Login Issues

## Root Cause

The `useAuth` hook has a critical bug: it performs `await` calls (profile fetch) inside the `onAuthStateChange` callback. This blocks Supabase's internal auth state machine, causing:
- Sessions not restoring on page reload
- Login appearing to hang (button stays on "Signing in...")
- The 5-second timeout fires, sets `loading=false`, but `user` is still `null` so the app shows the sign-in page

## Fix

### 1. Rewrite `useAuth.tsx` with proper async handling
- Set up `onAuthStateChange` with **synchronous-only** state updates (set session and user immediately from `session.user`)
- Fetch profile data in a **separate, non-blocking** call (fire and forget, then update user with name when it resolves)
- Use `getSession()` for the initial load, completing all work before setting `loading = false`
- Add `isMounted` flag to prevent state updates after unmount
- Keep the 5-second timeout as a safety net

### 2. Fix Login page navigation
- After `signInWithPassword` succeeds, wait briefly for auth state to propagate before navigating
- Or use the auth state change to trigger navigation instead of doing it manually

### 3. Fix `DashboardLayout` redirect behavior
- When `loading` is `false` and `user` is `null`, redirect to `/login` using `Navigate` instead of showing an inline sign-in card (which creates a confusing duplicate login UI)

## Technical Details

### Files to modify

**`src/hooks/useAuth.tsx`**
- Remove `async` from `onAuthStateChange` callback
- Set `session` and `user` synchronously from `session.user` (no profile fetch blocking)
- Fire profile fetch separately: `setTimeout(() => fetchProfile(session.user.id), 0)` to avoid deadlock
- In `getSession` initial load: fetch profile, set user, THEN set `loading = false`
- Add `isMounted` cleanup flag

**`src/pages/Login.tsx`**
- After successful login, add a small delay or listen to auth context before navigating
- Alternatively, check if user is already set in context and auto-redirect

**`src/components/DashboardLayout.tsx`**
- Replace the inline "Sign in to continue" card with `<Navigate to="/login" replace />` so users go to the real login page instead of seeing a second login UI
