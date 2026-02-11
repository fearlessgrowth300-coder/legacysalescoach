import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, otp, type } = await req.json();
    if (!email || !otp) throw new Error("Email and OTP required");

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

    const { data, error } = await resend.emails.send({
      from: "Sales Reply Coach <noreply@ordersstan.store>",
      to: [email],
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

    if (error) {
      console.error("Resend error:", error);
      throw new Error(error.message || "Failed to send email");
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
