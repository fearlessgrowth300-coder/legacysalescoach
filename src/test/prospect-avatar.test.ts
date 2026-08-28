import { describe, expect, it } from "vitest";
import { needsProspectAvatarRefresh } from "@/lib/prospect-avatar";

describe("needsProspectAvatarRefresh", () => {
  it("repairs missing, invalid, and temporary Instagram CDN avatars", () => {
    expect(needsProspectAvatarRefresh(null)).toBe(true);
    expect(needsProspectAvatarRefresh("not-a-url")).toBe(true);
    expect(needsProspectAvatarRefresh("https://scontent.cdninstagram.com/avatar.jpg")).toBe(true);
    expect(needsProspectAvatarRefresh("https://instagram.fbri7-1.fna.fbcdn.net/avatar.jpg")).toBe(true);
  });

  it("keeps stable Supabase avatar URLs", () => {
    expect(needsProspectAvatarRefresh(
      "https://xbliaagchrfnhhwnnayo.supabase.co/storage/v1/object/public/prospect-avatars/user/instagram/alexandra.jpg",
    )).toBe(false);
  });
});
