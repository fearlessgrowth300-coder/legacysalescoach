export type ScreenshotSpeaker = "me" | "them" | "unknown";

export type ScreenshotMessage = {
  speaker: ScreenshotSpeaker;
  text: string;
  timestamp?: string | null;
  status?: string | null;
  reply_to?: string | null;
  alignment?: "left" | "right" | "center" | "unknown" | null;
  order?: number;
};

export const conversationMessageKey = (direction: string, text: string) =>
  `${direction}:${String(text || "").replace(/\s+/g, " ").trim().toLowerCase()}`;

export function removeDuplicateConversationMessages<T extends { direction: string; content: string }>(messages: T[]) {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = conversationMessageKey(message.direction, message.content);
    if (!message.content?.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function orderedScreenshotMessages(messages: ScreenshotMessage[] | null | undefined) {
  return (messages || [])
    .filter((message) => Boolean(message?.text?.trim()))
    .map((message, index) => ({ ...message, order: message.order ?? index + 1 }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function latestScreenshotTurn(messages: ScreenshotMessage[] | null | undefined) {
  const ordered = orderedScreenshotMessages(messages);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}

export function latestProspectScreenshotMessage(messages: ScreenshotMessage[] | null | undefined) {
  return orderedScreenshotMessages(messages)
    .reverse()
    .find((message) => message.speaker === "them")?.text.trim() || "";
}
