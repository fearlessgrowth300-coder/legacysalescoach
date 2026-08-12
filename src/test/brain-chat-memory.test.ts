import { describe, expect, it } from "vitest";
import {
  buildFocusedRetrievalQueries,
  buildMemoryTranscript,
  normalizeConversationMemory,
  renderConversationMemory,
} from "../../supabase/functions/brain-chat/memory";
import { selectBalancedSupportingChunks } from "../../supabase/functions/_shared/brain-pipeline";

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

  it("keeps original source passages represented alongside summaries", () => {
    const chunks = [
      { id: "s1", source_id: "a", source_title: "Book A", content: "summary", category: "general", source_type: "core_knowledge", chunk_kind: "principle_summary", similarity: 0.7 },
      { id: "p1", source_id: "a", source_title: "Book A", content: "original A", category: "source_evidence", source_type: "pdf", chunk_kind: "source_passage", similarity: 0.66 },
      { id: "p2", source_id: "b", source_title: "Book B", content: "original B", category: "source_evidence", source_type: "video", chunk_kind: "source_passage", similarity: 0.64 },
      { id: "s2", source_id: "b", source_title: "Book B", content: "summary B", category: "general", source_type: "core_knowledge", chunk_kind: "principle_summary", similarity: 0.63 },
    ];
    const selected = selectBalancedSupportingChunks(chunks, 4);
    expect(selected.filter((chunk) => chunk.chunk_kind === "source_passage")).toHaveLength(2);
    expect(new Set(selected.map((chunk) => chunk.source_id)).size).toBe(2);
  });
});
