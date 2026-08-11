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
    const current = cleanText(next[key], "", maxLength);
    return current || cleanText(prior[key], fallback, maxLength);
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
