// Sales Playbook Library - Proven frameworks from top closers

export const SALES_PLAYBOOK = `
SALES PLAYBOOK — PROVEN FRAMEWORKS FROM TOP CLOSERS:

═══ CHRIS VOSS (Never Split the Difference) ═══
• **Tactical Empathy**: Label their emotions before they do. "It sounds like you're feeling overwhelmed by all the options out there."
• **Mirroring**: Repeat the last 1-3 words they said as a question. This makes them elaborate without you asking.
• **Calibrated Questions**: Use "How" and "What" questions to make them solve YOUR problem. "How am I supposed to do that?" / "What about this doesn't work for you?"
• **The Late-Night FM DJ Voice**: Slow down, lower your voice, speak calmly. This triggers trust and safety.
• **Accusation Audit**: Front-load every negative thing they might think about you. "You're probably thinking this is just another person trying to sell you something..."
• **"No"-Oriented Questions**: Instead of seeking "yes," ask questions designed to get "no" — it gives them a sense of control. "Would it be a terrible idea if I shared what worked for me?"
• **"That's Right" Moment**: Summarize their situation so perfectly they say "That's right" — this is the breakthrough moment of trust.

═══ ALEX HORMOZI ($100M Offers / Leads) ═══
• **Value Equation**: Increase Dream Outcome + Perceived Likelihood of Achievement. Decrease Time Delay + Effort/Sacrifice.
• **The Grand Slam Offer**: Make an offer so good people feel stupid saying no. Stack value until the price seems tiny.
• **Problem-Solution Framing**: Every problem has a cost. Quantify it. "If you're losing 10 leads a day, that's 300/month × $500 each = $150K left on the table."
• **Scarcity & Urgency** (only if REAL): Never fake it. Real scarcity: "We only take 5 clients at a time because of the hands-on approach."
• **Identity Shift**: Help them see themselves as the person who ALREADY made this decision. "People at your level usually..."
• **Conviction Transfer**: Your belief in the solution must be so strong it transfers to them. Speak from RESULTS, not features.

═══ JORDAN BELFORT (Straight Line Persuasion) ═══
• **Tonality Control**: 80% of persuasion is HOW you say it. Key tones: certainty, enthusiasm, empathy, curiosity.
• **The Straight Line**: Every response should move the conversation toward the close in a straight line. Don't go off on tangents.
• **Three Tens**: The prospect must be at a "10" on three things: (1) Trust in the product, (2) Trust in YOU, (3) Trust in the company.
• **Looping**: When they object, don't argue. Acknowledge → deflect → loop back to building value. "I hear you, and that's exactly why..."
• **Future Pacing**: Paint the picture of their life AFTER the transformation. Make it vivid and emotional.

═══ GRANT CARDONE (Sell or Be Sold) ═══
• **Massive Agreement**: Agree with everything first. "You're right, you DO need to think about it. That tells me you're serious about making the right choice."
• **Stay in the Deal**: Most people quit after 1-2 objections. Stay in through 5+. The fortune is in the follow-up.
• **Price is a Myth**: When they say it's too expensive, they mean they don't see enough value YET. Go back to value, not price.
• **Commitment Stacking**: Get small yeses first. Each "yes" builds momentum toward the big "yes."
• **Unreasonable Action**: Take 10x more action than anyone thinks is necessary. Follow up relentlessly.

═══ DANIEL PINK (To Sell Is Human) ═══
• **Attunement**: Reduce your power, increase your empathy. See the world from THEIR perspective.
• **Buoyancy**: Handle rejection by treating it as temporary and specific, not permanent and universal.
• **Clarity**: Help prospects see their situation in a new light. They don't always know what their REAL problem is.
• **The Pixar Pitch**: Structure your story like Pixar: "Once upon a time... Every day... One day... Because of that... Until finally..."

WHEN TO USE WHICH FRAMEWORK:
- Prospect is guarded/skeptical → Chris Voss (Tactical Empathy + Accusation Audit)
- Prospect needs to see value → Hormozi (Value Equation + Problem-Solution)
- Prospect is engaged but stalling → Belfort (Future Pacing + Looping)
- Prospect raised price objection → Cardone (Massive Agreement) + Hormozi (Value Equation)
- Prospect seems confused → Daniel Pink (Clarity)
`;

export const FRAMEWORK_DETECTION_PROMPT = `
FRAMEWORK SELECTION:
Based on the prospect's current tone and stage, automatically select the most relevant sales framework techniques from your playbook. DO NOT mention framework names to the prospect. Instead, APPLY the techniques naturally in your suggested responses.

For example:
- If prospect seems skeptical → use Chris Voss's Accusation Audit technique in your reply
- If prospect asked about price → use Hormozi's Value Equation to reframe value
- If prospect is warm but hasn't committed → use Belfort's Future Pacing
`;
