import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Application-level encryption using AES-GCM with a server-side key
const ENCRYPTION_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"; // Use service role key as encryption seed

async function deriveKey(): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(Deno.env.get(ENCRYPTION_KEY_ENV)!);
  const hash = await crypto.subtle.digest("SHA-256", keyMaterial);
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptValue(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Store as iv:ciphertext in hex
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, "0")).join("");
  const ctHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `enc:${ivHex}:${ctHex}`;
}

async function decryptValue(stored: string): Promise<string> {
  // Support legacy plaintext values
  if (!stored.startsWith("enc:")) return stored;
  
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  
  const ivHex = parts[1];
  const ctHex = parts[2];
  const iv = new Uint8Array(ivHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const ct = new Uint8Array(ctHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  
  const key = await deriveKey();
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plainBuffer);
}

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

      // Encrypt the API key before storing
      const encryptedKey = await encryptValue(apiKey.trim());

      const { error } = await supabase
        .from("user_api_keys")
        .upsert(
          { user_id: user.id, service, api_key: encryptedKey },
          { onConflict: "user_id,service" }
        );
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (action === "check") {
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("api_key, updated_at")
        .eq("user_id", user.id)
        .eq("service", service)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Decrypt to get masked version, never return actual key
        const decrypted = await decryptValue(data.api_key);
        const masked = decrypted.substring(0, 8) + "..." + decrypted.substring(decrypted.length - 4);
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
