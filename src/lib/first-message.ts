const CERTAINTY_FALLBACK_PATTERN = /(?:concrete result.*working toward|what would you most like what you are building to produce|main result you want this to create|earliest unverified checkpoint|evidence-gated certainty funnel)/i;

export function parseSavedFirstMessages(value: unknown): any[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ id: 1, type: "first_dm", text: value }];
  }
}

function meaningfulTerms(value: string): string[] {
  const stop = new Set(["about", "after", "from", "have", "instagram", "post", "reel", "that", "their", "this", "with", "your"]);
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((term) => term.length >= 4 && !stop.has(term));
}

export function needsFirstMessageRepair(value: unknown, requiredPostEvidence = ""): boolean {
  const suggestions = parseSavedFirstMessages(value);
  if (suggestions.length === 0) return false;
  if (suggestions.some((suggestion) => CERTAINTY_FALLBACK_PATTERN.test([
    suggestion?.text,
    suggestion?.whyThisWorks,
    suggestion?.frameworkUsed,
  ].filter(Boolean).join(" ")))) return true;

  const evidenceTerms = new Set(meaningfulTerms(requiredPostEvidence));
  if (evidenceTerms.size === 0) return false;
  return suggestions.some((suggestion) => {
    const text = String(suggestion?.text || "");
    const mentionsPost = /\b(?:post|reel|saw)\b/i.test(text);
    const overlapsPost = meaningfulTerms(text).some((term) => evidenceTerms.has(term));
    return !mentionsPost || !overlapsPost;
  });
}
