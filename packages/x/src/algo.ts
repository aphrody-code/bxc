/**
 * algo.ts — pure-TS adaptation of X For You feed ranking concepts
 * (from https://github.com/xai-org/x-algorithm, Apache-2.0).
 *
 * Mirrors the Rust x-algorithm crate so that the high-level @aphrody/x client
 * and `bxc x` CLI can use local "For You" style re-ranking without the Rust FFI.
 *
 * This is intentionally the *classical* part of the algorithm (filters, weighted
 * scoring from observed signals, author diversity). The heavy Phoenix Grok
 * transformer (ML predictions for P(like), P(reply)...) lives in the Python
 * side of the original repo and requires the exported model checkpoint.
 */

export interface PostCandidate {
  id: string;
  author_id: string;
  author_handle?: string;
  text: string;
  created_at: number; // unix seconds
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  is_reply?: boolean;
  is_repost?: boolean;
  has_media?: boolean;
  /** true if we know this came from accounts the viewer follows */
  in_network?: boolean;
}

export interface RankingContext {
  viewer_id?: string;
  followed_author_ids?: string[];
  recent_engagement_author_ids?: string[];
  muted_keywords?: string[];
  blocked_author_ids?: string[];
  now_unix?: number;
  max_age_secs?: number;
}

export interface ScoredPost {
  post: PostCandidate;
  score: number;
  reasons: string[];
}

export function rankPosts(
  candidates: PostCandidate[],
  context: RankingContext = {},
  topK = 20,
): ScoredPost[] {
  if (!candidates || candidates.length === 0) return [];

  const ctx = hydrateContext(context);
  let kept = [...candidates];

  // DropDuplicatesFilter
  {
    const seen = new Set<string>();
    kept = kept.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  // SelfpostFilter
  if (ctx.viewer_id) {
    kept = kept.filter((p) => p.author_id !== ctx.viewer_id);
  }

  // Blocked authors
  if (ctx.blocked_author_ids && ctx.blocked_author_ids.length) {
    const blk = new Set(ctx.blocked_author_ids);
    kept = kept.filter((p) => !blk.has(p.author_id));
  }

  // Muted keywords (simple)
  if (ctx.muted_keywords && ctx.muted_keywords.length) {
    const mutes = ctx.muted_keywords.map((k) => k.toLowerCase());
    kept = kept.filter((p) => {
      const t = p.text.toLowerCase();
      return !mutes.some((kw) => t.includes(kw));
    });
  }

  // Age
  const maxAge = ctx.max_age_secs ?? 7 * 24 * 3600;
  kept = kept.filter((p) => Math.abs(ctx.now_unix - p.created_at) <= maxAge);

  // Score
  let scored: ScoredPost[] = kept.map((p) => computeScore(p, ctx));

  // Author diversity attenuation (post-scoring)
  applyAuthorDiversity(scored);

  // sort + truncate
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK || 20);
}

function hydrateContext(ctx: RankingContext): Required<RankingContext> & { now_unix: number } {
  const now = ctx.now_unix && ctx.now_unix > 0
    ? ctx.now_unix
    : Math.floor(Date.now() / 1000);

  return {
    viewer_id: ctx.viewer_id ?? "",
    followed_author_ids: Array.from(new Set(ctx.followed_author_ids ?? [])),
    recent_engagement_author_ids: Array.from(new Set(ctx.recent_engagement_author_ids ?? [])),
    muted_keywords: ctx.muted_keywords ?? [],
    blocked_author_ids: Array.from(new Set(ctx.blocked_author_ids ?? [])),
    now_unix: now,
    max_age_secs: ctx.max_age_secs ?? 7 * 24 * 3600,
  };
}

function computeScore(post: PostCandidate, ctx: ReturnType<typeof hydrateContext>): ScoredPost {
  let score = 0;
  const reasons: string[] = [];

  // Proxy engagement (real system predicts these probs via transformer)
  const likeW = 1.0;
  const replyW = 3.0;
  const repostW = 4.0;
  const quoteW = 2.5;

  const eng =
    (post.like_count || 0) * likeW +
    (post.reply_count || 0) * replyW +
    (post.repost_count || 0) * repostW +
    (post.quote_count || 0) * quoteW;

  if (eng > 0) {
    score += eng;
    reasons.push(`engagement:${eng.toFixed(1)}`);
  }

  // In-network / followed boost
  const isInNet = !!post.in_network || (ctx.followed_author_ids || []).includes(post.author_id);
  if (isInNet) {
    const bonus = post.in_network ? 120 : 80;
    score += bonus;
    reasons.push(`in_network:+${bonus}`);
  }

  // History affinity
  if ((ctx.recent_engagement_author_ids || []).includes(post.author_id)) {
    score += 45;
    reasons.push("history_affinity:+45");
  }

  // Freshness (within ~48h window)
  const ageH = Math.max(0, (ctx.now_unix - post.created_at) / 3600);
  const fresh = Math.max(0, (48 - Math.min(48, ageH)) / 2);
  if (fresh > 0.5) {
    score += fresh;
    reasons.push(`freshness:${fresh.toFixed(1)}`);
  }

  if (post.has_media) {
    score += 8;
    reasons.push("media:+8");
  }
  if (post.is_reply) {
    score -= 5;
    reasons.push("reply:-5");
  }
  if ((post.text || "").length > 40) score += 3;

  return {
    post: { ...post },
    score: Math.max(0, score),
    reasons,
  };
}

function applyAuthorDiversity(scored: ScoredPost[]) {
  const counts = new Map<string, number>();
  for (const sp of scored) {
    const c = (counts.get(sp.post.author_id) || 0) + 1;
    counts.set(sp.post.author_id, c);
    if (c > 1) {
      const pen = 35 * (c - 1);
      sp.score = Math.max(0, sp.score - pen);
      sp.reasons.push(`diversity_penalty:-${pen}`);
    }
  }
}

import type { Tweet } from "./core/parse";

/**
 * Convert a raw X post object or a typed `Tweet` (from this package's parser)
 * into a `PostCandidate` for the local X For You ranking algorithm.
 *
 * This is the TS equivalent of `tweet_to_algo_candidate` in the Rust x-client.
 */
export function toPostCandidate(raw: any): PostCandidate | null {
  if (!raw || !raw.id) return null;

  // If it's already a typed Tweet from the package, use the dedicated converter
  if (raw.author && typeof raw.author === "object" && "username" in raw.author) {
    return tweetToPostCandidate(raw as Tweet);
  }

  const author = raw.author || raw.user || {};
  const metrics = raw.public_metrics || raw.metrics || raw.legacy || {};
  return {
    id: String(raw.id),
    author_id: String(author.id || raw.author_id || raw.user_id || ""),
    author_handle: author.username || author.handle || raw.username,
    text: raw.text || raw.full_text || raw.legacy?.full_text || "",
    created_at: raw.created_at
      ? Math.floor(new Date(raw.created_at).getTime() / 1000)
      : (raw.timestamp ? Math.floor(raw.timestamp / 1000) : 0),
    like_count: Number(metrics.like_count ?? metrics.favorite_count ?? 0),
    reply_count: Number(metrics.reply_count ?? 0),
    repost_count: Number(metrics.repost_count ?? metrics.retweet_count ?? 0),
    quote_count: Number(metrics.quote_count ?? 0),
    is_reply: !!raw.is_reply || !!raw.in_reply_to_status_id,
    is_repost: !!raw.is_repost || !!raw.retweeted_status,
    has_media: !!(raw.media || raw.extended_entities || raw.entities?.media),
    in_network: raw.in_network,
  };
}

/**
 * Convert a typed `Tweet` (from @aphrody/x parser / XClient results) into
 * a `PostCandidate` for ranking.
 *
 * `inNetwork` should be true for posts from followed accounts (HomeTimeline etc.).
 * Mirrors the Rust integration in rust-bridge/crates/x-client.
 */
export function tweetToPostCandidate(tweet: Tweet, inNetwork = false): PostCandidate {
  let createdAt = 0;
  if (tweet.created_at) {
    const d = new Date(tweet.created_at);
    if (!isNaN(d.getTime())) {
      createdAt = Math.floor(d.getTime() / 1000);
    }
  }

  return {
    id: tweet.id,
    author_id: tweet.author_id || "",
    author_handle: tweet.author?.username,
    text: tweet.text || "",
    created_at: createdAt,
    like_count: tweet.like_count ?? 0,
    reply_count: tweet.reply_count ?? 0,
    repost_count: tweet.retweet_count ?? 0,
    quote_count: tweet.quote_count ?? 0,
    is_reply: !!tweet.in_reply_to_status_id,
    is_repost: !!tweet.quoted_tweet,
    has_media: !!(tweet as any).media && (tweet as any).media.length > 0,
    in_network: inNetwork,
  };
}

/**
 * Rank a list of typed `Tweet`s (from XClient.search, userTweets, etc.)
 * using the local X For You style algorithm.
 *
 * This is the high-level TS equivalent of `rank_tweets` in the Rust x-client.
 * Returns scored posts with explainable reasons.
 */
export function rankTweets(
  tweets: Tweet[],
  context: RankingContext = {},
  topK = 20,
): ScoredPost[] {
  const candidates = tweets
    .map((t) => tweetToPostCandidate(t, false))
    .filter((c): c is PostCandidate => c !== null);
  return rankPosts(candidates, context, topK);
}
