import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error("Twilio credentials not configured");
    }

    // Auth check
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, phoneNumber, scenarioId, scenarioName, businessContext, customScenario, sessionId } = await req.json();

    if (action === "initiate") {
      if (!phoneNumber || !scenarioId) {
        return new Response(JSON.stringify({ error: "Phone number and scenario are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean phone number
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, "");
      if (cleanPhone.length < 10) {
        return new Response(JSON.stringify({ error: "Invalid phone number" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create session in DB
      const { data: session, error: sessionError } = await supabase
        .from("practice_call_sessions")
        .insert({
          user_id: user.id,
          scenario_id: scenarioId,
          scenario_name: scenarioName || scenarioId,
          phone_number: cleanPhone,
          status: "initiating",
          transcript: [],
        })
        .select("id")
        .single();

      if (sessionError) throw sessionError;

      // Save phone number to profile for convenience
      await supabase
        .from("profiles")
        .update({ phone_number: cleanPhone })
        .eq("user_id", user.id);

      // Build webhook URL
      const webhookUrl = `${supabaseUrl}/functions/v1/twilio-practice-webhook?sessionId=${session.id}`;
      const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-practice-call`;

      // Build custom scenario params to pass via webhook URL
      const scenarioParams = new URLSearchParams();
      if (customScenario?.name) scenarioParams.set("sn", customScenario.name.substring(0, 100));
      if (customScenario?.description) scenarioParams.set("sd", customScenario.description.substring(0, 500));
      if (customScenario?.persona) scenarioParams.set("sp", customScenario.persona.substring(0, 500));
      if (businessContext) scenarioParams.set("bc", businessContext.substring(0, 500));

      const fullWebhookUrl = `${webhookUrl}&${scenarioParams.toString()}`;

      // Initiate Twilio call
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
      const twilioBody = new URLSearchParams({
        To: cleanPhone.startsWith("+") ? cleanPhone : `+${cleanPhone}`,
        From: TWILIO_PHONE_NUMBER,
        Url: fullWebhookUrl,
        StatusCallback: `${statusCallbackUrl}`,
        StatusCallbackEvent: "initiated ringing answered completed",
        StatusCallbackMethod: "POST",
        Method: "POST",
      });

      const twilioResponse = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: twilioBody.toString(),
      });

      const twilioData = await twilioResponse.json();

      if (!twilioResponse.ok) {
        // Update session as failed
        await supabase.from("practice_call_sessions").update({ status: "failed" }).eq("id", session.id);
        throw new Error(twilioData.message || `Twilio error: ${twilioResponse.status}`);
      }

      // Update session with call SID
      await supabase.from("practice_call_sessions")
        .update({ twilio_call_sid: twilioData.sid, status: "ringing" })
        .eq("id", session.id);

      return new Response(JSON.stringify({
        sessionId: session.id,
        callSid: twilioData.sid,
        status: "ringing",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "status") {
      // Check session status
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "sessionId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: session } = await supabase
        .from("practice_call_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();

      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(session), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle Twilio status callback (no auth - comes from Twilio)
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("twilio-practice-call error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
