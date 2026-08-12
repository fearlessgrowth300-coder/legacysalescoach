export type FriendStage = "intent" | "logical_certainty" | "emotional_certainty" | "pitch" | "handoff";

export type FriendStageEvidence = {
  tangibleGoal: boolean;
  whyGoalMatters: boolean;
  pastExperience: boolean;
  activeProblem: boolean;
  rootCause: boolean;
  consequences: boolean;
  needForChange: boolean;
  inactionPattern: boolean;
  detailedFutureOutcome: boolean;
  wantsHelp: boolean;
  acceptedHandoff: boolean;
};

export type FriendSalesSignal = {
  explicitSalesGoal: boolean;
  activeSalesGap: boolean;
  wantsSalesHelp: boolean;
  resultState: "no_sales" | "first_sale" | "inconsistent_sales" | "wants_more_sales" | "unknown";
  bottleneck: "traffic" | "offer" | "messaging" | "conversion" | "follow_up" | "consistency" | "unknown";
  evidence: string[];
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

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return "";
}

export function detectFriendSalesSignal(latestProspectMessage: string, prospectHistory = ""): FriendSalesSignal {
  const latest = normalized(latestProspectMessage);
  const context = normalized(`${prospectHistory} ${latestProspectMessage}`);
  const directGap = firstMatch(latest, [
    /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+(?:still\s+)?(?:not|never)\s+(?:getting|making|seeing|closing)\s+(?:any\s+|enough\s+|consistent\s+)?sales?\b/i,
    /\b(?:i|we)\s+(?:haven't|have not|can't|cannot|couldn't)\s+(?:made|get|getting|make|close|closed)\s+(?:a\s+|any\s+|enough\s+)?sales?\b/i,
    /\b(?:my|our)\s+(?:biggest\s+|main\s+)?(?:issue|problem|struggle|challenge|bottleneck)\s+(?:is|has been|right now is)\s+(?:getting\s+|making\s+|closing\s+)?sales?\b/i,
    /\b(?:i(?:'m| am)?|we(?:'re| are)?)\s+struggl\w*\s+(?:to|with)\s+(?:get|getting|make|making|close|closing)?\s*sales?\b/i,
    /\b(?:no|zero)\s+sales?\b/i,
    /\bsales?\s+(?:are|is|have been)\s+(?:slow|inconsistent|stuck|my problem|the problem)\b/i,
  ]);
  const desiredSales = firstMatch(latest, [
    /\b(?:i|we)\s+(?:need|want|am looking for|are looking for)\s+(?:some\s+)?(?:help|support|guidance)\s+(?:with|to|getting|making|closing)?\s*(?:more\s+|consistent\s+)?sales?\b/i,
    /\b(?:i|we)\s+(?:want|need|would like|am looking|are looking)\s+(?:to\s+)?(?:get|make|close|increase|grow|scale)?\s*(?:more\s+|consistent\s+|regular\s+)?sales?\b/i,
    /\b(?:more|consistent|regular|predictable)\s+sales?\b/i,
  ]);
  const helpSignal = firstMatch(latest, [
    /\b(?:i|we)\s+(?:need|want|am looking for|are looking for)\s+(?:some\s+)?(?:help|support|guidance|a mentor|an expert)\b/i,
    /\b(?:can|could|would)\s+(?:you|your team|the expert)\s+help\b/i,
  ]);
  const firstSale = firstMatch(context, [
    /\b(?:only|just)\s+(?:made|got|closed)\s+(?:my\s+|our\s+)?(?:first|one|1)\s+sales?\b/i,
    /\b(?:made|got|closed)\s+(?:my\s+|our\s+)?first\s+sale\b/i,
  ]);
  const inconsistent = firstMatch(context, [
    /\b(?:inconsistent|unpredictable|on and off)\s+sales?\b/i,
    /\bsales?\s+(?:are|have been)\s+(?:inconsistent|unpredictable|on and off)\b/i,
  ]);

  const bottleneckPatterns: Array<[FriendSalesSignal["bottleneck"], RegExp]> = [
    ["traffic", /\b(?:traffic|reach|views|leads|people seeing|audience growth)\b/i],
    ["offer", /\b(?:offer|product|course|pricing|price point)\b/i],
    ["messaging", /\b(?:messaging|content|hook|positioning|what to say)\b/i],
    ["conversion", /\b(?:convert|conversion|closing|close|buyers?|customers?)\b/i],
    ["follow_up", /\b(?:follow[ -]?up|ghost(?:ed|ing)?|no repl(?:y|ies)|dm conversations?)\b/i],
    ["consistency", /\b(?:consistent|consistency|predictable|regular sales)\b/i],
  ];
  const bottleneck = bottleneckPatterns.find(([, pattern]) => pattern.test(latest))?.[0] || "unknown";
  const explicitSalesGoal = Boolean(directGap || desiredSales || firstSale || inconsistent);
  const activeSalesGap = Boolean(
    directGap
    || inconsistent
    || (desiredSales && /\b(?:more|consistent|regular|predictable)\b/i.test(desiredSales))
    || (helpSignal && desiredSales)
  );
  const resultState: FriendSalesSignal["resultState"] = directGap && /\b(?:no|zero|not|never|haven't|have not)\b/i.test(directGap)
    ? "no_sales"
    : inconsistent
      ? "inconsistent_sales"
      : firstSale
        ? "first_sale"
        : desiredSales && /\bmore\b/i.test(desiredSales)
          ? "wants_more_sales"
          : "unknown";

  return {
    explicitSalesGoal,
    activeSalesGap,
    wantsSalesHelp: Boolean(helpSignal && explicitSalesGoal),
    resultState,
    bottleneck,
    evidence: [directGap, desiredSales, helpSignal, firstSale, inconsistent].filter(Boolean),
  };
}

function appendUnique(current: unknown, addition: string): string[] {
  const values = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : [];
  return Array.from(new Set([...values, addition].map((item) => item.trim()).filter(Boolean)));
}

export function applyDeterministicSalesSignals(
  analysis: Record<string, any> | null | undefined,
  latestProspectMessage: string,
  prospectHistory = "",
): Record<string, any> {
  const result = { ...(analysis || {}) };
  const signal = detectFriendSalesSignal(latestProspectMessage, prospectHistory);
  if (!signal.explicitSalesGoal) return result;

  if (signal.resultState !== "unknown" && !known(result.sales_status)) result.sales_status = signal.resultState;
  if (!known(result.tangible_goal)) result.tangible_goal = signal.resultState === "wants_more_sales" ? "make more sales" : "make consistent sales";
  if (!known(result.motivation)) result.motivation = "improve sales results";
  result.evidence = Array.from(new Set([
    ...(Array.isArray(result.evidence) ? result.evidence : []),
    ...signal.evidence.map((item) => `Prospect said: ${item}`),
  ]));

  if (signal.activeSalesGap) {
    result.problem_status = "active";
    result.pain_expressed = true;
    if (!known(result.problem_gap)) result.problem_gap = "current sales results are below the result the prospect wants";
    result.pain_points = appendUnique(result.pain_points, "not getting the sales result they want");
    result.knowledge_need = signal.bottleneck === "unknown"
      ? "sales psychology for diagnosing whether the current bottleneck is traffic, offer, messaging, conversion, follow-up, or consistency"
      : `sales psychology and an applicable framework for the prospect's ${signal.bottleneck.replace("_", " ")} bottleneck`;
    if (!known(result.reply_act) || includesAny(result.reply_act, ["respond_naturally", "observe", "validate"])) {
      result.reply_act = signal.bottleneck === "unknown" ? "probe" : "reframe";
    }
    result.question_needed = signal.bottleneck === "unknown";
    result.next_best_action = signal.bottleneck === "unknown"
      ? "relate briefly, then ask one concrete diagnostic question that separates traffic from conversion"
      : "reflect the diagnosed sales bottleneck and help the prospect see the gap clearly";
  }

  if (signal.wantsSalesHelp) {
    result.readiness = "wants_help";
    const certaintyReady = known(result.tangible_goal)
      && (known(result.why_goal_matters) || known(result.motivation))
      && (known(result.past_experiences) || known(result.previous_attempts))
      && known(result.root_cause)
      && known(result.consequences)
      && (known(result.need_for_change_reason) || result.need_for_change === true)
      && (known(result.inaction_pattern) || known(result.why_not_solved))
      && known(result.detailed_future_outcome);
    if (certaintyReady) {
      result.referral_readiness = "ask_permission";
      result.reply_act = "ask_permission";
      result.question_needed = true;
      result.next_best_action = "recap the complete context, connect the sales gap to approved help, and ask permission to introduce the expert";
    }
  }

  result.sales_conversion_signal = signal;
  return result;
}

export function normalizeFriendStage(value: unknown): FriendStage {
  const stage = normalized(value).replace(/[ -]+/g, "_");
  if (["handoff", "close", "closing", "decision", "accepted_referral", "ready_for_handoff"].includes(stage)) return "handoff";
  if (["pitch", "offer", "solution", "permission", "ask_permission", "referral", "expert_introduction"].includes(stage)) return "pitch";
  if (["emotional_certainty", "emotional", "future_pacing", "visualization", "need_payoff"].includes(stage)) return "emotional_certainty";
  if (["logical_certainty", "logical", "pain", "pain_discovery", "problem", "implication", "desired_result"].includes(stage)) return "logical_certainty";
  return "intent";
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
    tangibleGoal: known(value.tangible_goal) || known(value.desires) || known(value.prospect_dreams),
    whyGoalMatters: known(value.motivation) || known(value.intent) || known(value.why_goal_matters),
    pastExperience: known(value.past_experiences) || known(value.previous_attempts) || known(value.actual_experience),
    activeProblem,
    rootCause: known(value.root_cause) || known(value.doubt_cause),
    consequences: known(value.consequences) || known(value.impact_of_problem),
    needForChange: value.need_for_change === true || known(value.need_for_change_reason) || includesAny(readiness, ["problem_aware", "wants_help", "ask_permission", "accepted_referral", "ready_for_handoff"]),
    inactionPattern: known(value.inaction_pattern) || known(value.why_not_solved),
    detailedFutureOutcome: known(value.detailed_future_outcome) || known(value.future_outcome) || known(value.future_vision),
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

  const intentComplete = evidence.tangibleGoal && evidence.whyGoalMatters && evidence.pastExperience;
  const logicalComplete = intentComplete && evidence.activeProblem && evidence.rootCause && evidence.consequences && evidence.needForChange;
  const emotionalComplete = logicalComplete && evidence.inactionPattern && evidence.detailedFutureOutcome;

  let stage: FriendStage = "intent";
  if (intentComplete) stage = "logical_certainty";
  if (logicalComplete) stage = "emotional_certainty";
  if (emotionalComplete && evidence.wantsHelp) stage = "pitch";
  if (evidence.acceptedHandoff) stage = "handoff";

  // Explicit boundaries are not conversion stages. Keep the truthful stage for
  // reporting, while the reply policy separately requires a respectful stop.
  const missing: string[] = [];
  if (!evidence.tangibleGoal) missing.push("their tangible or overarching goal");
  if (!evidence.whyGoalMatters) missing.push("why that goal matters to them");
  if (!evidence.pastExperience) missing.push("their previous attempts and actual experience");
  if (!evidence.activeProblem) missing.push("an active unresolved problem or gap in their own situation");
  if (!evidence.rootCause) missing.push("their explanation and the likely root cause");
  if (!evidence.consequences) missing.push("the consequences of leaving the problem unresolved");
  if (!evidence.needForChange) missing.push("their own logical recognition that the problem needs to change");
  if (!evidence.inactionPattern) missing.push("the thought pattern behind why they have not solved it");
  if (!evidence.detailedFutureOutcome) missing.push("a detailed, personally meaningful future outcome");
  if (!evidence.wantsHelp) missing.push("permission or explicit interest in help");
  if (!evidence.acceptedHandoff) missing.push("acceptance of the expert introduction or handoff");

  return { stage, evidence, missing };
}

export function friendStageToDatabase(stage: FriendStage): string {
  return stage;
}

export function buildFriendStageDirective(stageResult: ReturnType<typeof deriveEvidenceGatedFriendStage>): string {
  const { stage, evidence, missing } = stageResult;
  const objectives: Record<FriendStage, string> = {
    intent: "Keep the focus on the prospect. Move naturally through surface goal -> why it matters -> previous attempts -> actual experience -> their explanation -> likely root cause. Do not build a pitch from a shallow first answer.",
    logical_certainty: "Use the prospect's own facts to move through goal -> reason -> obstacle -> root cause -> consequences -> unresolved gap -> need for change. Clarify rather than exaggerate. For a sales problem, diagnose traffic, offer, messaging, conversion, follow-up, or consistency.",
    emotional_certainty: "Understand the inaction pattern, reflect it without shame, and help the prospect describe a detailed future outcome if the problem is solved. Build emotional clarity, not fantasy or pressure, then make a permission transition when appropriate.",
    pitch: "Tie together the full conversation: context recap -> confirmed gap -> desired outcome -> relevant approved expert help -> permission. Personalize every point from the prospect's own words and do not introduce unapproved claims.",
    handoff: "After explicit acceptance, provide the approved expert or team destination and one concrete next step. Answer practical objections directly and never manufacture urgency.",
  };
  return `[EVIDENCE-GATED FRIEND CERTAINTY FUNNEL]\nCanonical stage: ${stage}\nStage objective: ${objectives[stage]}\nEvidence: ${JSON.stringify(evidence)}\nStill missing: ${missing.join("; ") || "none"}\nFollow the stages in order and never mark one complete from warmth or message count. Ask only the single most useful question, mix discovery with genuine peer reactions, and preserve everything already learned. A clear refusal exits safely; an explicit request for the expert may proceed directly to handoff.`;
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
    intent: ["intent", "goal", "motivation", "experience", "attempt", "strategy", "why", "sales"],
    logical_certainty: ["logical", "cause", "obstacle", "root", "consequence", "gap", "problem", "sales", "need"],
    emotional_certainty: ["emotional", "inaction", "belief", "fear", "failed", "future", "visualize", "meaning"],
    pitch: ["recap", "transition", "permission", "help", "strategy", "expert", "mentor", "solution"],
    handoff: ["handoff", "objection", "price", "trust", "link", "connect", "contact", "decision"],
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
10. At pitch/handoff, it asks permission before an introduction and gives a concrete approved handoff only after acceptance.
11. When the prospect explicitly says sales are the problem, it must acknowledge that concrete gap and either diagnose the specific sales bottleneck or, if they already asked for help, make the permission-based transition. It must not fall back to generic rapport.
12. It follows the certainty funnel in order: Intent (goal, why, past experience) -> Logical Certainty (obstacle, root cause, consequences, need for change) -> Emotional Certainty (inaction pattern, emotional mirror, detailed future) -> Pitch (full-context recap and permission) -> Handoff. It must not repeatedly ask discovery questions or lose earlier answers.

The three items must pursue the same next objective with different natural wording. Preserve metadata fields, but correct them when the message changed.`;
}

export function deterministicFriendQualityIssues(text: string, stage: FriendStage): string[] {
  const message = String(text || "").trim();
  const issues: string[] = [];
  if (!message) issues.push("empty reply");
  if ((message.match(/\?/g) || []).length > 1) issues.push("more than one question");
  if (/good vibes|if you ever want to chat|what do you think would be possible|amplify that feeling/i.test(message)) issues.push("vague non-progressing language");
  if (stage === "intent" && /expert|mentor|buy|price|link|offer/i.test(message)) issues.push("premature expert transition in intent");
  if (stage === "intent" && /\baudience\b/i.test(message) && /struggl|problem|intimidat|overwhelm/i.test(message)) issues.push("asks about the audience instead of the prospect");
  if ((stage === "logical_certainty" || stage === "emotional_certainty") && /(?:sales?|clients?|customers?)/i.test(message) && /what.*(?:journey|inspire|passionate)|how.*feel/i.test(message)) issues.push("ignores a concrete sales gap for generic rapport");
  return issues;
}
