import { describe, expect, it, vi } from "vitest";
import {
  buildFriendLexicalQuery,
  loadFriendSupportingPassage,
  retrieveFriendLexicalKnowledge,
  selectFriendSourcePassage,
} from "../../supabase/functions/_shared/friend-knowledge-search";
import {
  deterministicFriendQualityIssues,
  prioritizeFriendDirectQuestion,
} from "../../supabase/functions/_shared/friend-conversation-engine";

describe("Friend full-vault keyword retrieval", () => {
  it("searches the diagnosed issue and latest prospect message without an all-words constraint", () => {
    const query = buildFriendLexicalQuery("I get leads but no sales", {
      knowledge_need: "converting interested leads",
    });
    expect(query).toContain("converting");
    expect(query).toContain("sales");
    expect(query).toContain(" OR ");
  });

  it("includes only user-scoped Friend/both uploaded knowledge returned by the full-vault RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [
        { kind: "principle", rank: 0.3, record: { id: "p1", source_id: "video-1", source_type: "video", brain_type: "both", workspace_id: null, principle_name: "Diagnose conversion" } },
        { kind: "passage", rank: 0.2, record: { id: "c1", source_id: "pdf-1", source_type: "pdf", brain_type: "both", workspace_id: null, content: "Ask how leads become customers" } },
        { kind: "principle", rank: 0.5, record: { id: "p2", source_id: "expert-1", source_type: "pdf", brain_type: "expert", workspace_id: null } },
        { kind: "passage", rank: 0.4, record: { id: "c2", source_type: "conversation", brain_type: "both", workspace_id: null } },
        { kind: "passage", rank: 0.4, record: { id: "c3", source_type: "video", brain_type: "both", workspace_id: "workspace-1" } },
      ],
      error: null,
    }));
    const result = await retrieveFriendLexicalKnowledge(
      { rpc }, "user-1", "friend", { "video-1": "both", "pdf-1": "friend", "expert-1": "expert" },
      "I'm getting leads but no sales", { knowledge_need: "conversion" },
    );
    expect(rpc).toHaveBeenCalledWith("search_sales_knowledge", expect.objectContaining({
      p_user_id: "user-1", match_count: 150,
    }));
    expect(result.principles.map((item) => item.id)).toEqual(["p1"]);
    expect(result.chunks.map((item) => item.id)).toEqual(["c1"]);
  });

  it("falls back to the existing retrieval paths if the RPC is unavailable", async () => {
    const result = await retrieveFriendLexicalKnowledge(
      { rpc: async () => ({ data: null, error: { message: "function not found" } }) },
      "user-1", "friend", {}, "price concern",
    );
    expect(result.principles).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  it("never presents an unrelated PDF passage as support for a selected video lesson", () => {
    const passage = selectFriendSourcePassage([
      { id: "pdf-passage", source_id: "pdf-1", chunk_kind: "source_passage", content: "Different book" },
      { id: "video-passage", source_id: "video-1", chunk_kind: "source_passage", content: "Matching transcript" },
    ], "video-1");
    expect(passage?.id).toBe("video-passage");
    expect(selectFriendSourcePassage([
      { id: "pdf-passage", source_id: "pdf-1", chunk_kind: "source_passage", content: "Different book" },
    ], "video-1")).toBeNull();
  });

  it("loads the source passage directly linked to the selected principle", async () => {
    const from = vi.fn((table: string) => {
      const builder: Record<string, any> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = async () => ({ data: [{ knowledge_chunk_id: "linked-passage", source_id: "video-1" }], error: null });
      builder.maybeSingle = async () => ({ data: {
        content: "The exact linked transcript passage", source_id: "video-1", chunk_kind: "source_passage",
      }, error: null });
      return builder;
    });
    const text = await loadFriendSupportingPassage(
      { from }, "user-1", { id: "principle-1", source_id: "video-1" },
      [{ id: "unrelated", source_id: "pdf-1", chunk_kind: "source_passage", content: "Unrelated PDF" }],
    );
    expect(text).toBe("The exact linked transcript passage");
    expect(from).toHaveBeenCalledWith("knowledge_evidence_links");
    expect(from).toHaveBeenCalledWith("knowledge_chunks");
  });

  it("answers a direct commercial question before the funnel checkpoint and does not reject the answer as premature", () => {
    const analysis = prioritizeFriendDirectQuestion(
      { reply_act: "probe", question_needed: true, earliest_missing_checkpoint: "tangible_goal", contact_status: "active" },
      "Is this another course?",
    );
    expect(analysis.reply_act).toBe("answer");
    expect(analysis.question_needed).toBe(false);
    expect(analysis.earliest_missing_checkpoint).toBe("tangible_goal");
    const issues = deterministicFriendQualityIssues(
      "Yes, the offer is a course.", "intent", analysis,
      [{ direction: "inbound", content: "Is this another course?" }],
    );
    expect(issues).not.toContain("premature expert transition in intent");
  });
});
