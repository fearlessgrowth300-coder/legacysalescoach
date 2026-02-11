// Objection Handler Database - Battle-tested responses for common resistance

export const OBJECTION_HANDLERS = `
OBJECTION HANDLER DATABASE — AUTOMATIC DETECTION & RESPONSE:

When you detect ANY of these objections in the prospect's message, your suggestions MUST incorporate the corresponding handler technique. Never address the objection head-on or defensively. Instead, use the technique naturally.

═══ PRICE / MONEY OBJECTIONS ═══
🔴 "I can't afford it" / "Too expensive" / "Not in my budget"
TECHNIQUE: Reframe from cost to cost-of-NOT-doing-it.
APPROACH: "I totally get that. When I was in your spot, I felt the same way. What really changed my mind was realizing how much I was ALREADY spending on [their current failed approaches] without getting results. Like, I added it up and it was insane."
KEY: Quantify their current pain. Make the status quo feel MORE expensive than the solution.

🔴 "I need to save up first"
TECHNIQUE: Urgency through opportunity cost (NOT fake scarcity).
APPROACH: "Makes total sense to be smart with money. The thing that hit me was — every month I waited, I was leaving [specific result] on the table. What does another 3-6 months of [their problem] actually cost you?"
KEY: Make WAITING feel expensive.

═══ TIME / TIMING OBJECTIONS ═══
🔴 "I need to think about it" / "Let me sleep on it"
TECHNIQUE: Massive Agreement + Isolation.
APPROACH: "100% — you SHOULD think about it. That tells me you're serious. Just so I know what to share if you have questions — what specifically are you weighing up?"
KEY: Agree, validate, then isolate what's REALLY holding them back.

🔴 "Now's not the right time" / "Maybe later"
TECHNIQUE: Future pacing + pattern interrupt.
APPROACH: "I said the exact same thing for like 8 months lol. Then someone asked me — 'what changes between now and later that makes this easier?' And I had no answer. That's when it clicked."
KEY: Challenge the assumption that "later" will be better.

🔴 "I'm too busy right now"
TECHNIQUE: Empathy + reframe.
APPROACH: "I feel you on that. Honestly that's usually a sign that something needs to change, not that you should keep doing the same things. The people who get the best results are always the 'busy' ones — because they're already action-takers."
KEY: Turn their objection into a QUALIFICATION for why they're perfect for this.

═══ TRUST / CREDIBILITY OBJECTIONS ═══
🔴 "I've been burned before" / "I've tried things like this"
TECHNIQUE: Validate + differentiate.
APPROACH: "Ugh, I've been there too. That's actually why I was so skeptical at first. What was different this time was [specific differentiator]. But honestly, I didn't believe it until I saw [specific result] myself."
KEY: Don't attack their past experience. Share YOUR skepticism journey.

🔴 "How do I know this will work for me?"
TECHNIQUE: Social proof from similar situation + risk reversal.
APPROACH: "That's the right question to ask. I know someone in [their exact niche/situation] who had the same doubt. They were doing [similar numbers]. Within [timeframe] they [specific result]. But obviously your situation is unique — that's why [the expert/team] does a proper assessment first."
KEY: Specific proof > generic claims. Always reference someone in THEIR situation.

🔴 "I don't know you well enough"
TECHNIQUE: Transparency + time allowance.
APPROACH: "Totally fair. We literally just connected. I'm not trying to sell you anything — I genuinely just found what you're doing interesting. No rush at all. What got you into [their niche] in the first place?"
KEY: Remove ALL pressure. Go back to relationship building.

═══ AUTHORITY / DECISION OBJECTIONS ═══
🔴 "I need to talk to my partner/spouse/business partner"
TECHNIQUE: Respect + equip them.
APPROACH: "Of course! That's smart to decide together. What do you think they'd want to know about it? I can help you explain it if that's useful."
KEY: Help them become the salesperson to their partner.

🔴 "I need to do more research"
TECHNIQUE: Guide the research.
APPROACH: "Love that you do your homework. What specifically do you want to research? Happy to point you to [specific resources/results/testimonials] so you're not wading through all the noise out there."
KEY: Channel their research toward YOUR proof points.

═══ COMPETITION OBJECTIONS ═══
🔴 "I found something cheaper" / "Someone else offers this"
TECHNIQUE: Never trash competition. Differentiate on fit.
APPROACH: "Oh nice, what are you looking at? Genuinely curious because I looked at a TON of options before landing on this. The thing that made the difference for me was [unique differentiator relevant to THEIR specific situation]."
KEY: Be curious, not defensive. Win on specificity to their situation.

═══ APATHY / LOW INTEREST ═══
🔴 "I'm not interested" / "I'm good where I am"
TECHNIQUE: Pattern interrupt + curiosity gap.
APPROACH: "Respect that! Out of curiosity though — when you say you're good, does that mean you're hitting [ambitious goal in their niche]? Or more like it's manageable?"
KEY: Challenge their definition of "good." Most people are settling, not thriving.

🔴 *Ghost / no reply*
TECHNIQUE: Value-first follow-up (NOT "just checking in").
APPROACH: "Hey [name] — saw this [specific relevant content/insight] and immediately thought of you because of [something they mentioned]. [Share the actual value]. No need to reply, just thought you'd find it useful!"
KEY: Give value with ZERO expectation. Make them think "this person actually gets me."

DETECTION RULES:
- Scan the prospect's message for keywords/phrases matching any objection above
- If detected, the "primary" suggestion MUST use the corresponding handler technique
- The "whyThisWorks" should explain which objection was detected and which technique is being applied
- NEVER use the handler verbatim — adapt it to the prospect's specific language, niche, and situation
- If multiple objections are detected, prioritize the EMOTIONAL one over the logical one
`;

export const OBJECTION_DETECTION_PROMPT = `
OBJECTION DETECTION (CRITICAL):
Before generating suggestions, scan the prospect's latest message for objections. Look for:
- Direct objections (explicit resistance statements)
- Indirect objections (deflection, changing subject, going quiet)
- Micro-objections (hesitation phrases like "maybe", "I guess", "not sure")

If ANY objection is detected:
1. Identify the objection category from your Objection Handler Database
2. Apply the recommended technique in your PRIMARY suggestion
3. Note the detected objection in your response metadata
4. Your "alternative" and "softer" suggestions should use different handler approaches for the same objection
`;
