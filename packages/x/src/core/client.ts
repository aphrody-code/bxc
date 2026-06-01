// SPDX-License-Identifier: Apache-2.0
import { XSession } from "./session";
import { QueryIdStore } from "../config/query-ids";
import { getOperation } from "../config/catalog";
import { featuresFor, CREATE_TWEET_FEATURES_KNOWN_GOOD, DEFAULT_FEATURES } from "./features";
import {
  XError,
  checkApiErrors,
  walkTimelineTweets,
  walkTimelineUsers,
} from "./parse";
import type { Tweet, TweetPage, UserPage } from "./parse";
import { getNews } from "../services/news";
import type { NewsItem, NewsOptions } from "../services/news";
import { uploadMedia } from "../services/media";

export const WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const API_BASE = "https://x.com/i/api";

export interface RateLimit {
  limit: number;
  remaining: number;
  reset_epoch: number; // Unix epoch seconds
}

export interface TweetResult {
  id: string;
  text: string;
}

export interface UserInfo {
  id: string;
  name: string;
  screen_name: string;
  followers_count?: number;
  friends_count?: number;
}

export interface ListInfo {
  id: string;
  name: string;
  member_count?: number;
  subscriber_count?: number;
  mode?: string;
}

export interface TimelineTweet {
  id: string;
  text: string;
}

/** Construct default headers for X private API authentication. */
export function authHeaders(
  session: XSession,
  clientUuid: string,
  clientDeviceId: string
): Record<string, string> {
  return {
    "authorization": `Bearer ${WEB_BEARER}`,
    "cookie": session.cookieHeader(),
    "x-csrf-token": session.ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "accept": "*/*",
    "origin": "https://x.com",
    "referer": "https://x.com/",
    "x-client-uuid": clientUuid,
    "x-twitter-client-deviceid": clientDeviceId,
  };
}

export class XClient {
  public session: XSession;
  public clientUuid: string;
  public clientDeviceId: string;
  public queryIds: QueryIdStore;
  public lastRateLimit: RateLimit | null = null;

  constructor(session: XSession, queryIds?: QueryIdStore) {
    this.session = session;
    this.clientUuid = crypto.randomUUID();
    this.clientDeviceId = crypto.randomUUID();
    this.queryIds = queryIds || new QueryIdStore();
  }

  public transactionId(): string {
    return this.session.transaction_id || crypto.randomUUID().replace(/-/g, "");
  }

  /** Run any HTTP request pre-populated with X auth headers. Keeps cookies updated and retries transient issues. */
  public async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers || {});

    const defaults = authHeaders(this.session, this.clientUuid, this.clientDeviceId);
    for (const [k, v] of Object.entries(defaults)) {
      if (!headers.has(k)) {
        headers.set(k, v);
      }
    }

    if (!headers.has("x-client-transaction-id")) {
      headers.set("x-client-transaction-id", this.transactionId());
    }

    if (!headers.has("user-agent")) {
      headers.set("user-agent", CHROME_UA);
    }

    const MAX_RETRIES = 3;
    const INITIAL_BACKOFF_MS = 1000;
    let attempt = 0;
    let res: Response;

    while (true) {
      try {
        res = await fetch(url, { ...init, headers });

        if ([502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
          attempt++;
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          if (process.env.APHRODY_X_DEBUG) {
            console.warn(
              `[request] Transient server error ${res.status}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})...`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break;
      } catch (err: any) {
        if (attempt < MAX_RETRIES) {
          attempt++;
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          if (process.env.APHRODY_X_DEBUG) {
            console.warn(
              `[request] Network error: ${err.message}, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})...`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }

    // Rotate cookies if X returns set-cookie
    let cookieRotated = false;
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const [keyval] = cookie.split(";");
      const [key, val] = keyval.split("=").map((s) => s.trim());
      if (key === "auth_token" && val && this.session.auth_token !== val) {
        this.session.auth_token = val;
        cookieRotated = true;
      } else if (key === "ct0" && val && this.session.ct0 !== val) {
        this.session.ct0 = val;
        cookieRotated = true;
      }
    }

    if (cookieRotated && this.session.filePath) {
      if (process.env.APHRODY_X_DEBUG) {
        console.log(
          `[session] Cookies rotated. Persisting updated session to ${this.session.filePath}...`
        );
      }
      this.session.save().catch((e: any) => {
        console.error(`[session] Failed to persist rotated session: ${e.message}`);
      });
    }

    this.captureRateLimit(res.headers);
    return res;
  }

  public captureRateLimit(headers: Headers): void {
    const limitStr = headers.get("x-rate-limit-limit");
    const remainingStr = headers.get("x-rate-limit-remaining");
    const resetStr = headers.get("x-rate-limit-reset");

    if (limitStr !== null && remainingStr !== null && resetStr !== null) {
      const limit = parseInt(limitStr, 10);
      const remaining = parseInt(remainingStr, 10);
      const reset_epoch = parseInt(resetStr, 10);

      if (!isNaN(limit) && !isNaN(remaining) && !isNaN(reset_epoch)) {
        this.lastRateLimit = { limit, remaining, reset_epoch };
      }
    }
  }

  private resolveQueryId(opName: string, catalogQid: string): string {
    return this.queryIds.get(opName) || catalogQid;
  }

  /** Generic GraphQL operation invoker with automatic 404/414 recovery. */
  public async graphql(
    opName: string,
    variables: any,
    extraFeatures?: any
  ): Promise<any> {
    const op = getOperation(opName);
    if (!op) {
      throw new XError(`Unknown GraphQL operation: ${opName}`, -1);
    }

    const feat = featuresFor(op);
    if (extraFeatures && typeof extraFeatures === "object") {
      Object.assign(feat, extraFeatures);
    }

    const queryId = this.resolveQueryId(opName, op.queryId);

    try {
      return await this.graphqlSend(opName, op.operationType, queryId, feat, variables);
    } catch (err: any) {
      const is404 = err instanceof XError && (err.status === 404 || err.code === 404);
      const is414 = err instanceof XError && err.status === 414;

      if (is404) {
        if (op.operationType === "query") {
          try {
            // Fallback to POST-hybrid using the same query ID
            return await this.graphqlSendQueryPost(opName, queryId, feat, variables);
          } catch (postErr: any) {
            const isPost404 = postErr instanceof XError && (postErr.status === 404 || postErr.code === 404);
            if (isPost404) {
              // pay the price of fetching query IDs live
              await this.queryIds.refresh([opName], true);
              const retryQid = this.resolveQueryId(opName, op.queryId);
              return await this.graphqlSendQueryPost(opName, retryQid, feat, variables);
            }
            throw postErr;
          }
        } else {
          // Mutation/Subscription: refresh queryIds and retry
          await this.queryIds.refresh([opName], true);
          const retryQid = this.resolveQueryId(opName, op.queryId);
          return await this.graphqlSend(opName, op.operationType, retryQid, feat, variables);
        }
      }

      if (is414 && op.operationType === "query") {
        return await this.graphqlSendQueryPost(opName, queryId, feat, variables);
      }

      throw err;
    }
  }

  private async graphqlSend(
    opName: string,
    opType: "query" | "mutation" | "subscription",
    queryId: string,
    feat: any,
    variables: any
  ): Promise<any> {
    const url = `${API_BASE}/graphql/${queryId}/${opName}`;

    let res: Response;
    if (opType === "query") {
      const queryParams = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(feat),
      });
      res = await this.request(`${url}?${queryParams.toString()}`, { method: "GET" });
    } else {
      const body = {
        variables,
        features: feat,
        queryId,
      };
      res = await this.request(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    }

    return await this.handleApiResponse(res);
  }

  private async graphqlSendQueryPost(
    opName: string,
    queryId: string,
    feat: any,
    variables: any
  ): Promise<any> {
    const url = `${API_BASE}/graphql/${queryId}/${opName}`;
    const queryParams = new URLSearchParams({
      variables: JSON.stringify(variables),
    });
    const body = {
      features: feat,
      queryId,
    };
    const res = await this.request(`${url}?${queryParams.toString()}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    return await this.handleApiResponse(res);
  }

  private async handleApiResponse(res: Response): Promise<any> {
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // ignore
    }

    if (json) {
      checkApiErrors(json);
    }

    if (!res.ok) {
      throw new XError(`HTTP ${res.status}`, -1, res.status);
    }

    return json;
  }

  /** graphql() but transparently waits out rate limit windows. */
  public async graphqlWaiting(
    opName: string,
    variables: any,
    extraFeatures?: any,
    maxWaitMs = 15 * 60 * 1000
  ): Promise<any> {
    if (this.lastRateLimit && this.lastRateLimit.remaining === 0) {
      const now = Math.floor(Date.now() / 1000);
      const waitSecs = Math.max(this.lastRateLimit.reset_epoch - now, 0);
      const waitMs = waitSecs * 1000;

      if (waitMs > maxWaitMs) {
        throw new XError(
          `Rate limited until epoch ${this.lastRateLimit.reset_epoch} (maxWait exceeded)`,
          88
        );
      }

      if (waitMs > 0) {
        if (process.env.APHRODY_X_DEBUG) {
          console.error(`[rate-limit] Remaining is 0, waiting ${waitSecs}s until reset epoch...`);
        }
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    return await this.graphql(opName, variables, extraFeatures);
  }

  // -------------------------------------------------------------------------
  // High-level API implementation
  // -------------------------------------------------------------------------

  public async createTweet(text: string, replyTo?: string): Promise<TweetResult> {
    return this.createTweetWithMedia(text, replyTo, []);
  }

  public async createTweetWithMedia(
    text: string,
    replyTo?: string,
    mediaIds: string[] = []
  ): Promise<TweetResult> {
    const extraFeatures = { ...CREATE_TWEET_FEATURES_KNOWN_GOOD };

    const mediaEntities = mediaIds.map((id) => ({
      media_id: id,
      tagged_users: [],
    }));

    const variables: any = {
      tweet_text: text,
      dark_request: false,
      media: {
        media_entities: mediaEntities,
        possibly_sensitive: false,
      },
      semantic_annotation_ids: [],
    };

    if (replyTo) {
      variables.reply = {
        in_reply_to_tweet_id: replyTo,
        exclude_reply_user_ids: [],
      };
    }

    try {
      const json = await this.graphql("CreateTweet", variables, extraFeatures);
      const result = json?.data?.create_tweet?.tweet_results?.result;
      if (!result) {
        throw new XError("CreateTweet response missing data.create_tweet.tweet_results.result", -1);
      }

      const id = result.rest_id || "";
      const fullText = result.legacy?.full_text || text;
      return { id, text: fullText };
    } catch (err: any) {
      if (err instanceof XError && err.code === 226) {
        return await this.createTweetRest(text, replyTo);
      }
      throw err;
    }
  }

  public async createTweetRest(text: string, replyTo?: string): Promise<TweetResult> {
    const url = `${API_BASE}/1.1/statuses/update.json`;
    const form = new URLSearchParams();
    form.append("status", text);
    form.append("tweet_mode", "extended");
    if (replyTo) {
      form.append("in_reply_to_status_id", replyTo);
      form.append("auto_populate_reply_metadata", "true");
    }

    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-client-transaction-id": crypto.randomUUID().replace(/-/g, ""),
      },
    });

    const json = await this.handleApiResponse(res);
    const id = json?.id_str || "";
    const fullText = json?.full_text || json?.text || text;
    return { id, text: fullText };
  }

  public async deleteTweet(id: string): Promise<void> {
    const variables = {
      tweet_id: id,
      dark_request: false,
    };
    const json = await this.graphql("DeleteTweet", variables);
    checkApiErrors(json);
  }

  public async like(tweetId: string): Promise<void> {
    const json = await this.graphql("FavoriteTweet", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async unlike(tweetId: string): Promise<void> {
    const json = await this.graphql("UnfavoriteTweet", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async retweet(tweetId: string): Promise<void> {
    const json = await this.graphql("CreateRetweet", { tweet_id: tweetId, dark_request: false });
    checkApiErrors(json);
  }

  public async unretweet(tweetId: string): Promise<void> {
    const json = await this.graphql("DeleteRetweet", { source_tweet_id: tweetId, dark_request: false });
    checkApiErrors(json);
  }

  public async bookmark(tweetId: string): Promise<void> {
    const json = await this.graphql("CreateBookmark", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async unbookmark(tweetId: string): Promise<void> {
    const json = await this.graphql("DeleteBookmark", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async pinTweet(tweetId: string): Promise<void> {
    const json = await this.graphql("PinTweet", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async unpinTweet(tweetId: string): Promise<void> {
    const json = await this.graphql("UnpinTweet", { tweet_id: tweetId });
    checkApiErrors(json);
  }

  public async noteTweet(tweetText: string | null, noteText: string): Promise<TweetResult> {
    const preview = tweetText || Array.from(noteText).slice(0, 280).join("");
    const variables = {
      tweet_text: preview,
      dark_request: false,
      media: {
        media_entities: [],
        possibly_sensitive: false,
      },
      semantic_annotation_ids: [],
      note_tweet: {
        note_tweet_richtext: {
          text: noteText,
          entities: [],
        },
        media_entities: [],
      },
    };

    const json = await this.graphql("CreateNoteTweet", variables);
    const result =
      json?.data?.notetweet_create?.tweet_results?.result ||
      json?.data?.create_tweet?.tweet_results?.result;
    if (!result) {
      throw new XError("CreateNoteTweet response missing tweet_results.result", -1);
    }

    const id = result.rest_id || "";
    const textOut = result.legacy?.full_text || preview;
    return { id, text: textOut };
  }

  public async follow(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/friendships/create.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async unfollow(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/friendships/destroy.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async block(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/blocks/create.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async unblock(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/blocks/destroy.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async mute(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/mutes/users/create.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async unmute(userId: string): Promise<void> {
    const url = `${API_BASE}/1.1/mutes/users/destroy.json`;
    const form = new URLSearchParams();
    form.append("user_id", userId);
    const res = await this.request(url, {
      method: "POST",
      body: form.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    await this.handleApiResponse(res);
  }

  public async userByScreenName(handle: string): Promise<UserInfo> {
    const variables = {
      screen_name: handle,
      withSafetyModeUserFields: true,
    };

    const json = await this.graphqlWaiting("UserByScreenName", variables);
    const result = json?.data?.user?.result;
    if (!result) {
      throw new XError("UserByScreenName response missing data.user.result", -1);
    }
    const legacy = result.legacy || {};
    const core = result.core || {};

    const id = result.rest_id || "";
    const name = core.name || legacy.name || "";
    const screen_name = core.screen_name || legacy.screen_name || handle;
    const followers_count = legacy.followers_count;
    const friends_count = legacy.friends_count;

    return { id, name, screen_name, followers_count, friends_count };
  }

  public async homeTimeline(count: number): Promise<TimelineTweet[]> {
    const variables = {
      count,
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: "launch",
    };
    const json = await this.graphql("HomeTimeline", variables);
    const tweets: TimelineTweet[] = [];

    const instructions = json?.data?.home?.home_timeline_urt?.instructions;
    if (Array.isArray(instructions)) {
      for (const instruction of instructions) {
        if (Array.isArray(instruction.entries)) {
          for (const entry of instruction.entries) {
            const result = entry.content?.itemContent?.tweet_results?.result;
            if (result) {
              const id = result.rest_id || "";
              const text = result.legacy?.full_text || "";
              if (id) {
                tweets.push({ id, text });
              }
            }
          }
        }
      }
    }
    return tweets;
  }

  public async sendDm(recipientId: string, text: string): Promise<void> {
    const url = `${API_BASE}/1.1/dm/new2.json`;
    const body = {
      conversation_id: `${recipientId}-${recipientId}`,
      recipient_ids: false,
      request_id: crypto.randomUUID().replace(/-/g, ""),
      text,
      cards_platform: "Web-12",
      include_cards: 1,
      include_quote_count: true,
      dm_users: false,
    };

    const res = await this.request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    await this.handleApiResponse(res);
  }

  public async timelineTweets(op: string, variables: any, quoteDepth?: number): Promise<TweetPage> {
    const json = await this.graphqlWaiting(op, variables);
    return walkTimelineTweets(json, quoteDepth);
  }

  public async timelineUsers(op: string, variables: any): Promise<UserPage> {
    const json = await this.graphqlWaiting(op, variables);
    return walkTimelineUsers(json);
  }

  public async userIdFor(handle: string): Promise<string> {
    const info = await this.userByScreenName(handle);
    if (!info.id) {
      throw new XError(`Could not resolve user id for @${handle}`, -1);
    }
    return info.id;
  }

  public async getTweet(tweetId: string, quoteDepth?: number): Promise<Tweet | null> {
    const json = await this.tweetDetailRaw(tweetId);
    const page = walkTimelineTweets(json, quoteDepth);
    return page.tweets.find((t) => t.id === tweetId) || null;
  }

  public async thread(tweetId: string, cursor?: string, quoteDepth?: number): Promise<TweetPage> {
    const json = await this.tweetDetailRaw(tweetId, cursor);
    return walkTimelineTweets(json, quoteDepth);
  }

  public async tweetDetailRaw(tweetId: string, cursor?: string): Promise<any> {
    const variables: any = {
      focalTweetId: tweetId,
      with_rux_injections: false,
      includePromotedContent: false,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.graphqlWaiting("TweetDetail", variables);
  }

  public async search(
    query: string,
    count: number,
    cursor?: string,
    product = "Latest",
    quoteDepth?: number
  ): Promise<TweetPage> {
    const variables: any = {
      rawQuery: query,
      count,
      querySource: "typed_query",
      product,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets("SearchTimeline", variables, quoteDepth);
  }

  public async userTweets(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number
  ): Promise<TweetPage> {
    const variables: any = {
      userId,
      count,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets("UserTweets", variables, quoteDepth);
  }

  public async home(
    count: number,
    cursor?: string,
    latest = false,
    quoteDepth?: number
  ): Promise<TweetPage> {
    const op = latest ? "HomeLatestTimeline" : "HomeTimeline";
    const variables: any = {
      count,
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: "launch",
      seenTweetIds: [],
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets(op, variables, quoteDepth);
  }

  public async likes(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number
  ): Promise<TweetPage> {
    const variables: any = {
      userId,
      count,
      includePromotedContent: false,
      withClientEventToken: false,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets("Likes", variables, quoteDepth);
  }

  public async bookmarks(count: number, cursor?: string, quoteDepth?: number): Promise<TweetPage> {
    const variables: any = {
      count,
      includePromotedContent: false,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets("Bookmarks", variables, quoteDepth);
  }

  public async following(userId: string, count: number, cursor?: string): Promise<UserPage> {
    const variables: any = {
      userId,
      count,
      includePromotedContent: false,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineUsers("Following", variables);
  }

  public async followers(userId: string, count: number, cursor?: string): Promise<UserPage> {
    const variables: any = {
      userId,
      count,
      includePromotedContent: false,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineUsers("Followers", variables);
  }

  public async listTimeline(
    listId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number
  ): Promise<TweetPage> {
    const variables: any = {
      listId,
      count,
    };
    if (cursor) {
      variables.cursor = cursor;
    }
    return await this.timelineTweets("ListLatestTweetsTimeline", variables, quoteDepth);
  }

  public async lists(userId: string, memberOf: boolean, count: number): Promise<ListInfo[]> {
    const op = memberOf ? "ListMemberships" : "ListOwnerships";
    const variables = {
      userId,
      count,
      isListMemberTargetUserId: false,
    };
    const json = await this.graphql(op, variables, { ...DEFAULT_FEATURES });
    return parseLists(json);
  }

  public async whoami(): Promise<UserInfo> {
    const variables = {
      withCommunitiesMemberships: false,
    };
    const json = await this.graphql("Viewer", variables);
    const result =
      json?.data?.viewer?.user_results?.result ||
      json?.data?.viewer_v2?.user_results?.result;
    if (!result) {
      throw new XError("Viewer response missing user_results.result", -1);
    }

    const core = result.core || {};
    const legacy = result.legacy || {};

    const id = result.rest_id || "";
    const name = core.name || legacy.name || "";
    const screen_name = core.screen_name || legacy.screen_name || "";

    return {
      id,
      name,
      screen_name,
      followers_count: legacy.followers_count,
      friends_count: legacy.friends_count,
    };
  }

  public async uploadMedia(filePath: string, alt?: string): Promise<string> {
    return await uploadMedia(this, filePath, alt);
  }

  public async getNews(count: number, options?: NewsOptions): Promise<NewsItem[]> {
    return await getNews(this, count, options);
  }
}

function parseLists(root: any): ListInfo[] {
  const out: ListInfo[] = [];
  const stack: any[] = [root];

  while (stack.length > 0) {
    const v = stack.pop();
    if (v && typeof v === "object") {
      if (Array.isArray(v)) {
        stack.push(...v);
      } else {
        if (
          typeof v.id_str === "string" &&
          typeof v.name === "string" &&
          ("member_count" in v || "mode" in v || "subscriber_count" in v)
        ) {
          out.push({
            id: v.id_str,
            name: v.name,
            member_count: typeof v.member_count === "number" ? v.member_count : undefined,
            subscriber_count: typeof v.subscriber_count === "number" ? v.subscriber_count : undefined,
            mode: typeof v.mode === "string" ? v.mode : undefined,
          });
        }
        stack.push(...Object.values(v));
      }
    }
  }

  const seen = new Set<string>();
  return out.filter((l) => {
    if (seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}
