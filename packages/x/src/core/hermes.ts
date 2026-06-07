// SPDX-License-Identifier: Apache-2.0
import type { Tweet, TweetPage } from "./parse";
import type { UserInfo } from "./client";

const DEFAULT_BASE_URL = "https://xquik.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const SEARCH_PATH = "/api/v1/x/tweets/search";
const TWEETS_PATH = "/api/v1/x/tweets";
const USERS_PATH = "/api/v1/x/users";

type JsonObject = Record<string, unknown>;

export type HermesTweetReadBackend = "auto" | "x" | "hermes" | "xquik";

export interface HermesTweetConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HermesTweetClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HermesTweetConfig = readHermesTweetConfigFromEnv()) {
    this.apiKey = config.apiKey?.trim();
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public hasApiKey(): boolean {
    return Boolean(this.apiKey);
  }

  public async userByScreenName(handle: string): Promise<UserInfo> {
    const profile = await this.request(`${USERS_PATH}/${encodeURIComponent(stripHandle(handle))}`);
    return normalizeUserInfo(profile, handle);
  }

  public async search(query: string, count: number, cursor?: string, product = "Latest"): Promise<TweetPage> {
    const payload = await this.request(SEARCH_PATH, {
      q: query,
      queryType: product,
      limit: String(count),
      ...(cursor ? { cursor } : {}),
    });
    return normalizeTweetPage(payload, count);
  }

  public async userTweets(userId: string, count: number, cursor?: string): Promise<TweetPage> {
    const payload = await this.request(`${USERS_PATH}/${encodeURIComponent(userId)}/tweets`, {
      ...(cursor ? { cursor } : {}),
      includeReplies: "true",
    });
    return normalizeTweetPage(payload, count);
  }

  public async getTweet(tweetId: string): Promise<Tweet | null> {
    const payload = await this.request(`${TWEETS_PATH}/${encodeURIComponent(tweetId)}`);
    return normalizeTweet(findFirstObject(payload, ["tweet", "post", "data"]) ?? {}, 0);
  }

  public async thread(tweetId: string, cursor?: string): Promise<TweetPage> {
    const payload = await this.request(
      `${TWEETS_PATH}/${encodeURIComponent(tweetId)}/thread`,
      cursor ? { cursor } : undefined,
    );
    return normalizeTweetPage(payload);
  }

  private async request(path: string, params?: Record<string, string>): Promise<unknown> {
    if (!this.apiKey) {
      throw new Error("Hermes Tweet API key is required. Set HERMES_TWEET_API_KEY or XQUIK_API_KEY.");
    }

    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: hermesTweetHeaders(this.apiKey),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? parseJson(text) : {};
      if (!response.ok) {
        throw new Error(`Hermes Tweet ${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function readHermesTweetConfigFromEnv(): HermesTweetConfig {
  return {
    apiKey: process.env.HERMES_TWEET_API_KEY?.trim() || process.env.XQUIK_API_KEY?.trim(),
    baseUrl: process.env.HERMES_TWEET_BASE_URL?.trim() || process.env.XQUIK_BASE_URL?.trim(),
    timeoutMs: parsePositiveInteger(process.env.HERMES_TWEET_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };
}

export function readHermesTweetReadBackendFromEnv(): HermesTweetReadBackend {
  const value = (process.env.APHRODY_X_READ_BACKEND || process.env.BXC_X_READ_BACKEND || "").trim().toLowerCase();
  if (value === "x" || value === "hermes" || value === "xquik") {
    return value;
  }
  return "auto";
}

export function shouldUseHermesTweetReadBackend(
  backend: HermesTweetReadBackend,
  hasXSession: boolean,
  hasHermesCredentials: boolean,
): boolean {
  if (backend === "x") {
    return false;
  }
  if (backend === "hermes" || backend === "xquik") {
    return true;
  }
  return !hasXSession && hasHermesCredentials;
}

export function hermesTweetHeaders(apiKey: string): Record<string, string> {
  if (apiKey.startsWith("xq_")) {
    return { Accept: "application/json", "x-api-key": apiKey };
  }
  return { Accept: "application/json", Authorization: `Bearer ${apiKey}` };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function normalizeTweetPage(payload: unknown, limit?: number): TweetPage {
  const records = extractRecords(payload, ["tweets", "posts", "data", "results", "items"]);
  const tweets = records
    .map((record, index) => normalizeTweet(record, index))
    .filter((tweet): tweet is Tweet => tweet !== null);
  const limited = limit ? tweets.slice(0, limit) : tweets;
  const cursor = extractCursor(payload);
  return {
    tweets: limited,
    ...(cursor ? { next_cursor: cursor } : {}),
  };
}

function normalizeTweet(record: JsonObject, index: number): Tweet | null {
  const author = asObject(record.author) ?? asObject(record.user) ?? {};
  const id = firstString(record.id, record.tweet_id, record.tweetId, record.rest_id) ?? `hermes-${index + 1}`;
  const text = firstString(record.text, record.full_text, record.fullText) ?? "";
  if (!id) {
    return null;
  }

  const metrics = asObject(record.public_metrics) ?? asObject(record.metrics) ?? {};
  return {
    id,
    text,
    author: {
      username: firstString(author.username, author.screen_name, author.handle, record.username, record.screen_name) ?? "",
      name: firstString(author.name, author.display_name, record.name) ?? "",
    },
    author_id: firstString(record.author_id, record.authorId, author.id, author.user_id, author.rest_id),
    created_at: firstString(record.created_at, record.createdAt, record.created),
    reply_count: numberFromUnknown(metrics.reply_count ?? metrics.replies ?? record.reply_count) ?? 0,
    retweet_count: numberFromUnknown(metrics.retweet_count ?? metrics.retweets ?? record.retweet_count) ?? 0,
    like_count: numberFromUnknown(metrics.like_count ?? metrics.likes ?? record.like_count ?? record.favorite_count) ?? 0,
    quote_count: numberFromUnknown(metrics.quote_count ?? metrics.quotes ?? record.quote_count) ?? 0,
    view_count: numberFromUnknown(metrics.impression_count ?? metrics.views ?? record.view_count ?? record.views),
    conversation_id: firstString(record.conversation_id, record.conversationId),
    in_reply_to_status_id: firstString(record.in_reply_to_status_id, record.inReplyToStatusId),
    lang: firstString(record.lang, record.language),
    is_note_tweet: Boolean(record.is_note_tweet),
    media: Array.isArray(record.media) ? record.media : undefined,
  };
}

function normalizeUserInfo(payload: unknown, handle: string): UserInfo {
  const record = findFirstObject(payload, ["user", "profile", "data"]) ?? {};
  const username = firstString(record.username, record.handle, record.screen_name) ?? stripHandle(handle);
  return {
    id: firstString(record.id, record.user_id, record.userId, record.rest_id) ?? username,
    name: firstString(record.name, record.display_name, username) ?? username,
    screen_name: username,
    followers_count: numberFromUnknown(record.followers_count ?? record.followersCount),
    friends_count: numberFromUnknown(record.friends_count ?? record.following_count ?? record.followingCount),
  };
}

function extractRecords(payload: unknown, keys: string[]): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.filter(isJsonObject);
  }
  if (!isJsonObject(payload)) {
    return [];
  }
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isJsonObject);
    }
  }
  for (const key of ["data", "result"]) {
    const records = extractRecords(payload[key], keys);
    if (records.length > 0) {
      return records;
    }
  }
  return [];
}

function findFirstObject(payload: unknown, keys: string[]): JsonObject | undefined {
  if (!isJsonObject(payload)) {
    return undefined;
  }
  for (const key of keys) {
    if (key === "data" || key === "result") {
      continue;
    }
    const value = payload[key];
    if (isJsonObject(value)) {
      return value;
    }
  }
  for (const key of ["data", "result"]) {
    const found = findFirstObject(payload[key], keys);
    if (found) {
      return found;
    }
  }
  for (const key of keys) {
    const value = payload[key];
    if (isJsonObject(value)) {
      return value;
    }
  }
  return payload;
}

function extractCursor(payload: unknown): string | undefined {
  if (!isJsonObject(payload)) {
    return undefined;
  }
  return firstString(
    payload.nextCursor,
    payload.next_cursor,
    payload.cursor,
    asObject(payload.meta)?.next_token,
    asObject(payload.data)?.nextCursor,
    asObject(payload.result)?.nextCursor,
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const stringValue = String(value).trim();
    if (stringValue) {
      return stringValue;
    }
  }
  return undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stripHandle(value: string): string {
  return value
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//, "");
}

function asObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}
