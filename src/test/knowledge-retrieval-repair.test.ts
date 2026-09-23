import { describe, expect, it, vi } from "vitest";
import { requestedSourceTitles, runPipelineFast, type Principle, type SelectedPrinciple } from "../../supabase/functions/_shared/brain-pipeline";
import { buildBrainEvidencePack } from "../../supabase/functions/brain-chat/evidence";
import { buildBrainRetrievalMeta } from "../../supabase/functions/brain-chat/lib";

vi.mock("../../supabase/functions/_shared/embeddings.ts", () => ({ generateEmbedding: vi.fn(async () => [1, 0, 0]) }));

const principle = (id: string): Principle => ({ id, principle_name: "Diagnose trust before offering proof",
  source_id: id, source_name: `Book ${id}`, source_type: "pdf", category: "trust",
  what_i_learned: "Understand the concern before making a claim.", how_to_apply: "Ask what remains uncertain." });

function database(missingVectorRpc = false) {
  const p = principle("older-unembedded-source");
  const rpc = vi.fn(async (name: string) => {
    if (name === "search_sales_knowledge") return { data: [{ kind: "principle", record: p }], error: null };
    if (missingVectorRpc) return { data: null, error: { message: "Function not found" } };
    return { data: name === "match_sales_brain" ? [{ ...principle("semantic"), similarity: 0.8 }] : [], error: null };
  });
  const from = vi.fn((_table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query, in: () => query,
      order: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [] }).then(resolve),
    };
    return query;
  });
  return { rpc, from };
}

describe("retrieval repair", () => {
  it("recognizes a named uploaded source despite punctuation differences", () => {
    const sources = [{ id: "training", title: "32 Minutes of Advanced 1-on-1 Sales Training" }];
    expect(requestedSourceTitles("What does 32 Minutes of Advanced 1 on 1 Sales Training teach?", sources)).toEqual(sources);
  });

  it("prioritizes the named source's principles and original passages over generic keyword hits", async () => {
    const named = { ...principle("named"), source_id: "training", source_name: "32 Minutes of Advanced 1-on-1 Sales Training",
      source_type: "video", principle_name: "Ask discovery questions before presenting an offer" };
    const generic = { ...principle("generic"), source_id: "other", source_name: "Other Sales Book" };
    const db = {
      rpc: vi.fn(async () => ({ data: [{ kind: "principle", record: generic }], error: null })),
      from: vi.fn((table: string) => {
        const query = {
          select: () => query, eq: () => query, is: () => query, in: () => query,
          order: () => query, limit: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({
            data: table === "knowledge_base_items" ? [{ id: "training", title: named.source_name }]
              : table === "sales_brain" ? [named]
                : [{ id: "passage", source_id: "training", source_type: "video", category: "discovery",
                  content: "Ask what the prospect has tried and what outcome they want before recommending a solution.",
                  chunk_kind: "source_passage", relevance_score: 80 }],
            error: null,
          }).then(resolve),
        };
        return query;
      }),
    };
    const result = await runPipelineFast({ supabaseAdmin: db, userId: "owner", skipEmbedding: true,
      question: "Latest request and old memory: generic trust concerns",
      embedQuery: "What does 32 Minutes of Advanced 1-on-1 Sales Training teach about discovery questions?",
      session: { recent_exchanges: [], active_principle_ids: [], active_framework_name: null } });
    expect(result.selected[0].source_id).toBe("training");
    expect(result.supporting_chunks.some((chunk) => chunk.source_id === "training")).toBe(true);
    expect(result.debug.requested_source_titles).toEqual([named.source_name]);
    expect(buildBrainRetrievalMeta(result).staticMatches).toBeGreaterThan(0);
  });

  it("uses a vault-wide keyword RPC for unembedded records and reports missing vector functions", async () => {
    const db = database(true);
    const result = await runPipelineFast({ supabaseAdmin: db, userId: "owner", question: "Help me diagnose trust concerns",
      session: { recent_exchanges: [], active_principle_ids: [], active_framework_name: null } });
    expect(result.selected.map(p => p.id)).toContain("older-unembedded-source");
    expect(result.debug.embedding_used).toBe(false);
    expect(result.debug.retrieval_errors).toHaveLength(2);
    expect(db.rpc).toHaveBeenCalledWith("search_sales_knowledge", expect.objectContaining({ p_user_id: "owner" }));
    expect(db.from.mock.calls.every(call => call[0] !== "sales_brain")).toBe(true);
  });

  it("combines semantic and unembedded keyword candidates without mislabelling the fallback", async () => {
    const result = await runPipelineFast({ supabaseAdmin: database(), userId: "owner", question: "Help me diagnose trust concerns",
      session: { recent_exchanges: [], active_principle_ids: [], active_framework_name: null } });
    expect(result.selected.map(p => p.id)).toEqual(expect.arrayContaining(["semantic", "older-unembedded-source"]));
    expect(result.debug).toMatchObject({ embedding_used: true, semantic_principles_count: 1, static_principles_count: 1 });
  });

  it("only advertises evidence actually included in the bounded prompt", () => {
    const selected: SelectedPrinciple[] = Array.from({ length: 24 }, (_, i) => {
      const p = { ...principle(String(i)), what_i_learned: "teaching ".repeat(1000), how_to_apply: "application ".repeat(1000) };
      return { id: p.id, principle_name: p.principle_name, source_id: p.id, source_title: p.source_name,
        source_url: null, source_type: "pdf", why_relevant: "Relevant to trust", tier: "primary", full: p };
    });
    const pack = buildBrainEvidencePack({ selected, evidence_principles: [], supporting_chunks: [] });
    expect(pack.text.length).toBeLessThan(15000);
    expect(pack.selected.length).toBeLessThan(selected.length);
    for (const title of pack.sourceTitles) expect(pack.text).toContain(`SOURCE: "${title}"`);
    for (const p of selected.filter(s => !pack.selected.includes(s))) expect(pack.sourceTitles).not.toContain(p.source_title);
  });

  it("keeps original passage IDs and locators in the validator's evidence", () => {
    const pack = buildBrainEvidencePack({ selected: [], evidence_principles: [], supporting_chunks: [{
      id: "passage-9", source_id: "source-1", source_title: "Training", source_type: "video", category: "trust",
      content: "Find the actual concern before choosing proof.", locator: "13:42", chunk_kind: "source_passage",
    }] });
    expect(pack.text).toContain("PASSAGE ID: passage-9");
    expect(pack.text).toContain("LOCATION: 13:42");
    expect(pack.text).toContain("Original source excerpt");
  });
});
