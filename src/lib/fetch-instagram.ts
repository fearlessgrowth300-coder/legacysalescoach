import { supabase } from "@/integrations/supabase/client";

const MAX_POLLS = 40;
const DEFAULT_RETRY_MS = 3000;

export interface InstagramProfileResult {
  username?: string;
  fullName?: string;
  biography?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
  businessCategory?: string;
  externalUrl?: string;
  profilePicUrl?: string;
  recentPosts?: any[];
  targetPost?: any;
  summary?: string;
  [key: string]: any;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function pickInstagramTargetPost(posts: any[] = []): any | null {
  const candidates = posts
    .map((post, index) => ({
      ...post,
      caption: String(post?.caption || post?.text || "").replace(/\s+/g, " ").trim(),
      _index: index,
    }))
    .filter((post) => post.caption.length >= 12);
  if (candidates.length === 0) return null;

  const score = (post: any) =>
    Math.max(0, 500 - post._index * 80) +
    Math.min(post.caption.length, 500) +
    Math.log10(1 + Number(post.likes || post.likesCount || 0)) * 30 +
    Math.log10(1 + Number(post.comments || post.commentsCount || 0)) * 40;

  const selected = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const { _index, ...post } = selected;
  return post;
}

/**
 * Invokes the fetch-instagram function and transparently polls the asynchronous
 * Apify run so the browser never holds a single request open for minutes.
 */
export async function fetchInstagramProfile(usernameOrUrl: string): Promise<InstagramProfileResult> {
  let runId: string | undefined;
  let datasetId: string | undefined;

  for (let attempt = 0; attempt <= MAX_POLLS; attempt++) {
    const { data, error } = await supabase.functions.invoke("fetch-instagram", {
      body: { username: usernameOrUrl, runId, datasetId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    if (data?.pending) {
      runId = data.runId || runId;
      datasetId = data.datasetId || datasetId;
      await wait(Number(data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : DEFAULT_RETRY_MS);
      continue;
    }

    return data as InstagramProfileResult;
  }

  throw new Error("Instagram analysis timed out — please try again in a moment");
}
