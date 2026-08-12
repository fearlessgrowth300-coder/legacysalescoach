export type FriendStage = "opener" | "rapport" | "pain" | "offer" | "close";

export type FriendStageEvidence = {
  motivation: boolean;
  currentStrategy: boolean;
  activeProblem: boolean;
  desiredResult: boolean;
  wantsHelp: boolean;
  acceptedHandoff: boolean;
};

const EMPTY_VALUES = new Set([
  "",
  "unknown",
  "none",
  "not inferred",
  "not provided",
  "n/a",
  "unclear",
]);

function normalized(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
}

function known(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(known);
  if (typeof value === "boolean") return value;
  const valueText = normalized(value);
  return Boolean(valueText) && !EMPTY_VALUES.has(valueText);
}

function includesAny(value: unknown, candidates: string[]): boolean {
  const valueText = normalized(value).replace(/[ -]+/g, "_");
  return candidates.some((candidate) => valueText === candidate || valueText.includes(candidate));
}

export function normalizeFriendStage(value: unknown): FriendStage {
  const stage = normalized(value).replace(/[ -]+/g, "_");
  if (["close", "closing", "decision", "accepted_referral", "ready_for_handoff"].includes(stage)) return "close";
  if (["offer", "solution", "permission", "ask_permission", "referral", "need_payoff", "expert_introduction"].includes(stage)) return "offer";
  if (["pain", "pain_discovery", "problem", "implication", "desired_result"].includes(stage)) return "pain";
  if (["rapport", "rapport_building", "continuing", "warming", "common_ground", "motivation", "current_strategy", "situation"].includes(stage)) return "rapport";
  return "opener";
}

export function collectFriendStageEvidence(analysis: Record<string, unknown> | null | undefined): FriendStageEvidence {
  const value = analysis || {};
  const problemStatus = normalized(value.problem_status).replace(/[ -]+/g, "_");
  const hasExplicitProblemStatus = ["active", "past_resolved", "resolved", "not_active", "unclear", "none"].includes(problemStatus);
  const activeProblem = problemStatus === "active" || (!hasExplicitProblemStatus && (
    value.pain_expressed === true
    || known(value.pain_points)
    || known(value.pain_summary)
    || known(value.problem_gap)
  ));
  const readiness = `${normalized(value.readiness)} ${normalized(value.referral_readiness)}`;
  const wantsHelp = includesAny(readiness, ["wants_help", "ask_permission", "accepted_referral", "ready_for_handoff"]);
  const acceptedHandoff = includesAny(readiness, ["accepted_referral", "ready_for_handoff"]);

  return {
    motivation: known(value.motivation) || known(value.intent) || known(value.desires),
    currentStrategy: known(value.current_strategy) || known(value.experience_level) || known(value.sales_status),
    activeProblem,
    desiredResult: known(value.tangible_goal) || known(value.desires) || known(value.prospect_dreams),
    wantsHelp,
    acceptedHandoff,
  };
}

export function deriveEvidenceGatedFriendStage(
  analysis: Record<string, unknown> | null | undefined,
  messageCount: number,
): { stage: FriendStage; evidence: FriendStageEvidence; missing: string[] } {
  const value = analysis || {};
  const evidence = collectFriendStageEvidence(value);
  const contactStatus = normalized(value.contact_status).replace(/[ -]+/g, "_");

  let stage: FriendStage = "opener";
  if (messageCount >= 2 && (evidence.motivation || evidence.currentStrategy)) stage = "rapport";
  if (messageCount >= 4 && evidence.activeProblem && (evidence.motivation || evidence.currentStrategy)) stage = "pain";
  if (evidence.activeProblem && evidence.desiredResult && evidence.wantsHelp) stage = "offer";
  if (evidence.acceptedHandoff) stage = "close";

  // Explicit boundaries are not conversion stages. Keep the truthful stage for
  // reporting, while the reply policy separately requires a respectful stop.
  if (["do_not_contact", "not_a_fit"].includes(contactStatus) && stage === "opener" && messageCount >= 2) {
    stage = "rapport";
  }

  const missing: string[] = [];
  if (!evidence.motivation) missing.push("their own motivation or intended result");
  if (!evidence.currentStrategy) missing.push("their own current strategy and result status");
  if (!evidence.activeProblem) missing.push("an active unresolved problem or gap in their own situation");
  if (!evidence.desiredResult) missing.push("a concrete desired result");
  if (!evidence.wantsHelp) missing.push("permission or explicit interest in help");
  if (!evidence.acceptedHandoff) missing.push("acceptance of the expert introduction or handoff");

  return { stage, evidence, missing };
}

export function friendStageToDatabase(stage: FriendStage): string {
  return stage === "opener" ? "first_contact" : stage;
}

export function buildFriendStageDirective(stageResult: ReturnType<typeof deriveEvidenceGatedFriendStage>): string {
  const { stage, evidence, missing } = stageResult;
  const objectives: Record<FriendStage, string> = {
    opener: "Earn a genuine reply from one specific profile or conversation detail. Do not diagnose or pitch.",
    rapport: "Build mutual context and learn the single highest-priority missing fact about this prospect's own motivation, result status, or current strategy.",
    pain: "Clarify the prospect's active gap, its real impact, and the concrete result they want. Do not turn a resolved past problem or their audience's problem into their current pain.",
    offer: "Connect the diagnosed gap to an approved story, strategy, or expert only after interest in help is clear. Ask permission before explaining or referring.",
    close: "Complete the approved handoff, answer the practical objection or decision question directly, and give one concrete next step without manufactured urgency.",
  };
  return `[EVIDENCE-GATED FRIEND JOURNEY]\nCanonical stage: ${stage}\nStage objective: ${objectives[stage]}\nEvidence: ${JSON.stringify(evidence)}\nStill missing: ${missing.join("; ") || "none"}\nDo not advance merely because the conversation is warm or long. Advance only when the required evidence is explicitly present.`;
}

function meaningfulTerms(value: string): string[] {
  const stop = new Set(["about", "after", "again", "also", "because", "been", "being", "from", "have", "into", "just", "more", "only", "that", "their", "there", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);
  return Array.from(new Set((value.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((term) => !stop.has(term))));
}

export function selectRelevantConversationPassages(
  fullExample: string,
  query: string,
  stage: FriendStage,
  limit = 6,
): string {
  const source = String(fullExample || "").trim();
  if (!source) return "No approved reference conversation supplied.";

  const paragraphs = source.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > 1800) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) chunks.push(current);

  const stageTerms: Record<FriendStage, string[]> = {
    opener: ["opener", "first", "profile", "post", "starting", "journey"],
    rapport: ["rapport", "motivation", "intent", "experience", "strategy", "course", "sales"],
    pain: ["pain", "problem", "gap", "struggle", "frustrated", "impact", "holding", "sales"],
    offer: ["transition", "permission", "help", "strategy", "expert", "mentor", "solution"],
    close: ["close", "objection", "price", "trust", "link", "connect", "contact", "decision"],
  };
  const queryTerms = meaningfulTerms(`${query} ${stageTerms[stage].join(" ")}`);
  const ranked = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const term of queryTerms) if (lower.includes(term)) score += 3;
    for (const term of stageTerms[stage]) if (lower.includes(term)) score += 5;
    return { chunk, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(1, limit));

  return ranked.map((item, index) => `[REFERENCE MOMENT ${index + 1}]\n${item.chunk}`).join("\n\n");
}

export function buildFriendQualityValidatorPrompt(collectionKey: "variants" | "suggestions"): string {
  return `You are the final conversion-quality validator for a truthful peer-to-peer Friend conversation. Return JSON only with the key "${collectionKey}" and the same number of items and compatible fields you received. Repair weak items before returning them.

Every ready-to-send message must pass all checks:
1. It answers the prospect's newest direct question before doing anything else.
2. It performs the locked stage objective and reply_act; it does not jump forward or drift backward.
3. It refers to the prospect's OWN motivation, strategy, results and active problem. Never interview them about their audience when their own situation is still unknown.
4. It contains one concrete peer reaction or useful observation, then at most one necessary question. A question is optional.
5. It never repeats a question already answered in the conversation.
6. It rejects vague filler, empty encouragement, abstract hypotheticals, generic compliments, "good vibes" endings, and questions that do not fill a missing evidence field.
7. It does not accept a polite brush-off as proof of satisfaction. It may respectfully test whether the desired result is already being achieved, but it must respect a clear no or boundary.
8. It uses the retrieved Knowledge Base principle silently and accurately. It never recites a framework or invents personal proof.
9. It uses only approved identity, story, result, price, scarcity, expert, offer and URL facts.
10. At offer/close, it asks permission before an introduction and gives a concrete approved handoff only after acceptance.

The three items must pursue the same next objective with different natural wording. Preserve metadata fields, but correct them when the message changed.`;
}

export function deterministicFriendQualityIssues(text: string, stage: FriendStage): string[] {
  const message = String(text || "").trim();
  const issues: string[] = [];
  if (!message) issues.push("empty reply");
  if ((message.match(/\?/g) || []).length > 1) issues.push("more than one question");
  if (/good vibes|if you ever want to chat|what do you think would be possible|amplify that feeling/i.test(message)) issues.push("vague non-progressing language");
  if (stage === "opener" && /expert|mentor|buy|price|link|offer/i.test(message)) issues.push("premature offer in opener");
  if (stage === "rapport" && /\baudience\b/i.test(message) && /struggl|problem|intimidat|overwhelm/i.test(message)) issues.push("asks about the audience instead of the prospect");
  return issues;
}
