import { describe, expect, it } from "vitest";
import {
  buildProspectEvidenceLedger,
  deduplicateConversationTurns,
  formatConversationHistory,
} from "../../supabase/functions/_shared/conversation-history";

describe("conversation history integrity", () => {
  it("collapses adjacent and near-time duplicates but preserves a genuine later repeat", () => {
    const turns = [
      { direction: "inbound", content: "Thanks, same to you", created_at: "2026-08-12T10:00:00Z" },
      { direction: "inbound", content: " Thanks,   same to you ", created_at: "2026-08-12T10:00:10Z" },
      { direction: "outbound", content: "What result is working now?", created_at: "2026-08-12T10:01:00Z" },
      { direction: "inbound", content: "Thanks, same to you", created_at: "2026-08-12T11:00:00Z" },
    ];
    expect(deduplicateConversationTurns(turns)).toHaveLength(3);
    expect(formatConversationHistory(turns).match(/PROSPECT: Thanks, same to you/g)).toHaveLength(2);
  });

  it("keeps every unique inbound turn represented in the evidence ledger", () => {
    const turns = Array.from({ length: 40 }, (_, index) => ({
      direction: index % 2 === 0 ? "inbound" : "outbound",
      content: `Unique relationship fact ${index}`,
      created_at: new Date(2026, 7, 12, 10, index).toISOString(),
    }));
    const ledger = buildProspectEvidenceLedger(turns, 9_000);
    expect(ledger).toContain("Unique relationship fact 0");
    expect(ledger).toContain("Unique relationship fact 38");
    expect(ledger.split("\n")).toHaveLength(20);
  });

  it("preserves an identical message when it is genuinely sent much later", () => {
    expect(deduplicateConversationTurns([
      { direction: "inbound", content: "Hi", created_at: "2026-08-01T10:00:00Z" },
      { direction: "inbound", content: "Hi", created_at: "2026-08-12T10:00:00Z" },
    ])).toHaveLength(2);
  });
});
