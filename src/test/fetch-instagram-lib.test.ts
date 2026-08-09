import { describe, expect, it } from "vitest";
import {
  extractInstagramUsername,
  isInstagramPostUrl,
  normalizeInstagramProfile,
  pickInstagramProfilePicture,
} from "../../supabase/functions/fetch-instagram/lib";

describe("Instagram prospect enrichment", () => {
  it("extracts usernames while distinguishing profiles from posts", () => {
    expect(extractInstagramUsername("https://www.instagram.com/alexandrakakei/"))
      .toBe("alexandrakakei");
    expect(extractInstagramUsername("@alexandrakakei")).toBe("alexandrakakei");
    expect(isInstagramPostUrl("https://instagram.com/reel/ABC123/")).toBe(true);
    expect(isInstagramPostUrl("https://instagram.com/alexandrakakei/")).toBe(false);
  });

  it("accepts current and fallback Instagram avatar field shapes", () => {
    expect(pickInstagramProfilePicture({ profilePicUrlHD: "https://cdn.example/hd.jpg" }))
      .toBe("https://cdn.example/hd.jpg");
    expect(pickInstagramProfilePicture({ profilePictureUrl: "https://cdn.example/profile.jpg" }))
      .toBe("https://cdn.example/profile.jpg");
    expect(pickInstagramProfilePicture({ owner: { profilePicUrl: "https://cdn.example/owner.jpg" } }))
      .toBe("https://cdn.example/owner.jpg");
  });

  it("normalizes the bio and five recent posts used to generate the first DM", () => {
    const normalized = normalizeInstagramProfile({
      username: "alexandrakakei",
      fullName: "Alexandra | Online Income",
      biography: "Build a life you do not need to unplug from",
      profilePictureUrl: "https://cdn.example/alexandra.jpg",
      latestPosts: Array.from({ length: 7 }, (_, index) => ({
        caption: `Post ${index + 1}`,
        likesCount: index + 10,
        commentsCount: index + 1,
        url: `https://instagram.com/p/${index + 1}`,
      })),
    }, "fallback");

    expect(normalized.username).toBe("alexandrakakei");
    expect(normalized.biography).toContain("unplug");
    expect(normalized.profilePicUrl).toBe("https://cdn.example/alexandra.jpg");
    expect(normalized.recentPosts).toHaveLength(5);
    expect(normalized.recentPosts[0].caption).toBe("Post 1");
  });
});
