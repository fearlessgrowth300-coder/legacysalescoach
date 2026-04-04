

## Plan: Enhanced Intelligence Panel + Persuasion Engine for Friends Chat

### What's Changing

The Conversation Intelligence Panel currently shows warmth, stage, psychology, pain, signals, and recommended move. We'll expand it to also display the **objection bucket**, **SPIN stage**, **prospect fears/dreams**, and **conversion triggers** — all data the `analyze-conversation` function already returns but the UI doesn't show.

We'll also surface this intelligence **inline on each suggestion card** so the user sees the strategic context right alongside the reply.

### 1. Expand ConversationIntelligencePanel UI

**File: `src/components/ConversationIntelligencePanel.tsx`**

- Add the new fields to the `ConversationAnalysis` interface: `objection_detected`, `objection_bucket`, `objection_response_type`, `objection_is_repeat`, `spin_stage`, `discovery_question_type`, `prospect_fears`, `prospect_dreams`, `conversion_triggers`, `trust_words_detected`, `resistance_words_detected`, `prospect_decision_language`
- Add new visual sections to the expanded panel:
  - **Objection Radar** card: Shows detected objection phrase, colored bucket badge (TIME/MONEY/TRUST/etc.), response type badge, and a "repeat" warning if the same bucket appeared before
  - **SPIN Stage** indicator: 4-step progress bar (Situation → Problem → Implication → Need-Payoff) with the current stage highlighted, plus the suggested next question type
  - **Fears & Dreams** side-by-side cards: Red-tinted card listing prospect fears, green-tinted card listing prospect dreams
  - **Conversion Triggers** section: Badges showing specific things that could push the prospect to convert
  - **Trust vs Resistance** mini-section: Green badges for trust words, red badges for resistance words

### 2. Add Intelligence Context to SuggestionCard

**File: `src/components/SuggestionCard.tsx`**

- Add a new collapsible "Intelligence" row between the header and message body
- When analysis data is available, show compact badges for:
  - Objection bucket (if detected): e.g., `🎯 MONEY — REFRAME`
  - SPIN stage: e.g., `🔄 Implication`
  - Top conversion trigger (if any): e.g., `⚡ proof of results`
- This gives the user strategic context *per suggestion* without scrolling up to the panel

### 3. Add Persuasion Framework Indicators

**File: `src/components/SuggestionCard.tsx`**

- Parse the `frameworkUsed` field (already returned by `generate-reply`) to show which persuasion frameworks are being layered
- Display framework badges like `SPIN`, `PAS`, `StoryBrand`, `Before/After/Bridge` in the card footer
- Show the specific persuasion technique being used (e.g., "Identity-based selling", "Micro-commitment") alongside the existing "Why This Works"

### 4. Update Suggestion Interface

**File: `src/components/SuggestionCard.tsx`**

- Extend the `Suggestion` interface to include optional fields: `detectedObjection`, `objectionBucket`, `objectionResponseType`, `spinStage`, `frameworksApplied` (string array)
- These are already returned by `chat-suggest` and `generate-reply` edge functions but not yet passed through to the UI

### Technical Details

- The `analyze-conversation` edge function already returns all required fields (objection_bucket, spin_stage, prospect_fears, prospect_dreams, conversion_triggers, etc.) — this is purely a frontend display task
- No backend changes needed; all data is already flowing through `conversationAnalysis` state in `Chats.tsx`
- The `Suggestion` type needs to carry the per-suggestion framework metadata from the edge function response

