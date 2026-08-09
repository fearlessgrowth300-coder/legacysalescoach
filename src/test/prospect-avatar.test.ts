import { describe, expect, it } from "vitest";
import { needsAvatarRefresh, isPermanentAvatarUrl } from "@/lib/prospect-avatar";
import { classifyApifyRunStatus } from "../../supabase/functions/fetch-instagram/lib";

describe("prospect avatar freshness", () => {
  it("flags missing and invalid urls", () => {
    expect(needsAvatarRefresh(null)).toBe(true);
    expect(needsAvatarRefresh("")).toBe(true);
    expect(needsAvatarRefresh("not-a-url")).toBe(true);
  });

  it("flags expiring Instagram and Facebook CDN urls", () => {
    expect(needsAvatarRefresh("https://scontent-lhr8-1.cdninstagram.com/v/t51.jpg")).toBe(true);
    expect(needsAvatarRefresh("https://scontent.xx.fbcdn.net/v/t51.jpg")).toBe(true);
    expect(needsAvatarRefresh("https://instagram.fabc1-1.instagram.com/pic.jpg")).toBe(true);
  });

  it("accepts permanent cloud storage urls", () => {
    const publicUrl = "https://xbliaagchrfnhhwnnayo.supabase.co/storage/v1/object/public/prospect-avatars/u1/instagram/alexandrakakei.jpg";
    const signedUrl = "https://xbliaagchrfnhhwnnayo.supabase.co/storage/v1/object/sign/prospect-avatars/u1/instagram/alexandrakakei.jpg?token=abc";
    expect(needsAvatarRefresh(publicUrl)).toBe(false);
    expect(needsAvatarRefresh(signedUrl)).toBe(false);
    expect(isPermanentAvatarUrl(publicUrl)).toBe(true);
  });
});

describe("apify run polling states", () => {
  it("treats queued and running as pending", () => {
    expect(classifyApifyRunStatus("READY")).toBe("pending");
    expect(classifyApifyRunStatus("RUNNING")).toBe("pending");
  });
  it("treats succeeded as complete", () => {
    expect(classifyApifyRunStatus("SUCCEEDED")).toBe("succeeded");
  });
  it("treats failed, aborted and timed-out as errors", () => {
    expect(classifyApifyRunStatus("FAILED")).toBe("failed");
    expect(classifyApifyRunStatus("ABORTED")).toBe("failed");
    expect(classifyApifyRunStatus("TIMED-OUT")).toBe("failed");
  });
});
