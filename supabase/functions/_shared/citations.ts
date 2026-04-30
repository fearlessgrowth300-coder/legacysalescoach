// Validates [[cite:<uuid>]] tokens in streamed model output.
// We only validate offline (post-stream) to log issues; we do NOT rewrite the
// stream because that would defeat token-by-token rendering. The client maps
// IDs to numbered chips.

const CITE_RE = /\[\[cite:([0-9a-f-]{8,})\]\]/gi;

export function extractCitedIds(text: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(text)) !== null) ids.add(m[1].toLowerCase());
  return [...ids];
}

export function validateCitations(text: string, allowedIds: string[]): {
  total: number; valid: number; invalid: string[];
} {
  const allowed = new Set(allowedIds.map((id) => id.toLowerCase()));
  const cited = extractCitedIds(text);
  const invalid = cited.filter((id) => !allowed.has(id));
  return { total: cited.length, valid: cited.length - invalid.length, invalid };
}
