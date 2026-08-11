import { describe, expect, it } from "vitest";
import {
  buildFocusedRetrievalQueries,
  buildMemoryTranscript,
  normalizeConversationMemory,
  renderConversationMemory,
} from "../../supabase/functions/brain-chat/memory";

describe("AI Chat durable conversation memory", () => {
  it("keeps the beginning, samples the middle, and keeps the latest history", () => {
    const messages = Array.from({ length: 300 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: `message-${index + 1} ${"detail ".repeat(8)}`,
      created_at: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    }));
    const transcript = buildMemoryTranscript(messages);

    expect(transcript).toContain("message-1");
    expect(transcript).toContain("message-149");
    expect(transcript).toContain("message-300");
    expect(transcript.length).toBeLessThanOrEqual(52000);
  });

  it("splits a compound request into focused vault searches", () => {
    const queries = buildFocusedRetrievalQueries(
      "She wants the total price. Also she was scammed before. Another thing, should I follow up today or wait?",
      "She previously agreed to review the SEO plan.",
      "Buyer/client name: Val. Objections: trust after a prior bad experience.",
    );

    expect(queries.length).toBeGreaterThan(1);
    expect(queries.length).toBeLessThanOrEqual(4);
    expect(queries.some((query) => /total price/i.test(query))).toBe(true);
    expect(queries.some((query) => /scammed before/i.test(query))).toBe(true);
  });

  it("binds a vague new turn back to the known buyer", () => {
    const queries = buildFocusedRetrievalQueries(
      "What should I say now?",
      "Val replied after her recovery update.",
      "Buyer/client name: Val. She bought server support and later had surgery.",
    );

    expect(queries.some((query) => /Val/i.test(query) && /server support/i.test(query))).toBe(true);
  });

  it("normalizes and renders evidence-only memory fields", () => {
    const memory = normalizeConversationMemory({
      buyer_name: " Val ",
      goals: ["Launch three courses", "Launch three courses", ""],
      latest_state: "Recovering and not ready for business pressure",
    });
    const rendered = renderConversationMemory(memory);

    expect(memory.goals).toEqual(["Launch three courses"]);
    expect(rendered).toContain("Buyer/client name: Val");
    expect(rendered).toContain("Latest known state: Recovering");
  });
});
