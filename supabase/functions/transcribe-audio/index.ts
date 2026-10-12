// Live call: transcribe one short chunk of the *call's* audio (the prospect's
// side, captured from the shared Zoom/Meet/Teams tab or screen) on the
// self-hosted Whisper server. The user's own mic is transcribed in the browser.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { transcribeAudioBytes } from "../_shared/video-transcript.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const bytes = await req.arrayBuffer();
    if (bytes.byteLength < 1000) return json({ text: "" });
    // A few seconds of compressed audio is ~50-200 KB; refuse anything big.
    if (bytes.byteLength > 5 * 1024 * 1024) return json({ error: "Audio chunk too large" }, 413);
    const mime = req.headers.get("content-type") || "audio/webm";
    const text = await transcribeAudioBytes(bytes, mime, mime.includes("ogg") ? "chunk.ogg" : "chunk.webm");
    // Whisper writes these for silence/noise; they are not speech.
    return json({ text: /^\s*[\[(].*[\])]\s*$/.test(text) ? "" : text });
  } catch (error) {
    console.error("transcribe-audio error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
