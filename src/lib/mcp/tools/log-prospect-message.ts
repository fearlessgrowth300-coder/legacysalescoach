import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "log_prospect_message",
  title: "Log a prospect message",
  description: "Append a message to a prospect's thread (inbound from the prospect or outbound from the user).",
  inputSchema: {
    prospect_id: z.string().describe("The prospect's id (from list_prospects)."),
    content: z.string().describe("Message text to store."),
    direction: z.enum(["inbound", "outbound"]).describe("inbound = from the prospect, outbound = sent by the user."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ prospect_id, content, direction }, ctx) => {
    if (!ctx.isAuthenticated()) throw new ToolError("Not authenticated");
    const text = content.trim();
    if (!text) throw new ToolError("content must not be empty");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ prospect_id, content: text, direction, user_id: ctx.getUserId(), is_ai_suggestion: false })
      .select("id,content,direction,created_at")
      .maybeSingle();
    if (error) throw new ToolError(error.message);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { message: data },
    };
  },
});
