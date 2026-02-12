import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, code, type } = await req.json();
    if (!email || !code || !type) throw new Error("email, code, and type required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find valid OTP
    const { data: otpRecord, error: fetchErr } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .eq("type", type)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (!otpRecord) {
      return new Response(JSON.stringify({ valid: false, error: "Code expired or not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Max 5 attempts
    if (otpRecord.attempts >= 5) {
      // Delete the code to force requesting a new one
      await supabase.from("otp_codes").delete().eq("id", otpRecord.id);
      return new Response(JSON.stringify({ valid: false, error: "Too many attempts. Request a new code." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Increment attempts
    await supabase.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id);

    if (otpRecord.code !== code) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Valid — delete used code
    await supabase.from("otp_codes").delete().eq("id", otpRecord.id);

    return new Response(JSON.stringify({ valid: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("verify-otp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
