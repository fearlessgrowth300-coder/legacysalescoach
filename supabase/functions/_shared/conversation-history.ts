export type ConversationTurn = {
  id?: string;
  direction?: string | null;
  content?: string | null;
  created_at?: string | null;
  screenshot_url?: string | null;
  thread_type?: string | null;
};

const normalizeContent = (value: unknown) => String(value || "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const turnKey = (turn: ConversationTurn) =>
  `${String(turn.direction || "unknown").toLowerCase()}:${normalizeContent(turn.content)}`;

const timeValue = (turn: ConversationTurn) => {
  const parsed = Date.parse(String(turn.created_at || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * OCR screenshots and repeated Generate/Use actions can create duplicate rows.
 * Collapse only high-confidence duplicates: adjacent identical turns, repeated
 * turns from the same screenshot, or identical same-speaker turns created
 * within two minutes. Genuine repeats later in a relationship are preserved.
 */
export function deduplicateConversationTurns<T extends ConversationTurn>(turns: T[]): T[] {
  const result: T[] = [];
  const recent = new Map<string, T>();

  for (const turn of turns || []) {
    if (!normalizeContent(turn.content)) continue;
    const key = turnKey(turn);
    const previous = result[result.length - 1];
    const previousTime = previous ? timeValue(previous) : null;
    const currentTime = timeValue(turn);
    const sameAsPrevious = Boolean(
      previous
      && turnKey(previous) === key
      && (previousTime === null || currentTime === null || Math.abs(currentTime - previousTime) <= 120_000),
    );
    const earlier = recent.get(key);
    const sameScreenshot = Boolean(
      earlier?.screenshot_url
      && turn.screenshot_url
      && earlier.screenshot_url === turn.screenshot_url,
    );
    const earlierTime = earlier ? timeValue(earlier) : null;
    const nearDuplicate = Boolean(
      earlier
      && earlierTime !== null
      && currentTime !== null
      && Math.abs(currentTime - earlierTime) <= 120_000,
    );

    if (sameAsPrevious || sameScreenshot || nearDuplicate) continue;
    result.push(turn);
    recent.set(key, turn);
  }

  return result;
}

const speakerLabel = (direction: unknown) => direction === "outbound"
  ? "FRIEND"
  : direction === "inbound"
    ? "PROSPECT"
    : direction === "context"
      ? "NOTE"
      : "UNKNOWN";

export function formatConversationHistory(turns: ConversationTurn[]): string {
  return deduplicateConversationTurns(turns)
    .map((turn) => `${speakerLabel(turn.direction)}: ${String(turn.content || "").trim()}`)
    .join("\n");
}

/**
 * Keeps every unique prospect turn represented in long conversations. The
 * durable profile remains authoritative, while this compact ledger lets the
 * analyzer verify that memory against the entire relationship instead of only
 * seeing the head and tail of a thread.
 */
export function buildProspectEvidenceLedger(
  turns: ConversationTurn[],
  maxLength = 9_000,
): string {
  const inbound = deduplicateConversationTurns(turns)
    .filter((turn) => turn.direction === "inbound")
    .map((turn) => String(turn.content || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!inbound.length) return "No prospect evidence recorded yet.";

  const perTurn = Math.max(48, Math.min(320, Math.floor(maxLength / inbound.length) - 12));
  const lines = inbound.map((content, index) =>
    `${index + 1}. ${content.length > perTurn ? `${content.slice(0, perTurn - 1)}…` : content}`,
  );
  const ledger = lines.join("\n");
  return ledger.length <= maxLength ? ledger : ledger.slice(0, maxLength);
}
