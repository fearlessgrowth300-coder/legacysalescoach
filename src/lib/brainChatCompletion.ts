export function isBrainChatReplyTruncated({
  receivedDone,
  receivedCompleteReply,
  finishReason,
}: {
  receivedDone: boolean;
  receivedCompleteReply: boolean;
  finishReason?: string | null;
}): boolean {
  // A response can end naturally without sentence punctuation (for example,
  // with a code block or a quoted message). The server sends each validated
  // reply as one complete event, so that signal is stronger than punctuation
  // or a missing trailing [DONE] frame.
  if (finishReason && /^(length|max_tokens|model_context_window_exceeded)$/i.test(finishReason)) return true;
  return !receivedDone && !receivedCompleteReply;
}
