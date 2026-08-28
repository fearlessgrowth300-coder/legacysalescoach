import { supabase } from "@/integrations/supabase/client";

const INSTAGRAM_POLL_INTERVAL_MS = 3000;
const INSTAGRAM_MAX_POLLS = 40;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchInstagramData(usernameOrUrl: string): Promise<any> {
  let body: Record<string, string> = { username: usernameOrUrl };

  for (let attempt = 0; attempt <= INSTAGRAM_MAX_POLLS; attempt += 1) {
    const { data, error } = await supabase.functions.invoke("fetch-instagram", { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.pending) return data;

    if (!data.runId || !data.datasetId) {
      throw new Error("Instagram analysis started without a valid run reference");
    }
    if (attempt === INSTAGRAM_MAX_POLLS) break;

    await delay(Number(data.retryAfterMs) || INSTAGRAM_POLL_INTERVAL_MS);
    body = {
      username: usernameOrUrl,
      runId: data.runId,
      datasetId: data.datasetId,
    };
  }

  throw new Error("Instagram analysis is taking longer than expected. Please try again.");
}
