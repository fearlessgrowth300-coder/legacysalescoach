// Spoken-word transcripts for Instagram reels and TikTok videos.
// Captions/likes alone gave the Sales Brain nothing to learn from; YouTube
// already had real transcripts. Order: the platform's own subtitles (TikTok,
// free and instant) -> download the video and transcribe it with the
// self-hosted Whisper server (LOCAL_WHISPER_URL, same bearer token as the
// embedding server).

/** WebVTT/SRT -> plain text: drop headers, cue numbers, timestamps, tags and repeats. */
export function subtitlesToText(subtitles: string): string {
  const lines: string[] = [];
  for (const raw of String(subtitles || "").split(/\r?\n/)) {
    const line = raw.replace(/<[^>]+>/g, "").trim();
    if (!line || line === "WEBVTT" || /^\d+$/.test(line) || line.includes("-->") || /^(NOTE|STYLE|Kind:|Language:)/.test(line)) continue;
    if (lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** First usable video file URL from an Apify Instagram/TikTok item (field names vary by actor). */
export function pickVideoFileUrl(item: Record<string, any>): string | null {
  const candidates = [
    item?.videoUrl, item?.video_url, item?.videoMeta?.downloadAddr, item?.videoMeta?.playAddr,
    ...(Array.isArray(item?.mediaUrls) ? item.mediaUrls : []),
    item?.video?.downloadAddr, item?.video?.playAddr,
  ];
  return candidates.find((value) => typeof value === "string" && /^https?:\/\//.test(value)) || null;
}

/** English (or first) subtitle download link from a TikTok Apify item. */
export function pickSubtitleUrl(item: Record<string, any>): string | null {
  const links = item?.videoMeta?.subtitleLinks || item?.subtitleLinks || item?.video?.subtitleInfos || [];
  if (!Array.isArray(links) || !links.length) return null;
  const pick = links.find((link: any) => /^en/i.test(String(link?.language || link?.LanguageCodeName || ""))) || links[0];
  const url = pick?.downloadLink || pick?.tiktokLink || pick?.Url || pick?.url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

/** Download a short-form video and transcribe it on the Whisper server; "" when unavailable. */
export async function transcribeVideoUrl(videoUrl: string): Promise<string> {
  const endpoint = (globalThis as any).Deno?.env?.get("LOCAL_WHISPER_URL");
  const token = (globalThis as any).Deno?.env?.get("LOCAL_EMBED_TOKEN") || "";
  if (!endpoint || !videoUrl) return "";
  try {
    const video = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!video.ok) { console.warn("[video-transcript] video download failed", video.status); return ""; }
    const bytes = await video.arrayBuffer();
    // Reels/TikToks are a few MB; refuse anything huge rather than exhaust edge memory.
    if (bytes.byteLength > 80 * 1024 * 1024) { console.warn("[video-transcript] video too large", bytes.byteLength); return ""; }
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "video.mp4");
    form.append("response_format", "text");
    const response = await fetch(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(140_000),
    });
    if (!response.ok) { console.warn("[video-transcript] whisper failed", response.status); return ""; }
    return (await response.text()).replace(/\s+/g, " ").trim();
  } catch (error) {
    console.warn("[video-transcript] transcription unavailable", error instanceof Error ? error.message : error);
    return "";
  }
}

export async function fetchSubtitleText(url: string | null): Promise<string> {
  if (!url) return "";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    return response.ok ? subtitlesToText(await response.text()) : "";
  } catch {
    return "";
  }
}
