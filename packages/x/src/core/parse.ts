// SPDX-License-Identifier: Apache-2.0
import { TweetSchema, UserSchema, type Author, type Tweet, type User } from "./schemas";

export { type Author, type Tweet, type User };

export interface TweetPage {
  tweets: Tweet[];
  next_cursor?: string;
}

export interface UserPage {
  users: User[];
  next_cursor?: string;
}

const DEFAULT_QUOTE_DEPTH = 1;

export class XError extends Error {
  public code: number;
  public status?: number;

  constructor(message: string, code: number, status?: number) {
    super(message);
    this.name = "XError";
    this.code = code;
    this.status = status;
  }
}

/** Extract structured X API errors from a response body and throw if present. */
export function checkApiErrors(body: any): void {
  if (body?.errors && Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const code = typeof first.code === "number" ? first.code : -1;
    const message = first.message || "unknown error";
    throw new XError(`X API error ${code}: ${message}`, code);
  }
}

/** Unwrap tweet results, handling visibility wrapper */
function unwrapTweetResult(result: any): any {
  if (!result) return null;
  const typename = result.__typename;
  if (typename === "TweetWithVisibilityResults") {
    return result.tweet;
  }
  if (typename === "TweetTombstone") {
    return null;
  }
  if (result.legacy || result.rest_id) {
    return result;
  }
  if (vTypeObject(result.tweet)) {
    return result.tweet;
  }
  return null;
}

function vTypeObject(v: any): boolean {
  return typeof v === "object" && v !== null;
}

function extractAuthor(userResult: any): Author {
  if (!userResult) {
    return { username: "", name: "" };
  }
  const core = userResult.core;
  const legacy = userResult.legacy;

  const name = core?.name || legacy?.name || "";
  const username = core?.screen_name || legacy?.screen_name || "";
  return { username, name };
}

function extractNoteText(tweet: any): string | null {
  return tweet?.note_tweet?.note_tweet_results?.result?.text || null;
}

function countNumber(legacy: any, key: string): number {
  const val = legacy?.[key];
  return typeof val === "number" ? val : 0;
}

/** Parse a tweet_results.result node into a Tweet. */
export function parseTweetResult(result: any, quoteDepth = DEFAULT_QUOTE_DEPTH): Tweet | null {
  const tweet = unwrapTweetResult(result);
  if (!tweet) return null;

  const legacy = tweet.legacy;
  if (!legacy) return null;

  const id = tweet.rest_id || legacy.id_str || "";
  if (!id) return null;

  const noteText = extractNoteText(tweet);
  const is_note_tweet = noteText !== null;
  const text = noteText !== null ? noteText : (legacy.full_text || "");

  const author = extractAuthor(tweet.core?.user_results?.result);
  const author_id = legacy.user_id_str || undefined;

  let view_count: number | undefined;
  const vc = tweet.views?.count;
  if (vc) {
    const num = parseInt(vc, 10);
    if (!isNaN(num)) {
      view_count = num;
    }
  }

  let quoted_tweet: Tweet | null = null;
  if (quoteDepth > 0 && tweet.quoted_status_result?.result) {
    quoted_tweet = parseTweetResult(tweet.quoted_status_result.result, quoteDepth - 1);
  }

  const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
  const media = mediaEntities.map((m: any) => {
    const preview_url = m.media_url_https || m.media_url;

    let video_url: string | undefined;
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = m.video_info?.variants;
      if (Array.isArray(variants)) {
        const mp4 = variants
          .filter((v: any) => v?.content_type === "video/mp4")
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        video_url = mp4?.url || undefined;
      }
    }

    const width = m.original_info?.width;
    const height = m.original_info?.height;

    return {
      id: m.id_str,
      type: m.type,
      url: video_url ?? preview_url,
      preview_url,
      video_url,
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
      expanded_url: m.expanded_url,
    };
  });

  const obj = {
    id,
    text,
    author,
    author_id,
    created_at: legacy.created_at || undefined,
    reply_count: countNumber(legacy, "reply_count"),
    retweet_count: countNumber(legacy, "retweet_count"),
    like_count: countNumber(legacy, "favorite_count"),
    quote_count: countNumber(legacy, "quote_count"),
    view_count,
    conversation_id: legacy.conversation_id_str || undefined,
    in_reply_to_status_id: legacy.in_reply_to_status_id_str || undefined,
    lang: legacy.lang || undefined,
    is_note_tweet,
    quoted_tweet,
    media,
  };

  try {
    return TweetSchema.parse(obj);
  } catch (err: any) {
    if (process.env.APHRODY_X_DEBUG) {
      console.error(`[parse] Tweet schema validation failed for ID ${id}:`, err);
    }
    return null;
  }
}

/** Recursively collect every `instructions` array in the JSON tree. */
function findInstructionArrays(root: any, out: any[]): void {
  if (!vTypeObject(root)) return;

  if (Array.isArray(root)) {
    for (const item of root) {
      findInstructionArrays(item, out);
    }
    return;
  }

  for (const [k, v] of Object.entries(root)) {
    if (k === "instructions" && Array.isArray(v)) {
      out.push(v);
    }
    findInstructionArrays(v, out);
  }
}

/** Walk a timeline entry's content, pushing tweets and setting cursor. */
function walkEntryContent(
  content: any,
  quoteDepth: number,
  tweets: Tweet[],
  cursorRef: { bottom?: string }
): void {
  if (!vTypeObject(content)) return;

  const entryType = content.entryType || content.__typename || "";

  switch (entryType) {
    case "TimelineTimelineItem": {
      const result = content.itemContent?.tweet_results?.result;
      if (result) {
        const t = parseTweetResult(result, quoteDepth);
        if (t) tweets.push(t);
      }
      break;
    }
    case "TimelineTimelineCursor": {
      const cursorType = content.cursorType || "";
      if (cursorType === "Bottom" && typeof content.value === "string") {
        cursorRef.bottom = content.value;
      }
      break;
    }
    case "TimelineTimelineModule": {
      const items = content.items;
      if (Array.isArray(items)) {
        for (const item of items) {
          const ic = item?.item?.itemContent;
          if (ic) {
            const result = ic.tweet_results?.result;
            if (result) {
              const t = parseTweetResult(result, quoteDepth);
              if (t) tweets.push(t);
            }
            if (ic.cursorType === "Bottom" && typeof ic.value === "string") {
              cursorRef.bottom = ic.value;
            }
          }
        }
      }
      break;
    }
  }
}

/** Walk a timeline response and extract all tweets and the bottom cursor. */
export function walkTimelineTweets(root: any, quoteDepth = DEFAULT_QUOTE_DEPTH): TweetPage {
  const instructionSets: any[][] = [];
  findInstructionArrays(root, instructionSets);

  const tweets: Tweet[] = [];
  const cursorRef: { bottom?: string } = {};

  for (const arr of instructionSets) {
    for (const instruction of arr) {
      // TimelineAddEntries / TimelineAddToModule
      if (Array.isArray(instruction.entries)) {
        for (const entry of instruction.entries) {
          if (entry.content) {
            walkEntryContent(entry.content, quoteDepth, tweets, cursorRef);
          }
        }
      }
      // TimelineReplaceEntry
      if (instruction.entry?.content) {
        walkEntryContent(instruction.entry.content, quoteDepth, tweets, cursorRef);
      }
    }
  }

  return {
    tweets,
    next_cursor: cursorRef.bottom,
  };
}

/** Parse a user_results.result node into a User. */
export function parseUserResult(result: any): User | null {
  if (!result) return null;
  const id = result.rest_id || result.legacy?.id_str || "";
  if (!id) return null;

  const author = extractAuthor(result);
  if (!author.username) return null;

  const legacy = result.legacy;
  const description = legacy?.description || undefined;
  const followers_count = typeof legacy?.followers_count === "number" ? legacy.followers_count : undefined;
  const following_count = typeof legacy?.friends_count === "number" ? legacy.friends_count : undefined;
  const is_blue_verified = typeof result.is_blue_verified === "boolean" ? result.is_blue_verified : undefined;
  const profile_image_url = legacy?.profile_image_url_https || result.avatar?.image_url || undefined;
  const created_at = legacy?.created_at || result.core?.created_at || undefined;

  const obj = {
    id,
    username: author.username,
    name: author.name,
    description,
    followers_count,
    following_count,
    is_blue_verified,
    profile_image_url,
    created_at,
  };

  try {
    return UserSchema.parse(obj);
  } catch (err: any) {
    if (process.env.APHRODY_X_DEBUG) {
      console.error(`[parse] User schema validation failed for ID ${id}:`, err);
    }
    return null;
  }
}

/** Walk a user list timeline and extract all users and the bottom cursor. */
export function walkTimelineUsers(root: any): UserPage {
  const instructionSets: any[][] = [];
  findInstructionArrays(root, instructionSets);

  const users: User[] = [];
  const cursorRef: { bottom?: string } = {};

  for (const arr of instructionSets) {
    for (const instruction of arr) {
      if (Array.isArray(instruction.entries)) {
        for (const entry of instruction.entries) {
          const content = entry.content;
          if (!vTypeObject(content)) continue;

          const entryType = content.entryType || "";
          if (entryType === "TimelineTimelineCursor") {
            if (content.cursorType === "Bottom" && typeof content.value === "string") {
              cursorRef.bottom = content.value;
            }
            continue;
          }

          const result = content.itemContent?.user_results?.result;
          if (result) {
            const u = parseUserResult(result);
            if (u) users.push(u);
          }
        }
      }
    }
  }

  return {
    users,
    next_cursor: cursorRef.bottom,
  };
}

/** Helper: find a single tweet by its id from a response tree. */
export function parseSingleTweet(root: any, tweetId: string): Tweet | null {
  const page = walkTimelineTweets(root, DEFAULT_QUOTE_DEPTH);
  return page.tweets.find((t) => t.id === tweetId) || null;
}
