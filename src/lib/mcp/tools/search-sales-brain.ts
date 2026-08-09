import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_sales_brain",
  title: "Search sales brain",
  description: "Search the user's extracted sales principles (their knowledge brain) by keyword.",
  inputSchema: {
    query: z.string().describe("Keywords to search principle names, lessons and application notes."),
    limit: z.number().int().min(1).max(25).optional().describe("Max principles to return (default 8)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const q = query.trim();
    if (!q) throw new ToolError("query must not be empty");
    const supabase = supabaseForUser(ctx);
    const like = `%${q.replace(/[%,]/g, " ")}%`;
    const { data, error } = await supabase
      .from("sales_brain")
      .select(
        "id,principle_name,category,what_i_learned,how_to_apply,when_to_use,exact_words_to_use,source_name,power_level",
      )
      .or(
        `principle_name.ilike.${like},what_i_learned.ilike.${like},how_to_apply.ilike.${like},category.ilike.${like}`,
      )
      .order("power_level", { ascending: false, nullsFirst: false })
      .limit(limit ?? 8);
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { principles: data ?? [] },
    };
  },
});
