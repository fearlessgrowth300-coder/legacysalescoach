import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProspects from "./tools/list-prospects";
import getProspectThread from "./tools/get-prospect-thread";
import searchSalesBrain from "./tools/search-sales-brain";
import listKnowledgeItems from "./tools/list-knowledge-items";
import logProspectMessage from "./tools/log-prospect-message";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "code-mirror-hub",
  title: "Code Mirror Hub",
  version: "0.1.0",
  instructions:
    "Tools for the user's AI sales coach workspace. Use `list_prospects` to find prospects, `get_prospect_thread` to read a conversation, `search_sales_brain` to pull the user's own extracted sales principles before advising, `list_knowledge_items` to check knowledge sources and extraction status, and `log_prospect_message` to append a message to a thread. All data is scoped to the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProspects, getProspectThread, searchSalesBrain, listKnowledgeItems, logProspectMessage],
});
