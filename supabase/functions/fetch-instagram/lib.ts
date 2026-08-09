export function extractInstagramUsername(input: string): string {
  const match = input.match(/instagram\.com\/([^/?#]+)/i);
  if (match) return match[1];
  return input.replace(/^@/, "").trim();
}

export function isInstagramPostUrl(input: string): boolean {
  return /instagram\.com\/(?:p|reel|tv)\//i.test(input);
}

export function pickInstagramProfilePicture(value: any): string {
  return value?.profilePicUrlHD ||
    value?.profilePicUrlHd ||
    value?.profilePicUrl ||
    value?.profilePictureUrl ||
    value?.profile_pic_url ||
    value?.hdProfilePicUrlInfo?.url ||
    value?.profilePicUrlInfo?.url ||
    value?.ownerProfilePicUrl ||
    value?.owner?.profilePicUrl ||
    value?.owner?.profilePictureUrl ||
    value?.owner?.profile_pic_url ||
    "";
}

export function normalizeInstagramProfile(profile: any, fallbackUsername: string) {
  return {
    username: profile?.username || fallbackUsername,
    fullName: profile?.fullName || profile?.full_name || "",
    biography: profile?.biography || profile?.bio || "",
    followersCount: profile?.followersCount || profile?.followers || 0,
    followsCount: profile?.followsCount || profile?.following || 0,
    postsCount: profile?.postsCount || profile?.mediaCount || 0,
    isVerified: profile?.verified || profile?.isVerified || false,
    isBusinessAccount: profile?.isBusinessAccount || false,
    businessCategory: profile?.businessCategoryName || profile?.businessCategory || "",
    externalUrl: profile?.externalUrl || profile?.external_url || "",
    profilePicUrl: pickInstagramProfilePicture(profile),
    recentPosts: (profile?.latestPosts || profile?.recentPosts || []).slice(0, 5).map((post: any) => ({
      caption: (post?.caption || post?.text || "").substring(0, 500),
      likes: post?.likesCount || post?.likes || 0,
      comments: post?.commentsCount || post?.comments || 0,
      type: post?.type || "unknown",
      url: post?.url || post?.inputUrl || "",
    })),
  };
}

export type ApifyRunState = "pending" | "succeeded" | "failed";

/** Maps an Apify run status onto the polling contract used by the client. */
export function classifyApifyRunStatus(status: string): ApifyRunState {
  const normalized = (status || "").toUpperCase();
  if (normalized === "SUCCEEDED") return "succeeded";
  if (normalized === "READY" || normalized === "RUNNING") return "pending";
  return "failed";
}

export function avatarExtensionForContentType(contentType: string): "jpg" | "png" | "webp" {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

export function avatarStoragePath(userId: string, username: string, extension: string): string {
  const safeUsername = (username || "").replace(/[^a-z0-9._-]/gi, "_").toLowerCase() || "instagram";
  return `${userId}/instagram/${safeUsername}.${extension}`;
}
