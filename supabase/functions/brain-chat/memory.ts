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
