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
