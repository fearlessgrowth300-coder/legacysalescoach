import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_knowledge_items",
  title: "List knowledge sources",
  description: "List the user's knowledge base sources (videos, PDFs, links) and their extraction status.",
  inputSchema: {
    status: z.string().optional().describe("Filter by status, e.g. pending, processing, ready, failed."),
    limit: z.number().int().min(1).max(100).optional().describe("Max items to return (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("knowledge_base_items")
      .select("id,title,type,status,url,brain_type,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 25);
    if (status?.trim()) query = query.eq("status", status.trim());
    const { data, error } = await query;
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
