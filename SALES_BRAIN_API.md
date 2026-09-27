# External Sales Brain API

Create a key in **Settings → External Sales Brain API**. The key is shown once. Keep it in your other website's **server-side** environment variable, never in public JavaScript or a mobile client. Revoke it in Settings if exposed.

The API analyzes the conversation supplied in each request, searches only the key owner's uploaded Knowledge Base (books, PDFs and video transcripts), and returns relevant principles plus short original-source excerpts. It does **not** read Friend workspaces, contacts, or stored AI Chat history. Send the relevant conversation turns on each call; this API does not persist external conversations.

`POST https://iyqwrgqyfsfqgqqhlbec.supabase.co/functions/v1/sales-brain-api`

```http
Authorization: Bearer lsc_live_YOUR_KEY
Content-Type: application/json

{
  "mode": "context",
  "conversation": [
    {"role": "agent", "content": "What are you working on right now?"},
    {"role": "prospect", "content": "I get enquiries but they rarely become sales."}
  ],
  "message": "How can I respond without sounding pushy?"
}
```

The response has `analysis` (stated facts, tentative state, immediate need, one next objective), `principles` (name, source, use/avoid conditions), `evidence` (bounded source excerpts with locators), `retrieval` (confidence and search status), and `generation_instructions`. Pass these fields as **data** to the other site's model. Its prompt should give the current message priority and cite only returned sources. If `principles` and `evidence` are empty, do not claim that the uploaded knowledge supports an answer.

For the app's own grounded response, create the key with **Allow generation**, then use `"mode":"generate"`. The response includes all context fields plus `answer`. This mode uses the account's configured AI provider and consumes its quota. Context mode also attempts an AI situation analysis; if the provider is unavailable, it returns a clearly marked `"certainty":"inferred"` analysis and continues retrieval. Search can use embeddings and full-vault keyword retrieval; `retrieval.degraded` indicates a search component failed.

Node/server example:

```js
const response = await fetch(
  "https://iyqwrgqyfsfqgqqhlbec.supabase.co/functions/v1/sales-brain-api",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SALES_BRAIN_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "context",
      message: "I already have a mentor. What should I say?",
      conversation: [{ role: "prospect", content: "I already have a mentor." }],
    }),
  },
);
if (!response.ok) throw new Error(`Sales Brain HTTP ${response.status}`);
const context = await response.json();
// Give context.analysis, context.principles, context.evidence and
// context.generation_instructions to your own AI before it drafts a reply.
```

Keys expire after 90 days by default, allow up to 30 requests per minute, and can be revoked immediately. The endpoint rejects browser CORS intentionally so website owners keep their key server-side. Invalid/expired keys return 401, insufficient scope 403, rate limits 429 (`Retry-After: 60`), and provider/search outages 503. Requests are bounded to a current message of 8,000 characters and 12 prior turns of 2,000 characters each.

Deployment requires migration `20260927010000_external_sales_brain_api.sql`, then deployment of `manage-sales-brain-access` and `sales-brain-api` with JWT verification disabled for these two functions. The API validates its own opaque key; the management function validates the signed-in Supabase user JWT. Do not use `supabase db push` against a migrated project until its older migration history is reconciled.
