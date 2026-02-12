import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, type } = await req.json();
    if (!email) throw new Error("Email required");

    const normalizedEmail = email.toLowerCase().trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rate limiting: max 3 OTP requests per email per 10 minutes
    const tenMinAgo = new Date(Date.now() - 600_000).toISOString();
    const { data: recentCodes, error: rlErr } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("email", normalizedEmail)
      .gte("created_at", tenMinAgo);

    if (rlErr) throw rlErr;

    if (recentCodes && recentCodes.length >= 3) {
      return new Response(JSON.stringify({ error: "Too many requests. Please wait a few minutes." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate OTP server-side
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 600_000).toISOString(); // 10 min

    // Store in database
    const { error: insertErr } = await supabase.from("otp_codes").insert({
      email: normalizedEmail,
      code: otp,
      type: type || "signup",
      expires_at: expiresAt,
    });
    if (insertErr) throw insertErr;

    // Send email
    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const subject = type === "reset"
      ? "Reset Your Password - Sales Reply Coach"
      : "Verify Your Email - Sales Reply Coach";

    const heading = type === "reset"
      ? "Password Reset Code"
      : "Email Verification Code";

    const description = type === "reset"
      ? "You requested to reset your password. Use the code below:"
      : "Welcome to Sales Reply Coach! Use the code below to verify your email:";

    const { error: sendErr } = await resend.emails.send({
      from: "Sales Reply Coach <noreply@ordersstan.store>",
      to: [normalizedEmail],
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; color: #1a1a1a; margin-bottom: 8px;">${heading}</h1>
          <p style="color: #666; font-size: 14px; margin-bottom: 32px;">${description}</p>
          <div style="background: #f4f4f5; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a1a1a;">${otp}</span>
          </div>
          <p style="color: #999; font-size: 12px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    if (sendErr) {
      console.error("Resend error:", sendErr);
      throw new Error(sendErr.message || "Failed to send email");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-otp error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
