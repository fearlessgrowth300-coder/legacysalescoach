import { describe, expect, it } from "vitest";
import { pickSubtitleUrl, pickVideoFileUrl, subtitlesToText } from "../../supabase/functions/_shared/video-transcript";

describe("short-form video transcripts", () => {
  it("turns TikTok WebVTT captions into plain text", () => {
    const vtt = `WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nAll right sales girls, let's talk closing.\n\n2\n00:00:02.000 --> 00:00:04.000\n<c>Never say cost,</c> say investment.\n\n3\n00:00:04.000 --> 00:00:05.000\nNever say cost, say investment.`;
    expect(subtitlesToText(vtt)).toBe("All right sales girls, let's talk closing. Never say cost, say investment.");
  });

  it("finds the video file across actor field names", () => {
    expect(pickVideoFileUrl({ type: "Video", videoUrl: "https://cdn.ig/v.mp4" })).toBe("https://cdn.ig/v.mp4");
    expect(pickVideoFileUrl({ mediaUrls: ["https://api.apify.com/v2/key-value-stores/x/records/v.mp4"] })).toContain("apify.com");
    expect(pickVideoFileUrl({ videoMeta: { downloadAddr: "https://v16.tiktok/v.mp4" } })).toBe("https://v16.tiktok/v.mp4");
    expect(pickVideoFileUrl({ caption: "no video" })).toBeNull();
  });

  it("prefers English TikTok subtitles", () => {
    expect(pickSubtitleUrl({ videoMeta: { subtitleLinks: [
      { language: "spa-ES", downloadLink: "https://s/es.vtt" },
      { language: "eng-US", downloadLink: "https://s/en.vtt" },
    ] } })).toBe("https://s/en.vtt");
    expect(pickSubtitleUrl({})).toBeNull();
  });
});
