export type ConversationMemory = {
  buyer_name?: string;
  relationship?: string;
  business_and_offers?: string[];
  goals?: string[];
  pains_and_constraints?: string[];
  objections_and_fears?: string[];
  commitments_and_payments?: string[];
  personal_context?: string[];
  communication_preferences?: string[];
  important_timeline?: string[];
  strategies_already_tried?: string[];
  unresolved_items?: string[];
  latest_state?: string;
  facts_to_never_forget?: string[];
};

type MemoryMessage = { role?: string; content?: unknown; created_at?: string };

const CONTEXT_STOP_WORDS = new Set("about after again already also because been before could from have into just know more need only over said says that their them then there these they this want what when where which with would your".split(" "));
const MONEY_REQUEST = /\b(?:sell|buy|charge|pay|payment|price|fee|invoice|upsell|deposit|renew|cost)\b/i;
const FINANCIAL_CONSTRAINT = /\b(?:debt|broke|loan|credit card|can't afford|cannot afford|no money|financial|balance transfer|bills?|borrow|struggling to pay)\b/i;
const BOUNDARY = /\b(?:not interested|stop messaging|don't contact|do not contact|leave me alone|no more|not ready|don't want to buy)\b/i;
const TRUST_CONCERN = /\b(?:scam|scammed|don't trust|do not trust|did not trust|doesn't trust|fraud|misled|promised|guaranteed)\b/i;

export type ConversationDecisionEvidence = {
  history: string;
  retrievalFocus: string;
  flags: string[];
  selectedCount: number;
};

export function isUndefinedPaidOfferRequest(request: string): boolean {
  const asksForNewSale = /\b(?:sell something|sell anything|what (?:can|should) i sell|make (?:her|him|them) pay)\b/i.test(request);
  const asksForMoney = /\$\s*\d|\b(?:pay|charge|fee|price|dollars?)\b/i.test(request);
  return asksForNewSale && asksForMoney;
}

/**
 * Re-read the user's own conversation evidence before selecting a sales lesson.
 * Prior assistant proposals are deliberately excluded: a model's earlier guess
 * about a payment, buyer state, or service is not a verified buyer fact.
 */
export function selectConversationDecisionEvidence(
  messages: MemoryMessage[],
  latestRequest: string,
  maxChars = 6200,
): ConversationDecisionEvidence {
  const queryTokens = new Set((clean(latestRequest).toLowerCase().match(/[a-z0-9]{4,}/g) || [])
    .filter((word) => !CONTEXT_STOP_WORDS.has(word)));
  const paymentRequest = MONEY_REQUEST.test(latestRequest);
  const candidates = messages.slice(0, -1).map((message, index) => {
    if (message.role !== "user") return null;
    const body = clean(textOf(message.content)).slice(0, 16000);
    if (!body || body === "[image]") return null;
    const tokens = new Set(body.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
    const overlap = [...queryTokens].filter((word) => tokens.has(word)).length;
    const financial = FINANCIAL_CONSTRAINT.test(body);
    const boundary = BOUNDARY.test(body);
    const trust = TRUST_CONCERN.test(body);
    const recent = index >= messages.length - 14;
    const score = overlap * 3 + (recent ? 3 : 0) +
      (paymentRequest && financial ? 12 : 0) + (boundary ? 10 : 0) +
      (trust ? 6 : 0);
    return { index, body, date: message.created_at || "date unknown", score, financial, boundary, trust };
  }).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  const flags: string[] = [];
  if (paymentRequest && candidates.some((item) => item.financial))
    flags.push("Earlier user-provided conversation context mentions financial constraints. Do not turn that into payment pressure; check the latest status before assuming it remains current.");
  if (candidates.some((item) => item.boundary))
    flags.push("Earlier user-provided context includes a possible refusal or boundary. Check its wording and timing before suggesting another pitch.");
  if (candidates.some((item) => item.trust))
    flags.push("Earlier user-provided context includes a trust concern. Prefer transparent, verifiable information over persuasion claims.");
  if (isUndefinedPaidOfferRequest(latestRequest))
    flags.push("The user requests a new paid sale without defining a verified deliverable. Do not invent a fee or technical necessity; clarify the real optional service, its scope, and price first.");

  const ranked = candidates.sort((a, b) => b.score - a.score || b.index - a.index);
  const chosen = ranked.filter((item) => item.score > 0).slice(0, 12);
  const chronological = chosen.sort((a, b) => a.index - b.index);
  let used = 0;
  const lines: string[] = [];
  for (const item of chronological) {
    const riskMatch = paymentRequest ? FINANCIAL_CONSTRAINT.exec(item.body) : null;
    const relevantMatch = riskMatch || BOUNDARY.exec(item.body) || TRUST_CONCERN.exec(item.body) ||
      [...queryTokens].map((word) => item.body.toLowerCase().indexOf(word)).filter((position) => position >= 0)
        .sort((a, b) => a - b).map((position) => ({ index: position }))[0];
    const start = relevantMatch ? Math.max(0, relevantMatch.index - 180) : 0;
    const excerpt = item.body.slice(start, start + 600);
    const line = `[Earlier user message ${item.index + 1}, ${item.date}] ${start ? "…" : ""}${excerpt}${start + 600 < item.body.length ? "…" : ""}`;
    if (used + line.length > maxChars) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return {
    history: lines.join("\n") || "(no relevant earlier user-provided evidence found)",
    retrievalFocus: flags.length ? flags.join(" ") : "Match the current request to verified conversation context before selecting a framework.",
    flags,
    selectedCount: lines.length,
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => part?.text || (part?.type === "image_url" ? "[image]" : "")).join(" ");
  }
  return "";
}
function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: unknown, limit = 30): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = clean(String(value || ""));
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item.substring(0, 700));
    if (result.length >= limit) break;
  }
  return result;
}

export function normalizeConversationMemory(value: unknown): ConversationMemory {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    buyer_name: clean(String(raw.buyer_name || "")) || undefined,
    relationship: clean(String(raw.relationship || "")) || undefined,
    business_and_offers: uniqueStrings(raw.business_and_offers),
    goals: uniqueStrings(raw.goals),
    pains_and_constraints: uniqueStrings(raw.pains_and_constraints),
    objections_and_fears: uniqueStrings(raw.objections_and_fears),
    commitments_and_payments: uniqueStrings(raw.commitments_and_payments),
    personal_context: uniqueStrings(raw.personal_context),
    communication_preferences: uniqueStrings(raw.communication_preferences),
    important_timeline: uniqueStrings(raw.important_timeline),
    strategies_already_tried: uniqueStrings(raw.strategies_already_tried),
    unresolved_items: uniqueStrings(raw.unresolved_items),
    latest_state: clean(String(raw.latest_state || "")) || undefined,
    facts_to_never_forget: uniqueStrings(raw.facts_to_never_forget, 40),
  };
}

export function hasConversationMemory(memory: ConversationMemory): boolean {
  return Boolean(
    memory.buyer_name || memory.relationship || memory.latest_state ||
    Object.values(memory).some((value) => Array.isArray(value) && value.length > 0),
  );
}

export function renderConversationMemory(memory: ConversationMemory, maxChars = 7000): string {
  if (!hasConversationMemory(memory)) return "(no durable buyer memory yet)";
  const lines: string[] = [];
  const addScalar = (label: string, value?: string) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  const addList = (label: string, values?: string[]) => {
    if (values?.length) lines.push(`${label}:\n${values.map((item) => `- ${item}`).join("\n")}`);
  };
  addScalar("Buyer/client name", memory.buyer_name);
  addScalar("Relationship and engagement history", memory.relationship);
  addList("Business, products and offers", memory.business_and_offers);
  addList("Goals and desired outcomes", memory.goals);
  addList("Pain, gaps and constraints", memory.pains_and_constraints);
  addList("Objections, fears and trust concerns", memory.objections_and_fears);
  addList("Commitments, purchases and payment facts", memory.commitments_and_payments);
  addList("Personal context the user asked this chat to remember", memory.personal_context);
  addList("Communication preferences", memory.communication_preferences);
  addList("Important timeline", memory.important_timeline);
  addList("Strategies and messages already tried", memory.strategies_already_tried);
  addList("Open promises and unresolved items", memory.unresolved_items);
  addScalar("Latest known state", memory.latest_state);
  addList("Facts to never forget", memory.facts_to_never_forget);
  return lines.join("\n").substring(0, maxChars);
}

/**
 * Build a bounded but history-wide transcript for first-time memory backfill.
 * It always keeps the beginning and the latest turns, then samples the middle
 * evenly so a multi-year conversation is not reduced to only its recent tail.
 */
export function buildMemoryTranscript(messages: MemoryMessage[], maxChars = 52000): string {
  if (!messages.length) return "";
  const firstCount = Math.min(24, messages.length);
  const lastCount = Math.min(120, Math.max(0, messages.length - firstCount));
  const chosen = new Set<number>();
  for (let i = 0; i < firstCount; i++) chosen.add(i);
  for (let i = Math.max(firstCount, messages.length - lastCount); i < messages.length; i++) chosen.add(i);

  const middleStart = firstCount;
  const middleEnd = Math.max(middleStart, messages.length - lastCount);
  const middleLength = middleEnd - middleStart;
  const middleSamples = Math.min(100, middleLength);
  if (middleSamples > 0) {
    for (let i = 0; i < middleSamples; i++) {
      chosen.add(middleStart + Math.floor((i * middleLength) / middleSamples));
    }
  }

  const lines: string[] = [];
  let used = 0;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const message = messages[index];
    const role = message.role === "assistant" ? "Assistant" : "User";
    const perMessageLimit = role === "User" ? 650 : 420;
    const body = clean(textOf(message.content)).substring(0, perMessageLimit);
    if (!body) continue;
    const stamp = message.created_at ? ` ${message.created_at}` : "";
    const line = `[${index + 1}/${messages.length}${stamp}] ${role}: ${body}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function splitRequest(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+|\s+(?:and\s+again|also|plus|but\s+also|another\s+thing)\s+/i)
    .map(clean)
    .filter((part) => part.length >= 12);
}

/**
 * Produces several meaningfully different searches for compound questions and
 * short follow-ups. The first query remains the user's exact current request;
 * the others isolate separate needs and bind vague turns back to durable memory.
 */
export function buildFocusedRetrievalQueries(
  latestInput: string,
  recentContext: string,
  durableMemory: string,
  maxQueries = 4,
): string[] {
  const latest = clean(latestInput).substring(0, 1800);
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const query = clean(value).substring(0, 1500);
    const key = query.toLowerCase();
    if (query.length < 8 || seen.has(key) || queries.length >= maxQueries) return;
    seen.add(key);
    queries.push(query);
  };

  add(latest || recentContext);
  for (const part of splitRequest(latest)) add(part);

  const memory = clean(durableMemory).substring(0, 900);
  const recent = clean(recentContext).substring(0, 600);
  if (memory || recent) {
    add(`Known buyer and conversation context: ${memory || "none"}. Recent exchange: ${recent || "none"}. Current request: ${latest || "continue the conversation"}`);
  }

  return queries.length ? queries : ["sales coaching and conversation strategy"];
}
