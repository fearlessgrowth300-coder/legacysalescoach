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

export type FriendFunnelCheckpoint =
  | "tangible_goal"
  | "why_goal_matters"
  | "past_experience"
  | "commercial_result"
  | "active_problem"
  | "root_cause"
  | "consequences"
  | "need_for_change"
  | "inaction_pattern"
  | "detailed_future_outcome"
  | "permission_for_help"
  | "handoff_acceptance"
  | "complete";

export type FriendSalesSignal = {
  explicitSalesGoal: boolean;
  activeSalesGap: boolean;
  wantsSalesHelp: boolean;
  resultState: "no_sales" | "first_sale" | "inconsistent_sales" | "wants_more_sales" | "unknown";
  bottleneck: "traffic" | "offer" | "messaging" | "conversion" | "follow_up" | "consistency" | "unknown";
  evidence: string[];
};

export type FriendCommercialRealitySignal = {
  commercialContext: boolean;
  confidenceClaim: boolean;
  verifiedCommercialResult: boolean;
  commercialResultEstablished: boolean;
  outcomeUnknown: boolean;
  evidence: string[];
};

export type FriendConversationMessage = {
  direction?: string | null;
  content?: string | null;
};

export type FriendKnowledgeApplicationContract = {
  requested: boolean;
  required: boolean;
  available: boolean;
  checkpoint: FriendFunnelCheckpoint;
  principleName: string;
  sourceName: string;
  lesson: string;
  howToApply: string;
  supportingPassage: string;
  prospectFact: string;
  strategicObjective: string;
};

type FriendKnowledgePrinciple = {
  principle_name?: unknown;
  source_name?: unknown;
  what_i_learned?: unknown;
  how_to_apply?: unknown;
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

function cleanContractText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function knowledgeObjective(checkpoint: FriendFunnelCheckpoint): string {
  const objectives: Record<FriendFunnelCheckpoint, string> = {
    tangible_goal: "Clarify the concrete result the prospect wants without turning the exchange into an interrogation.",
    why_goal_matters: "Connect the stated goal to the prospect's personal reason for wanting it.",
    past_experience: "Understand what the prospect has already tried and what actually happened.",
    commercial_result: "Distinguish attention or directional progress from leads, conversions, and consistent sales.",
    active_problem: "Help the prospect name the specific bottleneck between present activity and the desired result.",
    root_cause: "Help the prospect examine why the bottleneck has remained unresolved instead of accepting a surface explanation.",
    consequences: "Help the prospect articulate the practical cost of leaving the gap unresolved without manufacturing fear.",
    need_for_change: "Help the prospect state in their own words why the present approach must change.",
    inaction_pattern: "Reflect the thought or behavior pattern that has prevented action without shaming the prospect.",
    detailed_future_outcome: "Help the prospect describe a specific, lived future outcome rather than a vague dream.",
    permission_for_help: "Recap the evidenced gap and desired outcome, connect them to relevant approved help, and ask permission.",
    handoff_acceptance: "Provide the approved expert or team destination only after the prospect accepts the introduction.",
    complete: "Respond naturally and preserve the completed handoff or respectful ending.",
  };
  return objectives[checkpoint];
}

/**
 * Locks one retrieved lesson to one evidenced prospect fact and one funnel
 * objective. The generator and validator receive the same contract, preventing
 * a model from citing a famous source in metadata while drafting an unrelated
 * generic message.
 */
export function buildFriendKnowledgeApplicationContract(input: {
  analysis?: Record<string, unknown> | null;
  checkpoint: FriendFunnelCheckpoint;
  stage: FriendStage;
  latestProspectMessage?: string;
  principle?: FriendKnowledgePrinciple | null;
  sourceName?: string;
  supportingPassage?: string;
}): FriendKnowledgeApplicationContract {
  const analysis = input.analysis || {};
  const contactStatus = normalized(analysis.contact_status || "active").replace(/[ -]+/g, "_");
  const replyAct = normalized(analysis.reply_act).replace(/[ -]+/g, "_");
  const knowledgeNeed = normalized(analysis.knowledge_need);
  const salesSignal = analysis.sales_signal && typeof analysis.sales_signal === "object"
    ? analysis.sales_signal as Record<string, unknown>
    : {};
  const strategicAct = ["probe", "reframe", "transition", "ask_permission", "refer"].includes(replyAct);
  const activeSalesGap = salesSignal.activeSalesGap === true
    || includesAny(analysis.sales_status, ["no_sales", "first_sale", "inconsistent_sales", "wants_more_sales"]);
  const requested = contactStatus !== "do_not_contact"
    && contactStatus !== "not_a_fit"
    && input.checkpoint !== "complete"
    && (input.stage !== "intent" || activeSalesGap || strategicAct || (known(knowledgeNeed) && knowledgeNeed !== "none"));

  const principleName = cleanContractText(input.principle?.principle_name, 220);
  const sourceName = cleanContractText(input.sourceName || input.principle?.source_name, 260);
  const lesson = cleanContractText(input.principle?.what_i_learned, 900);
  const howToApply = cleanContractText(input.principle?.how_to_apply, 700);
  const available = Boolean(known(principleName) && known(sourceName) && (known(lesson) || known(howToApply)));
  const evidence = Array.isArray(analysis.evidence)
    ? [...analysis.evidence].reverse().find((item) => known(item))
    : "";
  const prospectFact = cleanContractText(evidence || input.latestProspectMessage, 420);

  return {
    requested,
    required: requested && available,
    available,
    checkpoint: input.checkpoint,
    principleName,
    sourceName,
    lesson,
    howToApply,
    supportingPassage: cleanContractText(input.supportingPassage, 900),
    prospectFact,
    strategicObjective: knowledgeObjective(input.checkpoint),
  };
}

export function formatFriendKnowledgeApplicationContract(contract: FriendKnowledgeApplicationContract): string {
  return `[LOCKED KNOWLEDGE APPLICATION CONTRACT]
Requested: ${contract.requested}
Required: ${contract.required}
Available: ${contract.available}
Checkpoint: ${contract.checkpoint}
Prospect fact to address: ${contract.prospectFact || "none"}
Strategic objective: ${contract.strategicObjective}
Locked principle: ${contract.principleName || "none"}
Locked source: ${contract.sourceName || "none"}
Actual lesson: ${contract.lesson || "none"}
How the source says to apply it: ${contract.howToApply || "none"}
Supporting original passage: ${contract.supportingPassage || "none"}

If Required=true, do not swap, merely name, or decorate the reply with this principle. Use its actual lesson to perform the strategic objective on the stated prospect fact. The ready-to-send text must remain a short natural peer message. In the response metadata, copy one exact phrase from the ready-to-send message as message_evidence and explain how that phrase performs the lesson. If Required=false, do not force a framework.`;
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
    /\b(?:wouldn['’]t|would not|can['’]t|cannot|couldn['’]t|could not|don['’]t|do not)\s+(?:call|say|describe)\s+(?:the\s+|my\s+|our\s+)?sales?\s+(?:as\s+)?consistent\b/i,
    /\bsales?\s+(?:aren['’]t|are not|isn['’]t|is not)\s+(?:yet\s+)?consistent\b/i,
    /\bsales?\s+(?:are|is)\s+(?:only\s+)?starting\s+to\s+happen\b/i,
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

export function detectFriendCommercialReality(
  latestProspectMessage: string,
  prospectHistory = "",
): FriendCommercialRealitySignal {
  const latest = normalized(latestProspectMessage);
  const context = normalized(`${prospectHistory} ${latestProspectMessage}`);
  const commercialContext = /\b(?:sales?|income|revenue|business|offer|funnel|marketing|content|course|product|customers?|clients?|leads?|conversions?|traffic|build(?:ing)?\s+(?:something|my own|a business)|time and income)\b/i.test(context);
  const confidenceEvidence = firstMatch(context, [
    /\b(?:happy with (?:(?:the|my) )?(?:direction|progress)|what(?:'s| is) already working|i know what works|what i know works|nothing (?:is )?holding me back|wouldn['’]t say i feel held back|pretty intentional|going in the right direction|doing (?:really )?well|things? (?:are|is) working)\b/i,
  ]);
  const confidenceClaim = Boolean(confidenceEvidence);
  const resultEvidence = [
    firstMatch(context, [
      /\b(?:made|generated|earned|closed|got)\s+(?:about\s+|over\s+|more than\s+)?(?:[$£€]\s*)?\d[\d,.]*(?:k|m)?\s*(?:in\s+)?(?:sales?|revenue|income|profit|customers?|clients?|orders?)\b/i,
      /\b(?:consistent|predictable|regular)\s+(?:sales?|revenue|income|clients?|customers?|orders?)\b/i,
      /\b(?:sales?|revenue|income|clients?|customers?|orders?)\s+(?:are|is|have been)\s+(?:consistent|predictable|regular)\b/i,
      /\b(?:i|we)\s+(?:make|get|close|generate|bring in)\s+(?:[$£€]\s*)?\d[\d,.]*(?:k|m)?\s*(?:a|per|each)?\s*(?:day|week|month|year)?\b/i,
    ]),
  ].filter(Boolean);
  const negativeResultEvidence = firstMatch(context, [
    /\b(?:wouldn['’]t|would not|can['’]t|cannot|couldn['’]t|could not|don['’]t|do not)\s+(?:call|say|describe)\s+(?:the\s+|my\s+|our\s+)?sales?\s+(?:as\s+)?consistent\b/i,
    /\bsales?\s+(?:aren['’]t|are not|isn['’]t|is not)\s+(?:yet\s+)?consistent\b/i,
    /\b(?:no|zero)\s+sales?\b/i,
    /\b(?:i|we)\s+(?:haven['’]t|have not|can['’]t|cannot)\s+(?:made|get|getting|make|close|closed)\s+(?:a\s+|any\s+)?sales?\b/i,
  ]);
  const verifiedCommercialResult = resultEvidence.length > 0;
  const commercialResultEstablished = verifiedCommercialResult || Boolean(negativeResultEvidence);
  return {
    commercialContext,
    confidenceClaim,
    verifiedCommercialResult,
    commercialResultEstablished,
    outcomeUnknown: commercialContext && confidenceClaim && !commercialResultEstablished,
    evidence: [confidenceEvidence, negativeResultEvidence, ...resultEvidence].filter(Boolean),
  };
}

export function applyDeterministicCommercialRealityCheck(
  analysis: Record<string, any> | null | undefined,
  latestProspectMessage: string,
  prospectHistory = "",
): Record<string, any> {
  const result = { ...(analysis || {}) };
  const signal = detectFriendCommercialReality(latestProspectMessage, prospectHistory);
  const salesStatus = normalized(result.sales_status).replace(/[ -]+/g, "_");
  const explicitGapStatus = ["no_sales", "first_sale", "inconsistent_sales", "wants_more_sales"].includes(salesStatus);
  const inferredSuccessWithoutEvidence = signal.commercialContext
    && !signal.commercialResultEstablished
    && ["already_successful", "successful", "consistent_sales", "profitable", "doing_well"].includes(salesStatus);
  if ((!signal.outcomeUnknown && !inferredSuccessWithoutEvidence) || explicitGapStatus) {
    result.commercial_reality_signal = signal;
    return result;
  }

  result.result_verification_status = "unverified";
  result.sales_status = "unknown";
  if (!includesAny(result.problem_status, ["active"])) result.problem_status = "unclear";
  result.reply_act = "probe";
  result.question_needed = true;
  result.readiness = includesAny(result.readiness, ["wants_help", "accepted_referral"])
    ? result.readiness
    : "exploring";
  result.referral_readiness = "not_ready";
  result.knowledge_need = "commercial-result verification: distinguish content or directional progress from leads, conversions, and consistent sales";
  result.next_best_action = "affirm their confidence, then ask one concrete peer-level question clarifying whether what is working means content growth, leads, or consistent sales";
  result.recommended_move = "spin_problem";
  result.spin_stage = "problem";
  result.discovery_question_type = "commercial result verification";
  result.stage_reason = "The prospect is confident about her direction, but no commercial result has been established; confidence is not evidence of consistent sales.";
  result.signals_detected = appendUnique(result.signals_detected, "commercial_results_unverified");
  result.evidence = appendUnique(result.evidence, `Prospect expressed confidence without a verified commercial result: ${signal.evidence[0] || latestProspectMessage.trim()}`);
  result.commercial_reality_signal = signal;
  return result;
}

export function applyDeterministicSalesSignals(
  analysis: Record<string, any> | null | undefined,
  latestProspectMessage: string,
  prospectHistory = "",
): Record<string, any> {
  const result = { ...(analysis || {}) };
  const signal = detectFriendSalesSignal(latestProspectMessage, prospectHistory);
  if (!signal.explicitSalesGoal) return result;

  if (signal.resultState !== "unknown") {
    // New explicit evidence must correct stale AI memory. In particular, a
    // prospect saying sales are not consistent yet cannot remain labelled as
    // already successful simply because an earlier profile was optimistic.
    result.sales_status = signal.resultState;
    result.result_verification_status = "verified_from_prospect";
    result.segment = signal.resultState === "no_sales"
      ? (known(result.mentor_status) ? "mentor_no_results" : "beginner")
      : signal.resultState === "first_sale"
        ? "first_sale_stuck"
        : "inconsistent_sales";
  }

  const supportEvidence = firstMatch(normalized(`${latestProspectMessage} ${prospectHistory}`), [
    /\b(?:joined|joining|enrolled in|working with|part of)\s+(?:the\s+|a\s+|an\s+)?(?:bootcamp|mentor|coach|coaching program|program|course|team)\b/i,
  ]);
  if (supportEvidence) {
    result.mentor_status = `currently receiving support (${supportEvidence})`;
    if (signal.resultState === "no_sales") result.segment = "mentor_no_results";
  }
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
): { stage: FriendStage; evidence: FriendStageEvidence; missing: string[]; checkpoint: FriendFunnelCheckpoint } {
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

  return { stage, evidence, missing, checkpoint: deriveEarliestMissingFriendCheckpoint(value) };
}

export function friendStageToDatabase(stage: FriendStage): string {
  return stage;
}

export function deriveEarliestMissingFriendCheckpoint(
  analysis: Record<string, unknown> | null | undefined,
): FriendFunnelCheckpoint {
  const value = analysis || {};
  const evidence = collectFriendStageEvidence(value);
  if (!evidence.tangibleGoal) return "tangible_goal";
  if (!evidence.whyGoalMatters) return "why_goal_matters";
  if (!evidence.pastExperience) return "past_experience";

  const salesStatus = normalized(value.sales_status).replace(/[ -]+/g, "_");
  const commercialContext = Boolean((value.commercial_reality_signal as Record<string, unknown> | undefined)?.commercialContext)
    || known(value.sales_status)
    || /\b(?:sales?|income|revenue|business|marketing|offer|product|course|leads?|conversions?)\b/i.test(normalized(`${value.tangible_goal || ""} ${value.current_strategy || ""} ${value.motivation || ""}`));
  const commercialResultKnown = [
    "no_sales", "first_sale", "inconsistent_sales", "wants_more_sales",
    "consistent_sales", "profitable", "verified_success", "already_successful",
  ].includes(salesStatus) && normalized(value.result_verification_status) !== "unverified";
  if (commercialContext && !commercialResultKnown) return "commercial_result";

  if (!evidence.activeProblem) return "active_problem";
  if (!evidence.rootCause) return "root_cause";
  if (!evidence.consequences) return "consequences";
  if (!evidence.needForChange) return "need_for_change";
  if (!evidence.inactionPattern) return "inaction_pattern";
  if (!evidence.detailedFutureOutcome) return "detailed_future_outcome";
  if (!evidence.wantsHelp) return "permission_for_help";
  if (!evidence.acceptedHandoff) return "handoff_acceptance";
  return "complete";
}

export function applyEarliestMissingFriendCheckpoint(
  analysis: Record<string, any> | null | undefined,
): Record<string, any> {
  const result = { ...(analysis || {}) };
  const checkpoint = deriveEarliestMissingFriendCheckpoint(result);
  result.earliest_missing_checkpoint = checkpoint;
  if (checkpoint === "complete") return result;
  if (includesAny(result.contact_status, ["do_not_contact", "not_a_fit"])) return result;

  const actions: Record<Exclude<FriendFunnelCheckpoint, "complete">, string> = {
    tangible_goal: "understand the concrete result they are building toward",
    why_goal_matters: "understand why that result matters personally",
    past_experience: "understand what they have already tried and the result it produced",
    commercial_result: "clarify whether current progress means content growth, leads, conversions, or consistent sales",
    active_problem: "test respectfully whether an unresolved obstacle exists in their own situation",
    root_cause: "understand their explanation of why the obstacle persists",
    consequences: "understand what continuing without solving it costs them",
    need_for_change: "help them state why the current gap needs to change",
    inaction_pattern: "understand the thought pattern behind not solving it yet",
    detailed_future_outcome: "help them describe the concrete lived outcome after solving it",
    permission_for_help: "recap the verified context and ask permission to share the relevant expert help",
    handoff_acceptance: "wait for explicit acceptance before giving the approved handoff destination",
  };
  result.next_best_action = actions[checkpoint];
  result.next_objective = actions[checkpoint];
  result.question_needed = !["permission_for_help", "handoff_acceptance"].includes(checkpoint);
  result.reply_act = checkpoint === "permission_for_help"
    ? "ask_permission"
    : checkpoint === "handoff_acceptance"
      ? "transition"
      : checkpoint === "need_for_change" || checkpoint === "detailed_future_outcome"
        ? "reframe"
        : "probe";
  return result;
}

export function buildFriendStageDirective(stageResult: ReturnType<typeof deriveEvidenceGatedFriendStage>): string {
  const { stage, evidence, missing, checkpoint } = stageResult;
  const objectives: Record<FriendStage, string> = {
    intent: "Keep the focus on the prospect. Move naturally through surface goal -> why it matters -> previous attempts -> actual experience -> their explanation -> likely root cause. Do not build a pitch from a shallow first answer.",
    logical_certainty: "Use the prospect's own facts to move through goal -> reason -> obstacle -> root cause -> consequences -> unresolved gap -> need for change. Clarify rather than exaggerate. For a sales problem, diagnose traffic, offer, messaging, conversion, follow-up, or consistency.",
    emotional_certainty: "Understand the inaction pattern, reflect it without shame, and help the prospect describe a detailed future outcome if the problem is solved. Build emotional clarity, not fantasy or pressure, then make a permission transition when appropriate.",
    pitch: "Tie together the full conversation: context recap -> confirmed gap -> desired outcome -> relevant approved expert help -> permission. Personalize every point from the prospect's own words and do not introduce unapproved claims.",
    handoff: "After explicit acceptance, provide the approved expert or team destination and one concrete next step. Answer practical objections directly and never manufacture urgency.",
  };
  return `[EVIDENCE-GATED FRIEND CERTAINTY FUNNEL]\nCanonical stage: ${stage}\nEarliest incomplete checkpoint: ${checkpoint}\nStage objective: ${objectives[stage]}\nEvidence: ${JSON.stringify(evidence)}\nStill missing: ${missing.join("; ") || "none"}\nAnswer the newest message first, then continue from the earliest incomplete checkpoint without repeating an answered question or sounding like the conversation moved backward. Follow the stages in order and never mark one complete from warmth or message count. Ask only the single most useful question, mix discovery with genuine peer reactions, and preserve everything already learned. A clear refusal exits safely; an explicit request for the expert may proceed directly to handoff.`;
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
13. Confidence, intentionality, "I know what works," and "I'm happy with my direction" are not verified sales outcomes. When result_verification_status=unverified, affirm the confidence and ask one respectful concrete question that distinguishes content/directional progress from leads, conversions, or consistent sales. But "sales are not consistent yet," "I wouldn't call sales consistent," and equivalent negated statements already answer that question: record inconsistent_sales and move to the next unresolved checkpoint.
14. Use earliest_missing_checkpoint as the locked next destination on every new message. Continue from that checkpoint after answering the newest message; never rely on the previously displayed UI stage, skip required evidence, or repeat a field already answered.
15. Every qualified active prospect should eventually receive a permission-based pitch after the certainty checkpoints are complete. Never end with generic encouragement while a material checkpoint remains unknown. Explicit do-not-contact, not-a-fit, or refusal boundaries always override progression.
16. When a LOCKED KNOWLEDGE APPLICATION CONTRACT says Required=true, use that exact principle's actual lesson on the stated prospect fact. Do not substitute a famous framework, merely cite the source, or attach a principle label to a generic question. knowledge_application.message_evidence must be copied exactly from the ready-to-send message and must be the phrase that performs the lesson.

The three items must pursue the same next objective with different natural wording. Preserve metadata fields, but correct them when the message changed.`;
}

type FriendQuestionIntent = Exclude<FriendFunnelCheckpoint, "complete"> | "other";

function friendQuestionIntent(value: unknown): FriendQuestionIntent {
  const text = normalized(value);
  if (!text.includes("?")) return "other";
  if (/\b(?:connect|send|share|give).*(?:expert|team|contact|link|next step)|(?:expert|team|contact|link).*(?:connect|send|share|give)\b/i.test(text)) return "handoff_acceptance";
  if (/\b(?:open to|would it help|would it be helpful|would you like).*(?:hear|share|explain|helped|approach|support)\b/i.test(text)) return "permission_for_help";
  if (/\b(?:day[ -]?to[ -]?day|life|future|become different|make possible|let you do).*(?:solved|reliable|consistent|result|worked)|\bif (?:that|this).*(?:solved|worked|consistent)\b/i.test(text)) return "detailed_future_outcome";
  if (/\b(?:stopped|stopping|gets in the way|hardest to change|not solved|haven['’]t solved|inaction|taken action)\b/i.test(text)) return "inaction_pattern";
  if (/\b(?:important now|needs? to change|different solution|same way is not enough|continuing.*not enough)\b/i.test(text)) return "need_for_change";
  if (/\b(?:costing|cost you|delay|delaying|make harder|affect.*goal|leave.*unsolved|stays? the same)\b/i.test(text)) return "consequences";
  if (/\b(?:really causing|causing that|underneath|root cause|why.*(?:continue|persist|unresolved)|what do you think is really)\b/i.test(text)) return "root_cause";
  if (/\b(?:biggest|main).*(?:obstacle|problem|challenge|gap)|\b(?:least|less).*(?:reliable|predictable|repeatable)|\bwhere.*(?:stuck|breaks? down)|\bwhat part.*(?:hardest|not working|still)\b/i.test(text)) return "active_problem";
  if (/\b(?:content|reach|engagement|leads?|buyer conversations?|sales?|commercially).*(?:working|progress|consistent|steady|producing|showing up)|\b(?:working|progress|producing).*(?:content|reach|engagement|leads?|sales?)\b/i.test(text)) return "commercial_result";
  if (/\b(?:tried|tested|approaches|doing up to now|what have you been doing|result did it produce|how did .* turn out)\b/i.test(text)) return "past_experience";
  if (/\b(?:why|what would).*(?:matter|change for you|personally|everyday life|make possible)\b/i.test(text)) return "why_goal_matters";
  if (/\b(?:concrete result|main result|working toward|want this to create|want .* to produce|result are you|goal are you)\b/i.test(text)) return "tangible_goal";
  return "other";
}

function normalizedQuestionTokens(value: unknown): string[] {
  const stopWords = new Set(["about", "already", "been", "does", "from", "have", "mainly", "most", "much", "right", "that", "their", "there", "they", "this", "what", "when", "where", "which", "with", "would", "your"]);
  return Array.from(new Set((normalized(value).match(/[a-z0-9]+/g) || [])
    .map((word) => ({ steady: "consistent", regular: "consistent", predictable: "consistent", engagement: "reach", conversations: "leads" }[word] || word))
    .filter((word) => word.length > 2 && !stopWords.has(word))));
}

function questionsAreNearDuplicates(first: unknown, second: unknown): boolean {
  const firstIntent = friendQuestionIntent(first);
  const secondIntent = friendQuestionIntent(second);
  if (firstIntent !== "other" && firstIntent === secondIntent) return true;
  const left = normalizedQuestionTokens(first);
  const right = normalizedQuestionTokens(second);
  if (!left.length || !right.length) return false;
  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length) >= 0.68;
}

/**
 * A question counts as answered when an earlier Friend message asked the same
 * checkpoint (even with different wording) and a later Prospect turn replied.
 * This is intentionally deterministic so a model cannot reopen a completed
 * checkpoint simply because the phrasing changed.
 */
export function repeatsAnsweredFriendQuestion(
  candidate: string,
  conversation: FriendConversationMessage[] = [],
): boolean {
  if (!String(candidate || "").includes("?")) return false;
  for (let index = 0; index < conversation.length; index += 1) {
    const turn = conversation[index];
    if (turn.direction !== "outbound" || !questionsAreNearDuplicates(candidate, turn.content)) continue;
    const answered = conversation.slice(index + 1).some((later) =>
      later.direction === "inbound" && Boolean(String(later.content || "").trim())
    );
    if (answered) return true;
  }
  return false;
}

function contractMetadata(candidate: Record<string, unknown>): Record<string, unknown> {
  const raw = candidate.knowledge_application || candidate.knowledgeApplication;
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

function contractValue(metadata: Record<string, unknown>, snake: string, camel: string): string {
  return cleanContractText(metadata[snake] ?? metadata[camel], 1200);
}

/**
 * Deterministic checks for the parts of knowledge application that can be
 * proven without trusting another model: exact locked source/principle,
 * concrete prospect anchoring, and an exact visible phrase identified as the
 * application. Semantic quality is additionally checked by the AI validator.
 */
export function friendKnowledgeApplicationIssues(
  candidate: Record<string, unknown> | null | undefined,
  contract: FriendKnowledgeApplicationContract | null | undefined,
): string[] {
  if (!contract?.required) return [];
  const item = candidate || {};
  const message = cleanContractText(item.message ?? item.text, 4000);
  const metadata = contractMetadata(item);
  const principleName = contractValue(metadata, "principle_name", "principleName")
    || cleanContractText(item.cited_principle_name ?? item.principleUsed, 220);
  const sourceName = contractValue(metadata, "source_name", "sourceName")
    || cleanContractText(item.cited_source_name ?? item.sourceUsed, 260);
  const lessonApplied = contractValue(metadata, "lesson_applied", "lessonApplied");
  const strategicMove = contractValue(metadata, "strategic_move", "strategicMove");
  const messageEvidence = contractValue(metadata, "message_evidence", "messageEvidence");
  const issues: string[] = [];

  if (normalized(principleName) !== normalized(contract.principleName)) issues.push("does not use the locked Knowledge Base principle");
  if (!normalized(sourceName).includes(normalized(contract.sourceName))) issues.push("does not cite the locked Knowledge Base source");
  if (lessonApplied.length < 18) issues.push("does not explain the actual lesson applied");
  if (strategicMove.length < 18) issues.push("does not explain the strategic application");
  if (messageEvidence.length < 4 || !normalized(message).includes(normalized(messageEvidence))) {
    issues.push("knowledge application evidence is not an exact visible phrase from the reply");
  }

  const factTokens = normalizedQuestionTokens(contract.prospectFact).filter((token) => token.length >= 4);
  const messageTokens = new Set(normalizedQuestionTokens(message));
  if (factTokens.length > 0 && !factTokens.some((token) => messageTokens.has(token))) {
    issues.push("reply is not anchored to the locked prospect fact");
  }
  const lessonTokens = normalizedQuestionTokens(`${contract.lesson} ${contract.howToApply}`).filter((token) => token.length >= 4);
  const applicationTokens = new Set(normalizedQuestionTokens(`${lessonApplied} ${strategicMove}`));
  if (lessonTokens.length > 0 && !lessonTokens.some((token) => applicationTokens.has(token))) {
    issues.push("application metadata does not reflect the locked lesson");
  }
  return issues;
}

export function deterministicFriendQualityIssues(
  text: string,
  stage: FriendStage,
  analysis: Record<string, unknown> | null | undefined = undefined,
  conversation: FriendConversationMessage[] = [],
  knowledgeCandidate: Record<string, unknown> | null | undefined = undefined,
  knowledgeContract: FriendKnowledgeApplicationContract | null | undefined = undefined,
): string[] {
  const message = String(text || "").trim();
  const issues: string[] = [];
  if (!message) issues.push("empty reply");
  if ((message.match(/\?/g) || []).length > 1) issues.push("more than one question");
  if (/good vibes|if you ever want to chat|what do you think would be possible|amplify that feeling/i.test(message)) issues.push("vague non-progressing language");
  if (stage === "intent" && /expert|mentor|buy|price|link|offer/i.test(message)) issues.push("premature expert transition in intent");
  if (stage === "intent" && /\baudience\b/i.test(message) && /struggl|problem|intimidat|overwhelm/i.test(message)) issues.push("asks about the audience instead of the prospect");
  if ((stage === "logical_certainty" || stage === "emotional_certainty") && /(?:sales?|clients?|customers?)/i.test(message) && /what.*(?:journey|inspire|passionate)|how.*feel/i.test(message)) issues.push("ignores a concrete sales gap for generic rapport");
  if (repeatsAnsweredFriendQuestion(message, conversation)) issues.push("repeats an answered question");
  if (analysis?.result_verification_status === "unverified") {
    const testsCommercialReality = /\b(?:sales?|leads?|clients?|customers?|buyers?|orders?|income|revenue|conversions?|traffic|content (?:growth|reach)|what (?:is|has been) working)\b/i.test(message) && message.includes("?");
    if (!testsCommercialReality) issues.push("closes or drifts without verifying the prospect's commercial result");
  }
  issues.push(...friendKnowledgeApplicationIssues(knowledgeCandidate, knowledgeContract));
  return issues;
}

function fallbackLeadFromDraft(value: unknown, stage: FriendStage): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  // Keep only the declarative part of the repaired draft. This preserves a
  // useful answer to a direct prospect question, while replacing the weak or
  // off-stage question that caused deterministic validation to fail.
  const safeSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !sentence.includes("?"))
    .filter((sentence) => !/good vibes|if you ever want to chat|what do you think would be possible|amplify that feeling/i.test(sentence))
    .filter((sentence) => stage !== "intent" || !/expert|mentor|buy|price|link|offer/i.test(sentence));
  const firstSentences = safeSentences
    .slice(0, 2)
    .join(" ")
    .trim();
  const candidate = firstSentences.slice(0, 260).replace(/[,:;\-\s]+$/, "").trim();
  if (candidate.length < 12) return "";
  if (/good vibes|if you ever want to chat|what do you think would be possible|amplify that feeling/i.test(candidate)) return "";
  if (stage === "intent" && /expert|mentor|buy|price|link|offer/i.test(candidate)) return "";
  return candidate;
}

/**
 * Last-resort, evidence-gated Friend replies. The AI validator is allowed to
 * repair prose, but a formatting mistake or a missed required checkpoint must
 * never turn a safe suggestion request into an HTTP 500. These messages keep
 * the current stage locked and are deliberately limited to one question.
 */
export function buildDeterministicFriendFallbackMessages(
  drafts: unknown[],
  stage: FriendStage,
  checkpoint: FriendFunnelCheckpoint,
  analysis: Record<string, unknown> | null | undefined,
  latestProspectMessage = "",
  conversation: FriendConversationMessage[] = [],
  knowledgeContract: FriendKnowledgeApplicationContract | null | undefined = undefined,
): string[] {
  const thanks = /\b(?:thanks?|thank you|appreciate|wishing you)\b/i.test(latestProspectMessage);
  const confident = /\b(?:intentional|happy with|know what works|working for me|direction)\b/i.test(latestProspectMessage);
  const salesStatus = normalized(analysis?.sales_status).replace(/[ -]+/g, "_");
  const knowledgeGroundedLeads = knowledgeContract?.required
    ? salesStatus === "inconsistent_sales"
      ? [
        "So sales are starting, but making that result repeatable is still the real gap.",
        "That tells me the direction is working, but consistency has not caught up yet.",
        "You have proof it can work. The missing piece is making sales dependable.",
      ]
      : salesStatus === "first_sale"
        ? [
          "That first sale proves someone will buy. The next gap is making it repeatable.",
          "You have validation now. What is missing is a reliable path to the next sales.",
          "One sale is real proof, but it has not become a consistent system yet.",
        ]
        : salesStatus === "no_sales"
          ? [
            "So the effort is there, but it has not translated into a sale yet.",
            "That makes the gap clearer. You are doing the work without a buyer result yet.",
            "You are not missing effort. The current process just has not produced a sale yet.",
          ]
          : []
    : [];
  const defaultLeads = knowledgeGroundedLeads.length === 3
    ? knowledgeGroundedLeads
    : thanks
    ? [
      "Thank you, I really appreciate that 🤍",
      "That means a lot, thank you 🤍",
      "Same here—it is genuinely nice connecting 🤍",
    ]
    : confident
      ? [
        "I respect how intentional you are about what you are building.",
        "It sounds like you have put real thought into your direction.",
        "I can see why staying focused on what works matters to you.",
      ]
      : [
        "I hear you, and that makes sense.",
        "That is fair, and I appreciate you being honest.",
        "I get what you mean.",
      ];

  const checkpointQuestions: Record<FriendFunnelCheckpoint, string[]> = {
    tangible_goal: [
      "What concrete result are you working toward most right now?",
      "What would you most like what you are building to produce?",
      "What is the main result you want this to create for you?",
    ],
    why_goal_matters: [
      "What would reaching that result change for you personally?",
      "Why does that result matter to you beyond the business itself?",
      "What would achieving it make possible in your everyday life?",
    ],
    past_experience: [
      "What have you tried so far, and what result did it actually produce?",
      "What approaches have you already tested, and how did they turn out?",
      "What have you been doing up to now, and what has the outcome been?",
    ],
    commercial_result: [
      "When you say it is working, has that mainly meant content growth and leads, or is it already producing consistent sales?",
      "Has the progress shown up mostly in reach and engagement, or are you already seeing steady leads and sales from it?",
      "What is working commercially right now—content growth, buyer conversations, or consistent sales?",
    ],
    active_problem: [
      "What feels like the biggest obstacle between what you are doing now and the result you want?",
      "Where does the process still feel less reliable than you want it to be?",
      "What part is creating the biggest gap between your effort and the outcome?",
    ],
    root_cause: [
      "What do you think is really causing that gap to continue?",
      "Why do you think that obstacle has stayed unresolved so far?",
      "What do you believe is underneath that problem?",
    ],
    consequences: [
      "If that stays the same, what does it delay or make harder for you?",
      "What is that unresolved gap costing you right now?",
      "How does leaving that problem unsolved affect the goal you described?",
    ],
    need_for_change: [
      "What makes changing that situation important now?",
      "Why do you feel that gap needs a different solution now?",
      "What tells you continuing the same way is not enough?",
    ],
    inaction_pattern: [
      "What has made it hardest to change that part before now?",
      "What do you think has stopped you from solving it up to this point?",
      "What usually gets in the way when you try to address it?",
    ],
    detailed_future_outcome: [
      "If that were solved, what would your day-to-day life actually look like?",
      "What would become different in your life once that result felt reliable?",
      "If this worked consistently, what would it let you do that you cannot do now?",
    ],
    permission_for_help: [
      "Would you be open to hearing what helped me solve a similar gap?",
      "Would it be helpful if I shared the approach that made the difference for me?",
      "Are you open to me explaining the kind of support that helped me?",
    ],
    handoff_acceptance: [
      "Would you like me to connect you with the expert who helped me?",
      "Do you want me to send you the approved place to speak with the team?",
      "Would you like the direct next step for talking with the expert?",
    ],
    complete: [
      "Would you like me to send the approved next step now?",
      "Are you ready for the direct connection details?",
      "Would you like the expert contact details now?",
    ],
  };

  const commercialQuestions = checkpoint === "past_experience"
    ? [
      "What have you tried so far, and has it been bringing you consistent sales yet?",
      "Which approaches have you already tested, and did they lead to steady leads or sales?",
      "What have you been doing up to now, and has the result been content growth or consistent sales?",
    ]
    : checkpoint === "why_goal_matters"
      ? [
        "What would consistent sales change for you personally?",
        "Why would turning that progress into steady sales matter to you?",
        "What would reliable sales make possible in your everyday life?",
      ]
      : checkpoint === "tangible_goal"
        ? [
          "What result are you working toward most right now—more reach, steady leads, or consistent sales?",
          "What would you most like this to produce—audience growth, buyer conversations, or regular sales?",
          "What commercial result would make you feel this is truly working?",
        ]
        : checkpointQuestions["commercial_result"];

  const requestedQuestions = analysis?.result_verification_status === "unverified"
    ? commercialQuestions
    : checkpointQuestions[checkpoint];
  const unansweredQuestions = requestedQuestions.filter((question) =>
    !repeatsAnsweredFriendQuestion(question, conversation)
  );
  const nextCheckpoint: Record<FriendQuestionIntent, FriendFunnelCheckpoint> = {
    tangible_goal: "why_goal_matters",
    why_goal_matters: "past_experience",
    past_experience: "commercial_result",
    commercial_result: "active_problem",
    active_problem: "root_cause",
    root_cause: "consequences",
    consequences: "need_for_change",
    need_for_change: "inaction_pattern",
    inaction_pattern: "detailed_future_outcome",
    detailed_future_outcome: "permission_for_help",
    permission_for_help: "handoff_acceptance",
    handoff_acceptance: "complete",
    other: checkpoint === "complete" ? "complete" : checkpoint,
  };
  const answeredIntent = friendQuestionIntent(requestedQuestions[0]);
  const recoveryQuestions = checkpointQuestions[nextCheckpoint[answeredIntent]];
  const questions = unansweredQuestions.length > 0 ? unansweredQuestions : recoveryQuestions;

  return [0, 1, 2].map((index) => {
    const draft = drafts[index] as Record<string, unknown> | string | undefined;
    const draftText = typeof draft === "string"
      ? draft
      : String(draft?.message || draft?.text || "");
    const lead = fallbackLeadFromDraft(draftText, stage) || defaultLeads[index];
    const question = questions[index % questions.length];
    const candidate = `${lead} ${question}`.replace(/\s+/g, " ").trim();
    if (deterministicFriendQualityIssues(candidate, stage, analysis, conversation).length === 0) return candidate;
    return `${defaultLeads[index]} ${question}`.replace(/\s+/g, " ").trim();
  });
}
