// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";
import type { Tweet, TweetPage } from "../core/parse";
import { walkTimelineTweets } from "../core/parse";
import {
  RADAR_GRAPHQL_OPS,
  RADAR_QUERY_SOURCE,
  RADAR_NEW_URL,
  RADAR_PAGE_URL,
  type RadarSearchProduct,
} from "../config/radar-surface";

export interface RadarSearchOptions {
  count?: number;
  cursor?: string;
  product?: RadarSearchProduct;
  quoteDepth?: number;
  /** Override querySource (default: radar). */
  querySource?: string;
}

export interface RadarActivityBucket {
  /** ISO date YYYY-MM-DD */
  day: string;
  count: number;
}

export interface RadarMetrics {
  query: string;
  tweet_count: number;
  total_likes: number;
  total_retweets: number;
  avg_likes: number;
  top_tweets: Tweet[];
  activity_by_day: RadarActivityBucket[];
  fetched_at: string;
}

export interface RadarExploreSnapshot {
  explore_page: unknown;
  explore_sidebar: unknown;
  fetched_at: string;
}

function tweetDay(t: Tweet): string {
  const d = new Date(t.created_at);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function activityBuckets(tweets: Tweet[], days = 3): RadarActivityBucket[] {
  const cutoff = Date.now() - days * 86_400_000;
  const counts = new Map<string, number>();
  for (const t of tweets) {
    const d = new Date(t.created_at);
    if (Number.isNaN(d.getTime()) || d.getTime() < cutoff) continue;
    const day = tweetDay(t);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function computeMetrics(query: string, tweets: Tweet[]): RadarMetrics {
  let totalLikes = 0;
  let totalRts = 0;
  for (const t of tweets) {
    totalLikes += t.like_count ?? 0;
    totalRts += t.retweet_count ?? 0;
  }
  const n = tweets.length || 1;
  const top = [...tweets].sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)).slice(0, 10);
  return {
    query,
    tweet_count: tweets.length,
    total_likes: totalLikes,
    total_retweets: totalRts,
    avg_likes: Math.round((totalLikes / n) * 10) / 10,
    top_tweets: top,
    activity_by_day: activityBuckets(tweets, 3),
    fetched_at: new Date().toISOString(),
  };
}

/** Radar search — SearchTimeline with querySource `radar` (matches x.com/i/radar). */
export async function radarSearch(
  client: XClient,
  rawQuery: string,
  opts: RadarSearchOptions = {},
): Promise<TweetPage> {
  const count = opts.count ?? 40;
  const variables: Record<string, unknown> = {
    rawQuery,
    count,
    querySource: opts.querySource ?? RADAR_QUERY_SOURCE,
    product: opts.product ?? "Latest",
  };
  if (opts.cursor) variables.cursor = opts.cursor;
  const json = await client.graphqlWaiting("SearchTimeline", variables);
  return walkTimelineTweets(json, opts.quoteDepth ?? 0);
}

export async function radarSearchAll(
  client: XClient,
  rawQuery: string,
  maxPages = 5,
  opts: Omit<RadarSearchOptions, "cursor"> = {},
): Promise<{ tweets: Tweet[]; pages: number }> {
  const tweets: Tweet[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages < maxPages) {
    const page = await radarSearch(client, rawQuery, { ...opts, cursor });
    pages++;
    tweets.push(...page.tweets);
    if (!page.next_cursor || page.tweets.length === 0) break;
    cursor = page.next_cursor;
  }
  return { tweets, pages };
}

export async function radarMetrics(
  client: XClient,
  rawQuery: string,
  maxPages = 3,
  opts: Omit<RadarSearchOptions, "cursor"> = {},
): Promise<RadarMetrics> {
  const { tweets } = await radarSearchAll(client, rawQuery, maxPages, opts);
  return computeMetrics(rawQuery, tweets);
}

export async function radarExplore(client: XClient): Promise<RadarExploreSnapshot> {
  const [explore_page, explore_sidebar] = await Promise.all([
    client.graphqlWaiting("ExplorePage", {}),
    client.graphqlWaiting("ExploreSidebar", {}),
  ]);
  return {
    explore_page,
    explore_sidebar,
    fetched_at: new Date().toISOString(),
  };
}

export async function probeRadarAccess(client: XClient): Promise<{
  page_urls: { radar: string; new: string };
  search_ok: boolean;
  explore_ok: boolean;
  graphql_ops: readonly string[];
  error?: string;
}> {
  let search_ok = false;
  let explore_ok = false;
  let error: string | undefined;
  try {
    const page = await radarSearch(client, "a", { count: 5 });
    search_ok = page.tweets.length >= 0;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }
  try {
    await radarExplore(client);
    explore_ok = true;
  } catch {
    explore_ok = false;
  }
  return {
    page_urls: { radar: RADAR_PAGE_URL, new: RADAR_NEW_URL },
    search_ok,
    explore_ok,
    graphql_ops: RADAR_GRAPHQL_OPS,
    error,
  };
}