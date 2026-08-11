export type FriendContactStatus = "active" | "not_now" | "do_not_contact" | "not_a_fit";

export type FriendProspectProfile = {
  segment: string;
  experience_level: string;
  sales_status: string;
  mentor_status: string;
  current_strategy: string;
  interests: string[];
  desires: string[];
  pain_points: string[];
  objections: string[];
  motivation: string;
  intent: string;
  tangible_goal: string;
  problem_gap: string;
  doubt_cause: string;
  certainty_gap: string;
  reply_act: string;
  question_needed: boolean;
  knowledge_need: string;
  readiness: string;
  contact_status: FriendContactStatus;
  next_best_action: string;
  confidence: number;
  evidence: string[];
  updated_at: string;
};

const CONTACT_STATUSES = new Set<FriendContactStatus>([
  "active",
  "not_now",
  "do_not_contact",
  "not_a_fit",
]);

function cleanText(value: unknown, fallback = "unknown", maxLength = 500): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
}

function informativeText(value: unknown, maxLength = 500): string {
  const cleaned = cleanText(value, "", maxLength);
  return /^(unknown|none|not inferred|not provided|n\/a)$/i.test(cleaned) ? "" : cleaned;
}

function cleanList(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = cleanText(item, "", 180);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function mergeLists(previous: unknown, current: unknown, maxItems = 12): string[] {
  return cleanList([...(Array.isArray(current) ? current : []), ...(Array.isArray(previous) ? previous : [])], maxItems);
}

function contactStatus(value: unknown, previous: unknown): FriendContactStatus {
  const next = cleanText(value, "", 40).toLowerCase().replace(/[ -]+/g, "_") as FriendContactStatus;
  if (CONTACT_STATUSES.has(next)) return next;
  const prior = cleanText(previous, "active", 40).toLowerCase().replace(/[ -]+/g, "_") as FriendContactStatus;
  return CONTACT_STATUSES.has(prior) ? prior : "active";
}

export function buildFriendProspectProfile(
  analysis: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined = {},
  now = new Date().toISOString(),
): FriendProspectProfile {
  const next = analysis || {};
  const prior = previous || {};
  const choose = (key: string, fallback = "unknown", maxLength = 500) => {
    const current = informativeText(next[key], maxLength);
    return current || informativeText(prior[key], maxLength) || fallback;
  };
  const confidenceValue = Number(next.learning_confidence ?? next.confidence ?? prior.confidence ?? 0);

  return {
    segment: choose("segment", cleanText(next.prospectType ?? prior.segment, "unknown", 120), 120),
    experience_level: choose("experience_level", "unknown", 100),
    sales_status: choose("sales_status", "unknown", 140),
    mentor_status: choose("mentor_status", "unknown", 140),
    current_strategy: choose("current_strategy", "unknown", 300),
    interests: mergeLists(prior.interests, next.interests),
    desires: mergeLists(prior.desires, next.desires ?? next.prospect_dreams),
    pain_points: mergeLists(prior.pain_points, next.pain_points),
    objections: mergeLists(prior.objections, next.objections ?? (next.objection_detected ? [next.objection_detected] : [])),
    motivation: choose("motivation", "unknown", 300),
    intent: choose("intent", "unknown", 300),
    tangible_goal: choose("tangible_goal", "unknown", 300),
    problem_gap: choose("problem_gap", "unknown", 400),
    doubt_cause: choose("doubt_cause", "unknown", 300),
    certainty_gap: choose("certainty_gap", "unknown", 300),
    reply_act: choose("reply_act", "respond naturally", 100),
    question_needed: typeof next.question_needed === "boolean" ? next.question_needed : Boolean(prior.question_needed),
    knowledge_need: choose("knowledge_need", "none", 300),
    readiness: choose("readiness", cleanText(next.referral_readiness ?? prior.readiness, "not_ready", 100), 100),
    contact_status: contactStatus(next.contact_status, prior.contact_status),
    next_best_action: choose("next_best_action", cleanText(next.next_objective ?? prior.next_best_action, "continue discovery", 300), 300),
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(100, Math.round(confidenceValue))) : 0,
    evidence: mergeLists(prior.evidence, next.evidence, 16),
    updated_at: now,
  };
}

export function buildFriendLearningContext(
  profile: Record<string, unknown> | null | undefined,
  audienceSignals: Array<Record<string, unknown>> = [],
): string {
  const p = profile || {};
  const profileLines = [
    `Segment: ${cleanText(p.segment)}`,
    `Experience: ${cleanText(p.experience_level)}`,
    `Sales status: ${cleanText(p.sales_status)}`,
    `Mentor/support status: ${cleanText(p.mentor_status)}`,
    `Current strategy: ${cleanText(p.current_strategy)}`,
    `Interests: ${cleanList(p.interests).join(", ") || "unknown"}`,
    `Desires: ${cleanList(p.desires).join(", ") || "unknown"}`,
    `Pain points: ${cleanList(p.pain_points).join(", ") || "unknown"}`,
    `Objections: ${cleanList(p.objections).join(", ") || "none observed"}`,
    `Motivation: ${cleanText(p.motivation)}`,
    `Intent: ${cleanText(p.intent)}`,
    `Tangible goal: ${cleanText(p.tangible_goal)}`,
    `Problem/gap: ${cleanText(p.problem_gap)}`,
    `Doubt cause: ${cleanText(p.doubt_cause)}`,
    `Certainty gap: ${cleanText(p.certainty_gap)}`,
    `Recommended reply act: ${cleanText(p.reply_act, "respond naturally")}`,
    `Question needed: ${Boolean(p.question_needed)}`,
    `Knowledge need: ${cleanText(p.knowledge_need, "none")}`,
    `Readiness: ${cleanText(p.readiness, "not_ready")}`,
    `Contact boundary: ${contactStatus(p.contact_status, "active")}`,
    `Next best action: ${cleanText(p.next_best_action, "continue discovery")}`,
  ];

  const scoredSignals: Array<Record<string, unknown> & { score: number }> = audienceSignals
    .map((signal) => ({
      ...signal,
      score: Number(signal.observation_count || 0)
        + Number(signal.positive_feedback_count || 0) * 3
        + Number(signal.win_count || 0) * 8
        - Number(signal.loss_count || 0) * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  const signalLines = scoredSignals.length
    ? scoredSignals.map((signal) =>
        `- ${cleanText(signal.signal_type, "signal", 50)}=${cleanText(signal.signal_key, "unknown", 120)} `
        + `(observed ${Number(signal.observation_count || 0)}, approved ${Number(signal.positive_feedback_count || 0)}, wins ${Number(signal.win_count || 0)}, losses ${Number(signal.loss_count || 0)})`
      )
    : ["- No cross-conversation audience signals yet."];

  return `[CURRENT PROSPECT MEMORY — facts stay with this prospect]\n${profileLines.join("\n")}\n\n`
    + `[ANONYMIZED WORKSPACE AUDIENCE SIGNALS — patterns, not personal facts]\n${signalLines.join("\n")}`;
}

export function isFriendConversation(threadType: unknown): boolean {
  return threadType !== "expert";
}

export function buildFriendDecisionSearchQuery(
  analysis: Record<string, unknown> | null | undefined,
  latestMessage: string,
  previousProfile: Record<string, unknown> | null | undefined = {},
  maxLength = 3600,
): string {
  const current = analysis || {};
  const previous = previousProfile || {};
  const list = (key: string) => mergeLists(previous[key], current[key], 8).join(", ") || "unknown";
  const value = (key: string, fallback = "unknown") =>
    informativeText(current[key], 420) || informativeText(previous[key], 420) || fallback;
  const query = [
    `Latest prospect message: ${cleanText(latestMessage, "none", 900)}`,
    `Intent: ${value("intent")}`,
    `Tangible desired result: ${value("tangible_goal", value("motivation"))}`,
    `Experience level: ${value("experience_level")}`,
    `Sales status: ${value("sales_status")}`,
    `Mentor or support status: ${value("mentor_status")}`,
    `Current strategy: ${value("current_strategy")}`,
    `Problem and gap: ${value("problem_gap", list("pain_points"))}`,
    `Doubt cause: ${value("doubt_cause")}`,
    `Missing logical certainty: ${value("certainty_gap")}`,
    `Objections: ${list("objections")}`,
    `Readiness: ${value("readiness", value("referral_readiness", "not_ready"))}`,
    `Conversation stage: ${value("stage", value("questioningPattern", "unknown"))}`,
    `Best conversational act: ${value("reply_act", value("recommended_move", "respond naturally"))}`,
    `Knowledge needed: ${value("knowledge_need", "none or one relevant principle")}`,
    `Contact boundary: ${value("contact_status", "active")}`,
  ].join("\n");
  return query.length <= maxLength ? query : query.slice(0, maxLength);
}
