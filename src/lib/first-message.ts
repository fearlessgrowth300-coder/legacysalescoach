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

export function needsFirstMessageRepair(value: unknown): boolean {
  const suggestions = parseSavedFirstMessages(value);
  if (suggestions.length === 0) return false;
  return suggestions.some((suggestion) => CERTAINTY_FALLBACK_PATTERN.test([
    suggestion?.text,
    suggestion?.whyThisWorks,
    suggestion?.frameworkUsed,
  ].filter(Boolean).join(" ")));
}

