const TEMPORARY_AVATAR_HOSTS = ["cdninstagram.com", "fbcdn.net", "instagram.com"];

/**
 * True when a prospect's stored avatar cannot be trusted to keep working:
 * missing, malformed, or still pointing at an expiring Instagram/Facebook CDN URL.
 * Permanent Lovable Cloud storage URLs return false.
 */
export function needsAvatarRefresh(profilePicUrl?: string | null): boolean {
  if (!profilePicUrl || typeof profilePicUrl !== "string" || !profilePicUrl.trim()) return true;

  let host: string;
  try {
    host = new URL(profilePicUrl).hostname.toLowerCase();
  } catch {
    return true;
  }

  if (isPermanentAvatarUrl(profilePicUrl)) return false;

  return TEMPORARY_AVATAR_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** True for avatars served from this project's own storage (public or signed). */
export function isPermanentAvatarUrl(profilePicUrl?: string | null): boolean {
  if (!profilePicUrl) return false;
  return /\/storage\/v1\/object\/(?:public|sign)\/prospect-avatars\//.test(profilePicUrl);
}
