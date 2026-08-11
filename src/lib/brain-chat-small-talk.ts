export function isSimpleBrainChatGreeting(text: string, hasImage = false): boolean {
  if (hasImage) return false;
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 80) return false;
  return /^(?:hi|hii+|hello|hey|hey there|hello there|good morning|good afternoon|good evening|how are you|how's it going|whats up|what's up|thanks|thank you|okay|ok)$/.test(normalized);
}

export function simpleBrainChatGreetingResponse(text: string): string {
  const normalized = text.toLowerCase().trim();
  if (/thank/.test(normalized)) return "You’re welcome. What would you like help with next?";
  if (/how are you|how's it going|what'?s up/.test(normalized)) {
    return "I’m ready to help. What are we working on today?";
  }
  if (/^(?:ok|okay)\b/.test(normalized)) return "Got it. What would you like to do next?";
  return "Hey! What would you like help with today? You can ask a sales question, paste a buyer conversation, or upload a screenshot.";
}
