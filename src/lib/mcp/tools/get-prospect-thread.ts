import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_prospect_thread",
  title: "Get prospect conversation",
  description: "Read the message thread for one prospect, oldest first, including AI suggestions.",
  inputSchema: {
    prospect_id: z.string().describe("The prospect's id (from list_prospects)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max messages to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ prospect_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const { data: prospect, error: pErr } = await supabase
      .from("prospects")
      .select("id,name,platform,conversation_stage,outcome,conversation_summary")
      .eq("id", prospect_id)
      .maybeSingle();
    if (pErr) throw new ToolError(pErr.message);
    if (!prospect) throw new ToolError("Prospect not found");
    const { data: messages, error } = await supabase
      .from("chat_messages")
      .select("id,content,direction,is_ai_suggestion,detected_tone,created_at")
      .eq("prospect_id", prospect_id)
      .order("created_at", { ascending: true })
      .limit(limit ?? 50);
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify({ prospect, messages: messages ?? [] }, null, 2) }],
      structuredContent: { prospect, messages: messages ?? [] },
    };
  },
});
