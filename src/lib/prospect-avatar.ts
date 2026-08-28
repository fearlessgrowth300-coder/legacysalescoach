const TEMPORARY_INSTAGRAM_AVATAR_HOSTS = [
  "cdninstagram.com",
  "fbcdn.net",
  "instagram.com",
];

export function needsProspectAvatarRefresh(profilePicUrl?: string | null): boolean {
  if (!profilePicUrl?.trim()) return true;

  try {
    const hostname = new URL(profilePicUrl).hostname.toLowerCase();
    return TEMPORARY_INSTAGRAM_AVATAR_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return true;
  }
}
