import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = origin.endsWith(".lovable.app") || origin.startsWith("http://localhost:");
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "https://legacysalescoach.lovable.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  const headers = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const { action, service, apiKey } = await req.json();

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Input validation
    if (!service || typeof service !== "string" || service.length > 50) {
      return new Response(JSON.stringify({ error: "Invalid service name" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const allowedServices = ["supadata", "transcriptapi"];
    if (!allowedServices.includes(service)) {
      return new Response(JSON.stringify({ error: "Unsupported service" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (action === "save") {
      if (!apiKey || typeof apiKey !== "string" || apiKey.length > 500) {
        return new Response(JSON.stringify({ error: "Invalid API key" }), {
          status: 400, headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      // Upsert the key
      const { error } = await supabase
        .from("user_api_keys")
        .upsert(
          { user_id: user.id, service, api_key: apiKey.trim() },
          { onConflict: "user_id,service" }
        );
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (action === "check") {
      // Return whether a key exists (masked), never the actual key
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("api_key, updated_at")
        .eq("user_id", user.id)
        .eq("service", service)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const key = data.api_key;
        const masked = key.substring(0, 8) + "..." + key.substring(key.length - 4);
        return new Response(JSON.stringify({ exists: true, masked, updatedAt: data.updated_at }), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ exists: false }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      await supabase
        .from("user_api_keys")
        .delete()
        .eq("user_id", user.id)
        .eq("service", service);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("manage-api-keys error:", error);
    const headers = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});
