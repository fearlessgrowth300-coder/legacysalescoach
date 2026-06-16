import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resolveUserChatTarget, NoUserAiKeyError } from "../_shared/user-ai.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { filePath, imageBase64, mimeType: inputMimeType } = body;

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let base64: string;
    let mimeType: string;

    if (imageBase64) {
      // Direct base64 from client (used by WorkspaceTrainingUpload)
      base64 = imageBase64;
      mimeType = inputMimeType || "image/png";
    } else if (filePath) {
      // Download from storage (used by chat screenshots)
      const { data: fileData, error: fileError } = await supabase.storage
        .from("chat-screenshots")
        .download(filePath);

      if (fileError || !fileData) {
        return new Response(JSON.stringify({ error: "Could not download screenshot" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64 = btoa(binary);

      const ext = filePath.split(".").pop()?.toLowerCase() || "png";
      const mimeMap: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        webp: "image/webp", gif: "image/gif",
      };
      mimeType = mimeMap[ext] || "image/png";
    } else {
      return new Response(JSON.stringify({ error: "No image provided (need filePath or imageBase64)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let chat;
    try {
      chat = await resolveUserChatTarget(supabase, user.id);
    } catch (e) {
      if (e instanceof NoUserAiKeyError) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }
    if (chat.isAnthropic) {
      return new Response(JSON.stringify({ error: "Anthropic doesn't support vision via this endpoint. Add an OpenAI or Gemini key in Settings for screenshot OCR." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiResponse = await fetch(chat.url, {
      method: "POST",
      headers: chat.headers,
      body: JSON.stringify({
        model: chat.models.vision,

        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `This is a screenshot of a chat/DM conversation. Perform a VISION SYNC:

1. IDENTIFY the Name of the person (look for profile name, username, or header)
2. IDENTIFY the Platform (Instagram, TikTok, WhatsApp, iMessage, etc.)
3. Extract ALL messages in chronological order

Format output as:
NAME: [detected name]
PLATFORM: [detected platform]
---
[Each message on a new line, labeled "Them:" or "Me:" based on message alignment/color]

Only return the extracted data, nothing else.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI OCR failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const extractedText = aiData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ text: extractedText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ocr-screenshot error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
