export type FriendProfileDraft = Record<string, unknown>;

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n|\s*[,;|]\s*/)
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

export function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function storyLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/\n\s*---+\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function friendDraftPayload(draftValue: unknown) {
  const draft = objectValue(draftValue);
  const persona = objectValue(draft.friend_persona || draft.persona);
  const offer = objectValue(draft.offer_truth);

  return {
    friend_setup_mode: "auto" as const,
    friend_persona_status: "approved" as const,
    friend_persona: persona,
    audience_description: String(draft.audience_description || persona.audience || "").trim() || null,
    pain_points: stringList(draft.pain_points).join("\n") || null,
    common_objections: stringList(draft.common_objections).join("\n") || null,
    friend_backstory: String(draft.friend_backstory || "").trim() || null,
    transformation: String(draft.transformation || "").trim() || null,
    expert_description: String(draft.expert_description || "").trim() || null,
    referral_triggers: stringList(draft.referral_triggers).join("\n") || null,
    offer_truth: offer,
    approved_stories: storyLines(draft.approved_stories),
    forbidden_claims: stringList(draft.forbidden_claims).join("\n") || null,
    friend_persona_approved_at: new Date().toISOString(),
  };
}
