import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Sign in required" }, 401);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const input = request.method === "POST" ? await request.json().catch(() => null) : null;
    if (request.method === "GET" || input?.action === "list") {
      const { data, error } = await admin.from("sales_brain_access_keys")
        .select("id,name,key_prefix,scopes,requests_per_minute,total_requests,last_used_at,expires_at,revoked_at,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return json({ keys: data || [] });
    }

    if (!input || typeof input !== "object") return json({ error: "Invalid JSON" }, 400);
    if (input.action === "revoke") {
      if (typeof input.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id)) return json({ error: "Invalid key id" }, 400);
      const { data, error } = await admin.from("sales_brain_access_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("id", input.id).is("revoked_at", null).select("id").maybeSingle();
      if (error) throw error;
      return data ? json({ revoked: true }) : json({ error: "Active key not found" }, 404);
    }
    if (input.action !== "create") return json({ error: "Use action create or revoke" }, 400);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const scopes = input.scopes === undefined ? ["context"] : input.scopes;
    const days = input.expiresInDays === undefined ? 90 : input.expiresInDays;
    if (!name || name.length > 80 || !Array.isArray(scopes) || !scopes.length ||
      scopes.some((scope) => scope !== "context" && scope !== "generate") ||
      !Number.isInteger(days) || days < 1 || days > 365) {
      return json({ error: "Provide a name, valid scopes and expiry of 1-365 days" }, 400);
    }
    const { count, error: countError } = await admin.from("sales_brain_access_keys")
      .select("id", { count: "exact", head: true }).eq("user_id", user.id).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if (countError) throw countError;
    if ((count || 0) >= 10) return json({ error: "Revoke an existing key before creating another (10-key limit)" }, 409);

    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const secret = `lsc_live_${hex}`;
    const prefix = `lsc_live_${hex.slice(0, 8)}`;
    const { data, error } = await admin.from("sales_brain_access_keys").insert({
      user_id: user.id,
      name,
      key_prefix: prefix,
      key_hash: await sha256(secret),
      scopes: [...new Set(scopes)],
      expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
    }).select("id,name,key_prefix,scopes,expires_at,created_at").single();
    if (error) throw error;
    return json({ key: secret, metadata: data, warning: "Copy this key now. It cannot be shown again." }, 201);
  } catch (error) {
    console.error("manage-sales-brain-access failed", error instanceof Error ? error.message : error);
    return json({ error: "Unable to manage Sales Brain keys" }, 500);
  }
});
