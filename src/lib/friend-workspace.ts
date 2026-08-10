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

export function normalizeFriendProfileDraft(
  draftValue: unknown,
  profileAnalysis?: unknown,
  productsDetected?: unknown,
): Record<string, any> {
  const draft = objectValue(draftValue);
  const fallbackEvidence = String(profileAnalysis || "").trim();
  const detectedProducts = String(productsDetected || "").trim();
  const modernPersona = objectValue(draft.friend_persona || draft.persona);

  if (Object.keys(modernPersona).length > 0 || draft.profile_evidence || draft.audience_description) {
    return {
      ...draft,
      profile_evidence: draft.profile_evidence || fallbackEvidence,
    };
  }

  // Older Cloud deployments return the expert-persona shape. Preserve that
  // useful result as a review-only Friend draft while the Edge Function is
  // being upgraded, instead of rendering a card full of "Not inferred".
  const isLegacyPersona = [
    draft.workspace_name,
    draft.tone,
    draft.audience,
    draft.positioning,
    draft.energy,
    draft.niche_detected,
    draft.framework_summary,
  ].some((value) => String(value || "").trim());

  if (!isLegacyPersona && !fallbackEvidence) return {};

  const voice = [draft.tone, draft.energy]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("; ");
  const safeDetectedOffer = detectedProducts && !/^none detected$/i.test(detectedProducts)
    ? { name: detectedProducts, description: "", personal_experience: "", price: "", who_it_is_for: "", who_it_is_not_for: "", referral_url: "" }
    : {};

  return {
    friend_persona: {
      display_name: String(draft.workspace_name || "").trim(),
      role: String(draft.positioning || "").trim(),
      voice_notes: voice,
      audience: String(draft.audience || draft.audience_type || "").trim(),
    },
    audience_description: String(draft.audience || draft.audience_type || "").trim(),
    pain_points: [],
    common_objections: [],
    friend_backstory: "",
    transformation: "",
    approved_stories: [],
    expert_description: "",
    referral_triggers: [],
    offer_truth: safeDetectedOffer,
    forbidden_claims: [],
    profile_evidence: fallbackEvidence || String(draft.framework_summary || "").trim(),
    confidence_notes: "Legacy profile analysis was converted for review. Verify every field before approval.",
    legacy_profile_shape: true,
  };
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
