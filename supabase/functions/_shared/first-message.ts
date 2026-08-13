const FIRST_MESSAGE_STOP_TERMS = new Set([
  "about", "after", "also", "and", "are", "bio", "business", "category", "content", "digital",
  "for", "from", "have", "instagram", "into", "marketing", "page", "post", "profile", "that",
  "the", "their", "this", "with", "your",
]);

function cleanObservation(value: unknown): string {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:followers?|following|posts?)\s*:\s*[\d,.kKmM]+/gi, "")
    .replace(/\s*\|\s*/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|.-]+|[\s:|.-]+$/g, "")
    .trim();
}

export function extractFirstMessageProfileEvidence(prospect: any, profileText = ""): string {
  const bioMatch = profileText.match(/\bBio:\s*([\s\S]*?)(?=\s+(?:Followers?|Category|Posts?):|$)/i);
  const candidates = [
    prospect?.detected_interests,
    bioMatch?.[1],
    prospect?.target_video_caption,
  ];
  for (const candidate of candidates) {
    const cleaned = cleanObservation(candidate);
    if (cleaned.length >= 12) return cleaned.slice(0, 180);
  }
  return "what you are building";
}

function meaningfulTerms(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((term) => term.length >= 4 && !FIRST_MESSAGE_STOP_TERMS.has(term));
}

export function isProfileGroundedFirstMessage(text: unknown, evidence: string): boolean {
  const message = String(text || "").trim();
  if (!message || message.length > 500 || (message.match(/\?/g) || []).length > 1) return false;
  const evidenceTerms = new Set(meaningfulTerms(evidence));
  if (evidenceTerms.size === 0) return true;
  return meaningfulTerms(message).some((term) => evidenceTerms.has(term));
}

export function buildProfileGroundedFirstMessages(prospect: any, profileText = "") {
  const name = String(prospect?.name || "there").trim().split(/\s+/)[0] || "there";
  const observation = extractFirstMessageProfileEvidence(prospect, profileText);
  return [
    {
      id: 1,
      type: "primary",
      text: `Hey ${name}, the part of your page about ${observation} caught my attention. What made you decide to build around that?`,
      whyThisWorks: "Opens from a real profile detail and asks for the story behind it without introducing a pitch.",
      frameworkUsed: "Specific Observation + Story Opener",
      sourceUsed: "Instagram profile",
      principleUsed: "profile-grounded curiosity",
    },
    {
      id: 2,
      type: "alternative",
      text: `Random question, ${name}—was ${observation} something you were already passionate about, or did your own experience lead you there?`,
      whyThisWorks: "Shows the profile was actually read and gives an easy, personal choice to respond to.",
      frameworkUsed: "Identity Validation + Easy Choice",
      sourceUsed: "Instagram profile",
      principleUsed: "identity-based opener",
    },
    {
      id: 3,
      type: "softer",
      text: `I noticed ${observation} on your page and it felt really specific. What's the story behind it?`,
      whyThisWorks: "Uses low-pressure curiosity tied to a concrete profile detail.",
      frameworkUsed: "Observation + Open Loop",
      sourceUsed: "Instagram profile",
      principleUsed: "low-pressure curiosity",
    },
  ];
}

