// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { statSync, existsSync } from "node:fs";
import { Glob } from "bun";
import type { Tweet } from "../core/parse";
import { Store } from "./store";

/** Locate the tweets file inside an archive directory or accept a direct path. */
export function resolveTweetsFile(input: string): string | null {
  if (!existsSync(input)) return null;

  try {
    const stat = statSync(input);
    if (stat.isFile()) {
      return input;
    }

    const relatives = ["data/tweets.js", "data/tweet.js", "tweets.js", "tweet.js"];
    for (const rel of relatives) {
      const candidate = join(input, rel);
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate;
      }
    }

    // Try a recursive glob scan for robustness
    const glob = new Glob("**/{tweets,tweet}.js");
    for (const file of glob.scanSync(input)) {
      const full = join(input, file);
      if (statSync(full).isFile()) {
        return full;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/** Strip the window.YTD.* assignment prefix and parse the JSON array. */
export function parseArchiveArray(raw: string): any[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Archive file has no JSON array or delimiters are inverted");
  }
  const slice = raw.substring(start, end + 1);
  return JSON.parse(slice);
}

function countField(legacy: any, key: string): number {
  const val = legacy?.[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = parseInt(val, 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/** Convert one archive element into a Tweet structure. */
export function archiveTweetToTweet(elem: any, owner: { username: string; name: string }): Tweet | null {
  const legacy = elem.tweet || elem;
  const id = legacy.id_str;
  if (!id) return null;

  const text = legacy.full_text || legacy.text || "";

  return {
    id,
    text,
    author: owner,
    author_id: undefined,
    created_at: legacy.created_at || undefined,
    reply_count: countField(legacy, "reply_count"),
    retweet_count: countField(legacy, "retweet_count"),
    like_count: countField(legacy, "favorite_count") || countField(legacy, "like_count"),
    quote_count: countField(legacy, "quote_count"),
    view_count: undefined,
    conversation_id: legacy.conversation_id_str || undefined,
    in_reply_to_status_id: legacy.in_reply_to_status_id_str || undefined,
    lang: legacy.lang || undefined,
    is_note_tweet: false,
    quoted_tweet: null,
  };
}

/** Import a tweets archive into the SQLite store. */
export async function importArchive(
  store: Store,
  path: string,
  ownerHandle: string
): Promise<number> {
  const file = resolveTweetsFile(path);
  if (!file) {
    throw new Error(`No tweets.js or tweet.js found at ${path}`);
  }

  // Use high-performance native Bun.file reader
  const raw = await Bun.file(file).text();
  const arr = parseArchiveArray(raw);

  const cleanHandle = ownerHandle.replace(/^@/, "");
  const owner = {
    username: cleanHandle,
    name: cleanHandle,
  };

  let imported = 0;
  for (const elem of arr) {
    const tweet = archiveTweetToTweet(elem, owner);
    if (tweet) {
      store.upsertTweet(tweet);
      store.addEdge(owner.username, "authored", tweet.id);
      imported++;
    }
  }

  return imported;
}
