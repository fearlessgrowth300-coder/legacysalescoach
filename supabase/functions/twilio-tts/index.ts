import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Serves ElevenLabs TTS audio for Twilio <Play> tags.
 * Twilio GETs this URL and plays the returned audio to the caller.
 * Query params: ?text=URL_ENCODED_TEXT&voiceId=OPTIONAL_VOICE_ID
 */

serve(async (req) => {
  // Twilio fetches via GET for <Play> URLs
  const url = new URL(req.url);
  const text = url.searchParams.get("text") || "Sorry, no text provided.";
  const voiceId = url.searchParams.get("voiceId") || "JBFqnCBsd6RMkjVDRZzb"; // George default

  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  if (!ELEVENLABS_API_KEY) {
    console.error("ELEVENLABS_API_KEY not configured");
    // Return silence - Twilio will just skip
    return new Response(new Uint8Array(0), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }

  try {
    const ttsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.55,
            similarity_boost: 0.8,
            style: 0.35,
            use_speaker_boost: true,
            speed: 1.0,
          },
        }),
      }
    );

    if (!ttsResponse.ok) {
      console.error("ElevenLabs TTS error:", ttsResponse.status, await ttsResponse.text());
      return new Response(new Uint8Array(0), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }

    const audioBuffer = await ttsResponse.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("twilio-tts error:", error);
    return new Response(new Uint8Array(0), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  }
});
