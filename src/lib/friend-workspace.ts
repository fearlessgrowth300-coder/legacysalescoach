export type FriendProfileDraft = Record<string, unknown>;

export const DEFAULT_FRIEND_BEHAVIOR = `Act like a genuine peer, not a formal sales coach.
Start from something specific in the person's profile, post, or latest message.
Build common ground around their real interests, course, family, freedom, work, or digital-marketing journey.
Ask at most one natural question at a time.
Discover motivation, current strategy, problems, frustration, desired result, and objections from their answers.
Reflect their situation back so they feel understood.
Share a short relevant personal story or result only when it is approved in this workspace.
Ask permission before explaining what helped.
Introduce the approved expert or team only after the need and fit are clear.
Handle fear, price, trust, and previous bad experiences with empathy and truthful facts.
Move naturally from friend -> problem awareness -> desire for help -> expert introduction.
Adapt to every answer. Never follow a fixed interrogation script or repeat a question already answered.
Keep replies short, warm, curious, slightly informal, and focused on one useful next move.`;

export type AutomaticFriendSetup = {
  instagram?: {
    username?: string;
    fullName?: string;
    biography?: string;
    profilePicUrl?: string;
    summary?: string;
  };
  courseName?: string;
  courseUrl?: string;
  courseDescription?: string;
  courseExperience?: string;
  courseResults?: string;
  conversationExamples?: string;
  behaviorGuidelines?: string;
  strategyName?: string;
  strategyWebsite?: string;
  strategyDescription?: string;
  expertName?: string;
  expertReference?: string;
  expertWebsite?: string;
  expertHelp?: string;
};

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

export function mergeAutomaticFriendDraft(
  draftValue: unknown,
  setup: AutomaticFriendSetup,
): Record<string, any> {
  const draft = objectValue(draftValue);
  const persona = objectValue(draft.friend_persona || draft.persona);
  const offer = objectValue(draft.offer_truth);
  const instagram = setup.instagram || {};
  const clean = (value: unknown) => String(value || "").trim();
  const expertReference = clean(setup.expertReference) || clean(persona.expert_reference) || "the expert";
  const expertName = clean(setup.expertName) || clean(persona.expert_name);
  const expertHelp = clean(setup.expertHelp) || clean(persona.expert_help);
  const expertWebsite = clean(setup.expertWebsite) || clean(persona.expert_website);
  const expertDescription = [
    expertName ? `${expertReference}: ${expertName}` : "",
    expertHelp,
    expertWebsite ? `Website: ${expertWebsite}` : "",
  ].filter(Boolean).join("\n") || clean(draft.expert_description);

  const mergedPersona = {
    ...persona,
    display_name: clean(instagram.fullName) || clean(persona.display_name) || clean(persona.workspace_name),
    instagram_username: clean(instagram.username) || clean(persona.instagram_username),
    instagram_bio: clean(instagram.biography) || clean(persona.instagram_bio),
    avatar_url: clean(instagram.profilePicUrl) || clean(persona.avatar_url),
    instagram_summary: clean(instagram.summary) || clean(persona.instagram_summary),
    conversation_examples: clean(setup.conversationExamples) || clean(persona.conversation_examples),
    behavior_guidelines: clean(setup.behaviorGuidelines) || clean(persona.behavior_guidelines) || DEFAULT_FRIEND_BEHAVIOR,
    strategy_name: clean(setup.strategyName) || clean(persona.strategy_name),
    strategy_website: clean(setup.strategyWebsite) || clean(persona.strategy_website),
    strategy_description: clean(setup.strategyDescription) || clean(persona.strategy_description),
    expert_name: expertName,
    expert_reference: expertReference,
    expert_website: expertWebsite,
    expert_help: expertHelp,
  };

  const mergedOffer = {
    ...offer,
    name: clean(setup.courseName) || clean(offer.name),
    course_url: clean(setup.courseUrl) || clean(offer.course_url),
    description: clean(setup.courseDescription) || clean(offer.description),
    personal_experience: clean(setup.courseExperience) || clean(offer.personal_experience),
    results_summary: clean(setup.courseResults) || clean(offer.results_summary),
  };

  return {
    ...draft,
    friend_persona: mergedPersona,
    offer_truth: mergedOffer,
    expert_description: expertDescription,
    profile_evidence: clean(draft.profile_evidence) || clean(instagram.summary) || clean(instagram.biography),
    setup_verified_context: {
      course_provided_by_owner: Boolean(clean(setup.courseName) || clean(setup.courseDescription)),
      conversation_examples_provided: Boolean(clean(setup.conversationExamples)),
      strategy_provided_by_owner: Boolean(clean(setup.strategyName) || clean(setup.strategyDescription)),
      expert_provided_by_owner: Boolean(expertName || expertHelp),
    },
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
