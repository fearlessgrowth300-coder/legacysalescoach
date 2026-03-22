// Objection Radar — Detection, Classification, and Strategic Response

export const OBJECTION_HANDLERS = `
═══════════════════════════════════════════════
OBJECTION RADAR — DETECT → CLASSIFY → RESPOND
═══════════════════════════════════════════════

STEP 1: DETECT — Scan every prospect message for objection LANGUAGE

Watch for these exact phrases and patterns:

"I'm busy" / "no time" / "swamped" / "crazy week" → TIME
"I need to think" / "let me sleep on it" / "not sure yet" → CERTAINTY
"Send me details" / "I'll look into it" / "tell me more" → NEED MORE CLARITY
"How much?" / "what's the cost" / "I can't afford" / "tight budget" → MONEY
"I'm not ready" / "maybe later" / "not the right time" → TIMING
"Let me talk to my spouse" / "need to ask my partner" → TRUST (shared decision)
"I tried this before" / "been burned" / "scammed before" → TRUST (past experience)
"I don't know if this is for me" / "not my thing" → FEAR
"I'm good where I am" / "not interested" → PRIORITY
"What makes this different?" / "everyone says that" → CERTAINTY

Also detect INDIRECT objections:
- Short, one-word replies after longer messages = DISENGAGING
- Changing the subject = AVOIDANCE (classify as FEAR or TRUST)
- Sudden silence after a question = OVERWHELM (classify as CERTAINTY)
- "Haha" / "lol" with no substance = DEFLECTION (classify as FEAR)
- Asking lots of questions without committing = NEED MORE CLARITY

STEP 2: CLASSIFY — Put every objection into a bucket

| BUCKET | Core Fear | They're Really Saying |
|--------|-----------|----------------------|
| TIME | "I'll lose my free time" | "I don't believe this is worth my time" |
| MONEY | "I'll lose money" | "I don't see enough value yet" |
| TRUST | "I'll get hurt/scammed" | "I haven't seen enough proof" |
| CERTAINTY | "What if it doesn't work?" | "I need more confidence in the outcome" |
| PRIORITY | "Other things matter more" | "You haven't connected to my deepest need" |
| FEAR | "What if I fail/look stupid?" | "I'm scared of change" |
| TIMING | "Not right now" | "The pain isn't urgent enough yet" |
| NEED MORE CLARITY | "I don't understand enough" | "Explain it differently" |

STEP 3: RESPOND — Choose the right response TYPE for each bucket

| BUCKET | Response Type | What to Do |
|--------|--------------|-----------|
| TIME | REFRAME | Turn busy into qualification: "Busy people get the best results because they're already action-takers" |
| MONEY | REFRAME | Quantify cost of inaction: "What does another 6 months of [problem] actually cost you?" |
| TRUST | REASSURE | Share YOUR skepticism journey + specific proof: "I was the same way. Then I saw [specific result]" |
| CERTAINTY | CLARIFY | Isolate the specific doubt: "What specifically would you need to see to feel confident?" |
| PRIORITY | DEEPEN | Use SPIN Implication: "How is [their problem] affecting [deeper area of life]?" |
| FEAR | REASSURE + REFRAME | Normalize fear: "Everyone I know who succeeded felt exactly like you do right now" |
| TIMING | REFRAME | Challenge the assumption: "What changes between now and later that makes this easier?" |
| NEED MORE CLARITY | CLARIFY | Answer directly, then re-engage: "Great question. [Answer]. What other questions do you have?" |

RESPONSE TECHNIQUES BY TYPE:

**CLARIFY** — Ask a question to understand the REAL objection:
- "When you say [their words], what do you mean by that exactly?"
- "Help me understand — is it more about [A] or [B]?"
- "What would need to be true for you to feel good about this?"

**REASSURE** — Provide evidence and emotional safety:
- Share a story of someone in their EXACT situation who succeeded
- Acknowledge their fear without dismissing it
- "I felt the exact same way. Here's what changed my mind..."

**REFRAME** — Shift their perspective without arguing:
- Agree with their concern, then show a new angle
- "You're right, AND..." (not "but")
- Quantify the cost of NOT acting

**DEEPEN** — Go DEEPER into their pain (use SPIN Implication):
- "How is that affecting [bigger area]?"
- "What happens to [important thing] if this continues?"
- Make the STATUS QUO feel more painful than the change

**ISOLATE** — Separate the real objection from the noise:
- "If [this concern] wasn't a factor, would you want to move forward?"
- "Is it really about [stated objection], or is there something else?"
- "On a scale of 1-10, how much is [objection] really the thing stopping you?"

**HAND OFF** — When the friend has done their job, transition naturally:
- "Honestly, I'm not the expert on the technical side..."
- "I know exactly one person who specializes in this..."
- "Would it help if I connected you? Zero pressure."

CRITICAL RULES:
- NEVER crush an objection head-on. NEVER argue.
- ALWAYS acknowledge first: "I totally hear you on that..."
- When multiple objections detected, address the EMOTIONAL one first
- If the same objection comes back 3+ times, they need REASSURANCE not logic
- Track which objections this prospect has raised before (from Lead Registry)
- If they've raised the SAME objection before, use a DIFFERENT technique this time

═══════════════════════════════════════════════
END OBJECTION RADAR
═══════════════════════════════════════════════
`;

export const OBJECTION_DETECTION_PROMPT = `
OBJECTION RADAR (CRITICAL — run on EVERY message):

Before generating suggestions, execute this objection scan:

1. SCAN the prospect's message for objection keywords/phrases from the Objection Radar
2. SCAN for indirect objections (short replies, deflection, subject changes, silence)
3. CLASSIFY into bucket: TIME, MONEY, TRUST, CERTAINTY, PRIORITY, FEAR, TIMING, NEED MORE CLARITY
4. CHECK Lead Registry — has this prospect raised this same objection before?
5. SELECT response type: CLARIFY, REASSURE, REFRAME, DEEPEN, ISOLATE, or HAND OFF
6. If same objection repeated → use a DIFFERENT response type than last time

Apply the response type in your PRIMARY suggestion.
Use DIFFERENT response types for alternative and softer variants.

In "detectedObjection" field, return: "[BUCKET]: [specific phrase detected]"
In "objectionResponseType" field, return: "CLARIFY" | "REASSURE" | "REFRAME" | "DEEPEN" | "ISOLATE" | "HAND_OFF"

If NO objection detected, continue with discovery/deepening questions.
`;
