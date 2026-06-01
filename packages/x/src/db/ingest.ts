// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { walkTimelineTweets, walkTimelineUsers, parseUserResult } from "../core/parse";
import type { Store } from "./store";
import type { Tweet, User } from "../core/schemas";

export interface IngestStats {
  tweetsIngested: number;
  usersIngested: number;
  communitiesIngested: number;
}

/**
 * Recursively find and upsert all users in any JSON structure.
 */
export function findAndUpsertUsers(root: any, store: Store): number {
  let count = 0;

  function walk(val: any) {
    if (!val || typeof val !== "object") return;
    if (Array.isArray(val)) {
      for (const item of val) {
        walk(item);
      }
      return;
    }
    if (val.__typename === "User" || val.screen_name || val.screen_name_private) {
      const u = parseUserResult(val);
      if (u) {
        store.upsertUser(u);
        count++;
      }
    }
    for (const key of Object.keys(val)) {
      walk(val[key]);
    }
  }

  walk(root);
  return count;
}

/**
 * Reads and ingests Beyblade X scraper JSON output (typically beyblade_data.json)
 * into the given SQLite Store.
 */
export async function ingestBeybladeData(filePath: string, store: Store): Promise<IngestStats> {
  if (!existsSync(filePath)) {
    throw new Error(`Data file not found at ${filePath}`);
  }

  const file = Bun.file(filePath);
  const content = await file.text();
  const db = JSON.parse(content);

  let tweetsIngested = 0;
  let usersIngested = 0;
  let communitiesIngested = 0;

  // 1. Ingest Users
  const users = db.users || {};
  for (const [key, u] of Object.entries(users)) {
    if (!u || typeof u !== "object") continue;
    const rawUser = u as any;
    const user: User = {
      id: rawUser.id || key,
      username: rawUser.screen_name || rawUser.username || key,
      name: rawUser.name || rawUser.screen_name || key,
      description: rawUser.description || undefined,
      followers_count: typeof rawUser.followers_count === "number" ? rawUser.followers_count : undefined,
      following_count: typeof rawUser.friends_count === "number" ? rawUser.friends_count : (typeof rawUser.following_count === "number" ? rawUser.following_count : undefined),
      is_blue_verified: typeof rawUser.is_blue_verified === "boolean" ? rawUser.is_blue_verified : undefined,
      profile_image_url: rawUser.profile_image_url || undefined,
      created_at: rawUser.created_at || undefined,
    };
    store.upsertUser(user);
    usersIngested++;
  }

  // 2. Ingest Tweets
  const tweets = db.tweets || {};
  for (const [key, t] of Object.entries(tweets)) {
    if (!t || typeof t !== "object") continue;
    const rawTweet = t as any;
    const authorUsername = rawTweet.author || "";
    const tweet: Tweet = {
      id: rawTweet.id || key,
      text: rawTweet.text || "",
      author: {
        username: authorUsername,
        name: rawTweet.author_name || authorUsername,
      },
      author_id: rawTweet.author_id || undefined,
      created_at: rawTweet.created_at || undefined,
      reply_count: typeof rawTweet.reply_count === "number" ? rawTweet.reply_count : 0,
      retweet_count: typeof rawTweet.retweet_count === "number" ? rawTweet.retweet_count : 0,
      like_count: typeof rawTweet.like_count === "number" ? rawTweet.like_count : 0,
      quote_count: typeof rawTweet.quote_count === "number" ? rawTweet.quote_count : 0,
      view_count: typeof rawTweet.view_count === "number" ? rawTweet.view_count : undefined,
      conversation_id: rawTweet.conversation_id || undefined,
      in_reply_to_status_id: rawTweet.in_reply_to_status_id || rawTweet.in_reply_to || undefined,
      lang: rawTweet.lang || undefined,
      is_note_tweet: typeof rawTweet.is_note_tweet === "boolean" ? rawTweet.is_note_tweet : false,
    };
    store.upsertTweet(tweet);
    if (authorUsername) {
      store.addEdge(authorUsername, "authored", tweet.id);
    }
    tweetsIngested++;
  }

  // 3. Ingest Communities and their raw responses
  const communities = db.communities || {};
  for (const [commId, c] of Object.entries(communities)) {
    if (!c || typeof c !== "object") continue;
    const rawComm = c as any;
    communitiesIngested++;

    if (rawComm.raw_response) {
      try {
        const page = walkTimelineTweets(rawComm.raw_response);
        for (const t of page.tweets) {
          store.upsertTweet(t);
          store.addEdge(t.author.username, "authored", t.id);
          store.addEdge(`community_${commId}`, "timeline", t.id);
          tweetsIngested++;
        }
        // Ingest users recursively from response
        const recursivelyFound = findAndUpsertUsers(rawComm.raw_response, store);
        usersIngested += recursivelyFound;

        // Also do standard user list timeline walk
        const userPage = walkTimelineUsers(rawComm.raw_response);
        for (const u of userPage.users) {
          store.upsertUser(u);
          usersIngested++;
        }
      } catch (err: any) {
        if (process.env.APHRODY_X_DEBUG) {
          console.error(`[ingest] Failed to parse raw response for community ${commId}:`, err);
        }
      }
    }
  }

  return {
    tweetsIngested,
    usersIngested,
    communitiesIngested,
  };
}
