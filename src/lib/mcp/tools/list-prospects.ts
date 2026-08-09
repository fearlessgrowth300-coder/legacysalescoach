import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_prospects",
  title: "List prospects",
  description: "List the signed-in user's sales prospects with platform, stage and outcome.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max prospects to return (default 20)."),
    search: z.string().optional().describe("Filter by prospect name (case-insensitive)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, search }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("prospects")
      .select("id,name,platform,conversation_stage,outcome,conversation_summary,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 20);
    if (search?.trim()) query = query.ilike("name", `%${search.trim()}%`);
    const { data, error } = await query;
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { prospects: data ?? [] },
    };
  },
});
