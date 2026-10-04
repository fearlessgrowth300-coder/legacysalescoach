import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { sourceKind, sourceLink } from "../../../../supabase/functions/_shared/external-brain";

export default defineTool({
  name: "search_sales_brain",
  title: "Search sales brain",
  description: "Search the user's Sales Brain: extracted principles AND original passages from their uploaded books, PDFs and video transcripts. Every result names its source (pdf/video/web page), chapter or page/timestamp, and a link (videos open at the exact moment).",
  inputSchema: {
    query: z.string().describe("What you need, in plain words (any word can match), e.g. 'price objection too expensive'."),
    limit: z.number().int().min(1).max(25).optional().describe("Max principles and max passages to return (default 8 each)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const words = [...new Set(query.toLowerCase().match(/[a-z0-9']{3,}/g) || [])].slice(0, 12);
    if (!words.length) throw new ToolError("query must contain at least one word");
    const supabase = supabaseForUser(ctx);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new ToolError("Not authenticated");
    const max = limit ?? 8;
    // Runs with the caller's permissions (SECURITY INVOKER): only their own vault.
    const { data: rows, error } = await supabase.rpc("search_sales_knowledge", {
      search_query: words.join(" OR "), p_user_id: auth.user.id, match_count: max * 4,
    });
    if (error) throw new ToolError(error.message);
    const hits = (rows || []) as Array<{ kind: string; record: Record<string, any> }>;
    const principleRows = hits.filter((hit) => hit.kind === "principle").slice(0, max).map((hit) => hit.record);
    const passageRows = hits.filter((hit) => hit.kind === "passage").slice(0, max).map((hit) => hit.record);
    const sourceIds = [...new Set([...principleRows, ...passageRows].map((row) => row.source_id).filter(Boolean))];
    const { data: sources } = sourceIds.length
      ? await supabase.from("knowledge_base_items").select("id,title,type,url").in("id", sourceIds)
      : { data: [] };
    const sourceById = new Map((sources || []).map((row: any) => [row.id, row]));
    const describe = (id: string | null, fallbackTitle: string | null, locator?: string | null) => {
      const row: any = id ? sourceById.get(id) : null;
      return { title: row?.title || fallbackTitle || null, type: sourceKind(row?.type, row?.url), url: sourceLink(row?.url, locator) };
    };
    const principles = principleRows.map((p) => ({
      name: p.principle_name,
      source: describe(p.source_id, p.source_name),
      chapter: p.metadata?.chapter ?? null,
      what_it_teaches: p.what_i_learned,
      how_to_apply: p.how_to_apply,
      when_to_use: p.when_to_use,
      exact_words_from_source: p.exact_words_to_use,
      power_level: p.power_level,
    }));
    const passages = passageRows.map((c) => ({
      source: describe(c.source_id, c.metadata?.source_title ?? null, c.locator),
      location: c.locator || null,
      original_text: c.chunk_kind === "source_passage",
      excerpt: String(c.content || "").slice(0, 700),
    }));
    const result = { principles, passages };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
