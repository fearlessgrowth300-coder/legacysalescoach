const FIRST_MESSAGE_STOP_TERMS = new Set([
  "about", "after", "also", "and", "are", "bio", "business", "category", "content", "digital",
  "for", "from", "have", "instagram", "into", "marketing", "page", "post", "profile", "that",
  "the", "their", "this", "with", "your",
]);

function cleanObservation(value: unknown): string {
  return String(value || "")
    .replace(/^\s*(?:target\s+(?:video|post)|instagram\s+(?:post|reel))(?:\s*caption)?\s*[:-]?\s*/i, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/(?:followers?|following|posts?)\s*:\s*[\d,.kKmM]+/gi, "")
    .replace(/\s*\([\d,.kKmM]+\s+likes?(?:,\s*[\d,.kKmM]+\s+comments?)?\)\s*$/i, "")
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, "")
    .replace(/\s*\|\s*/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|.-]+|[\s:|.-]+$/g, "")
    .trim();
}

type FirstMessageEvidence = { kind: "post" | "bio" | "fallback"; text: string };

function extractRecentPostFromProfileText(profileText: string): string {
  const postLine = profileText.match(/(?:^|\n)\s*(?:Post\s*)?1\s*[:.)-]\s*["“]?([^\n"]{12,})/i);
  return cleanObservation(postLine?.[1]);
}

function resolveFirstMessageEvidence(prospect: any, profileText = ""): FirstMessageEvidence {
  const postCandidates = [
    prospect?.target_video_caption,
    extractRecentPostFromProfileText(profileText),
  ];
  for (const candidate of postCandidates) {
    const cleaned = cleanObservation(candidate);
    if (cleaned.length >= 12) return { kind: "post", text: cleaned.slice(0, 180) };
  }

  const bioMatch = profileText.match(/\bBio:\s*([\s\S]*?)(?=\s+(?:Followers?|Category|Posts?):|$)/i);
  for (const candidate of [prospect?.detected_interests, bioMatch?.[1]]) {
    const cleaned = cleanObservation(candidate);
    if (cleaned.length >= 12) return { kind: "bio", text: cleaned.slice(0, 180) };
  }
  return { kind: "fallback", text: "what you are building" };
}

export function extractFirstMessageProfileEvidence(prospect: any, profileText = ""): string {
  return resolveFirstMessageEvidence(prospect, profileText).text;
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
  const evidence = resolveFirstMessageEvidence(prospect, profileText);
  const observation = evidence.text;
  if (evidence.kind === "post") {
    return [
      {
        id: 1,
        type: "primary",
        text: `Hey ${name}, I saw your post about ${observation} and it made me curious—what made you share that?`,
        whyThisWorks: "References a real recent post and asks for the personal thought behind it without introducing a pitch.",
        frameworkUsed: "Specific Post Observation + Story Opener",
        sourceUsed: "Instagram post",
        principleUsed: "post-grounded curiosity",
      },
      {
        id: 2,
        type: "alternative",
        text: `Hey ${name}, your post about ${observation} stopped me for a second. Was that something you learned from your own experience?`,
        whyThisWorks: "Shows the post was actually read and gives them an easy way to share a genuine experience.",
        frameworkUsed: "Post Detail + Experience Question",
        sourceUsed: "Instagram post",
        principleUsed: "identity-based opener",
      },
      {
        id: 3,
        type: "softer",
        text: `I just saw your post about ${observation}. What was behind that one?`,
        whyThisWorks: "Uses a low-pressure question tied to a concrete recent post.",
        frameworkUsed: "Post Observation + Open Loop",
        sourceUsed: "Instagram post",
        principleUsed: "low-pressure curiosity",
      },
    ];
  }
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
