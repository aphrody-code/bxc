// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { XClient } from "./src/core/client";
import { WINDOW_MS, readWithBackoff, type ReadRetryDeps } from "./src/services/purge-engine";
import { XError } from "./src/core/parse";
import type { Tweet } from "./src/core/parse";
import {
  buildTweetQueue,
  captureArchive,
  classifyPost,
  loadTweetState,
  purgeTweets,
  type PurgeTweetsOptions,
  type TweetPurgeState,
} from "./src/services/purge-tweets";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;
const VIEWER = "viewer-1";

function fakeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += Math.max(ms, 0);
    },
  };
}

interface PostInit {
  id: string;
  likes?: number;
  authorId?: string;
  replyTo?: string;
  media?: boolean;
  createdAt?: string;
  text?: string;
}

function post(init: PostInit): Tweet {
  return {
    id: init.id,
    text: init.text ?? `post ${init.id}`,
    author: { username: "tester", name: "Tester" },
    author_id: init.authorId ?? VIEWER,
    created_at: init.createdAt,
    reply_count: 0,
    retweet_count: 0,
    like_count: init.likes ?? 0,
    quote_count: 0,
    is_note_tweet: false,
    in_reply_to_status_id: init.replyTo,
    media: init.media ? [{ type: "photo" }] : undefined,
  } as Tweet;
}

interface FakeOpts {
  tweets?: Tweet[];
  replies?: Tweet[];
  media?: Tweet[];
  /** Per-post-id errors, consumed one per call. */
  errors?: Record<string, Error[]>;
  pageSize?: number;
}

/** Minimal XClient stand-in: three paginated timelines + recorded mutations. */
function fakeClient(opts: FakeOpts) {
  const pageSize = opts.pageSize ?? 100;
  const deleted: string[] = [];
  const unretweeted: string[] = [];
  const errors: Record<string, Error[]> = {};
  for (const [k, v] of Object.entries(opts.errors ?? {})) errors[k] = [...v];

  const paginate = (all: Tweet[], cursor?: string) => {
    const offset = cursor ? parseInt(cursor.replace("c-", ""), 10) : 0;
    const next = offset + pageSize;
    return {
      tweets: all.slice(offset, offset + pageSize),
      next_cursor: next < all.length ? `c-${next}` : undefined,
    };
  };

  const consume = (id: string) => {
    const queued = errors[id];
    if (queued && queued.length > 0) throw queued.shift();
  };

  const client = {
    session: { handle: "tester" },
    lastRateLimit: null as null | { limit: number; remaining: number; reset_epoch: number },
    whoami: async () => ({ id: VIEWER, name: "Tester", screen_name: "tester" }),
    userTweets: async (_id: string, _n: number, cursor?: string) =>
      paginate(opts.tweets ?? [], cursor),
    userTweetsAndReplies: async (_id: string, _n: number, cursor?: string) =>
      paginate(opts.replies ?? [], cursor),
    userMedia: async (_id: string, _n: number, cursor?: string) =>
      paginate(opts.media ?? [], cursor),
    deleteTweet: async (id: string) => {
      deleted.push(id);
      consume(id);
    },
    unretweet: async (id: string) => {
      unretweeted.push(id);
      consume(id);
    },
  };

  return { client: client as unknown as XClient, deleted, unretweeted, raw: client };
}

function baseOpts(clock: ReturnType<typeof fakeClock>): PurgeTweetsOptions {
  return { persist: false, now: clock.now, sleep: clock.sleep, random: () => 0 };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classifyPost", () => {
  test("a plain post is a tweet", () => {
    expect(classifyPost(post({ id: "1" }), VIEWER)).toBe("tweet");
  });

  test("in_reply_to_status_id makes it a reply", () => {
    expect(classifyPost(post({ id: "1", replyTo: "99" }), VIEWER)).toBe("reply");
  });

  test("media attachments make it a media post", () => {
    expect(classifyPost(post({ id: "1", media: true }), VIEWER)).toBe("media");
  });

  test("a foreign author can only mean a retweet", () => {
    expect(classifyPost(post({ id: "1", authorId: "someone-else" }), VIEWER)).toBe("retweet");
  });

  test("reply wins over media when a reply carries an image", () => {
    expect(classifyPost(post({ id: "1", replyTo: "99", media: true }), VIEWER)).toBe("reply");
  });

  test("retweet wins over everything — you do not own the post", () => {
    const rt = post({ id: "1", authorId: "other", replyTo: "99", media: true });
    expect(classifyPost(rt, VIEWER)).toBe("retweet");
  });
});

// ---------------------------------------------------------------------------
// Queue selection
// ---------------------------------------------------------------------------

describe("buildTweetQueue", () => {
  test("keeps posts at or above the threshold, queues the rest", () => {
    const posts = [
      post({ id: "a", likes: 5 }),
      post({ id: "b", likes: 999 }),
      post({ id: "c", likes: 1000 }),
      post({ id: "d", likes: 5000 }),
    ];
    const { queue, kept } = buildTweetQueue(posts, VIEWER, { maxLikes: 1000 });

    expect(queue.map((t) => t.id)).toEqual(["a", "b"]);
    expect(kept).toBe(2); // 1000 is "at" the threshold → kept
  });

  test("orders least-liked first", () => {
    const posts = [
      post({ id: "a", likes: 40 }),
      post({ id: "b", likes: 0 }),
      post({ id: "c", likes: 7 }),
    ];
    const { queue } = buildTweetQueue(posts, VIEWER, { maxLikes: 1000 });
    expect(queue.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(queue.map((t) => t.like_count)).toEqual([0, 7, 40]);
  });

  test("equal likes break the tie on the oldest post", () => {
    const posts = [
      post({ id: "new", likes: 3, createdAt: "Wed Aug 20 12:00:00 +0000 2026" }),
      post({ id: "old", likes: 3, createdAt: "Wed Aug 20 08:00:00 +0000 2025" }),
    ];
    const { queue } = buildTweetQueue(posts, VIEWER, { maxLikes: 1000 });
    expect(queue.map((t) => t.id)).toEqual(["old", "new"]);
  });

  test("covers tweets, replies and media by default", () => {
    const posts = [
      post({ id: "t" }),
      post({ id: "r", replyTo: "99" }),
      post({ id: "m", media: true }),
    ];
    const { queue, byKind } = buildTweetQueue(posts, VIEWER, {});
    expect(queue).toHaveLength(3);
    expect(byKind).toMatchObject({ tweet: 1, reply: 1, media: 1, retweet: 0 });
  });

  test("retweets are out of scope unless asked for", () => {
    const posts = [post({ id: "t" }), post({ id: "rt", authorId: "other", likes: 50_000 })];

    const off = buildTweetQueue(posts, VIEWER, {});
    expect(off.queue.map((t) => t.id)).toEqual(["t"]);
    expect(off.kept).toBe(1);

    // A retweet's likes belong to someone else, so the threshold cannot apply:
    // scope alone decides, even at 50k likes.
    const on = buildTweetQueue(posts, VIEWER, { includeRetweets: true });
    expect(on.queue.map((t) => t.id).sort()).toEqual(["rt", "t"]);
  });

  test("kinds narrows the scope", () => {
    const posts = [
      post({ id: "t" }),
      post({ id: "r", replyTo: "99" }),
      post({ id: "m", media: true }),
    ];
    const { queue } = buildTweetQueue(posts, VIEWER, { kinds: ["reply"] });
    expect(queue.map((t) => t.id)).toEqual(["r"]);
  });

  test("protected ids are never queued", () => {
    const posts = [post({ id: "pinned" }), post({ id: "other" })];
    const { queue, kept } = buildTweetQueue(posts, VIEWER, { protectIds: ["pinned"] });
    expect(queue.map((t) => t.id)).toEqual(["other"]);
    expect(kept).toBe(1);
  });

  test("a missing like count is treated as zero, not as unknown", () => {
    const p = post({ id: "x" });
    delete (p as { like_count?: number }).like_count;
    const { queue } = buildTweetQueue([p], VIEWER, { maxLikes: 1 });
    expect(queue).toHaveLength(1);
    expect(queue[0].like_count).toBe(0);
  });

  test("preview is flattened and truncated", () => {
    const p = post({ id: "x", text: `word ${"y".repeat(200)}` });
    const { queue } = buildTweetQueue([p], VIEWER, {});
    expect(queue[0].preview.length).toBeLessThanOrEqual(80);
    expect(queue[0].preview.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Archive collection
// ---------------------------------------------------------------------------

describe("captureArchive", () => {
  test("merges the three timelines and dedupes by id", async () => {
    const shared = post({ id: "dup", media: true });
    const { client } = fakeClient({
      tweets: [post({ id: "t1" }), shared],
      replies: [post({ id: "r1", replyTo: "9" }), shared],
      media: [shared],
    });

    const archive = await captureArchive(client, VIEWER, "tester", {});
    expect(archive.posts.map((p) => p.id).sort()).toEqual(["dup", "r1", "t1"]);
    expect(archive.sources.map((s) => s.source)).toEqual(["tweets", "replies", "media"]);
    expect(archive.complete).toBe(true);
  });

  test("walks every page of each timeline", async () => {
    const many = Array.from({ length: 250 }, (_, i) => post({ id: `t${i}` }));
    const { client } = fakeClient({ tweets: many, pageSize: 100 });

    const archive = await captureArchive(client, VIEWER, "tester", { pageSize: 100 });
    expect(archive.posts).toHaveLength(250);
    expect(archive.sources[0]).toMatchObject({ source: "tweets", found: 250, pages: 3 });
  });

  test("maxPages truncation is reported, not hidden", async () => {
    const many = Array.from({ length: 500 }, (_, i) => post({ id: `t${i}` }));
    const { client } = fakeClient({ tweets: many, pageSize: 100 });

    const archive = await captureArchive(client, VIEWER, "tester", {
      pageSize: 100,
      maxPages: 2,
    });
    expect(archive.complete).toBe(false);
    expect(archive.sources[0].complete).toBe(false);
    expect(archive.posts).toHaveLength(200);
  });

  test("a repeated cursor stops pagination instead of looping forever", async () => {
    let pages = 0;
    const client = {
      userTweets: async () => {
        pages++;
        return { tweets: [post({ id: "1" })], next_cursor: "stuck" };
      },
      userTweetsAndReplies: async () => ({ tweets: [], next_cursor: undefined }),
      userMedia: async () => ({ tweets: [], next_cursor: undefined }),
    } as unknown as XClient;

    const archive = await captureArchive(client, VIEWER, "tester", {});
    expect(pages).toBe(2);
    expect(archive.posts).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

describe("purgeTweets", () => {
  test("dry-run plans without deleting anything", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a", likes: 3 }), post({ id: "b", likes: 4000 })],
      replies: [post({ id: "r", likes: 0, replyTo: "9" })],
    });

    const report = await purgeTweets(client, { ...baseOpts(clock), maxLikes: 1000 });

    expect(deleted).toHaveLength(0);
    expect(report.dry_run).toBe(true);
    expect(report.stopped_by).toBe("dry-run");
    expect(report.posts_total).toBe(3);
    expect(report.queued).toBe(2);
    expect(report.kept).toBe(1);
    expect(report.planned.map((t) => t.id)).toEqual(["r", "a"]);
  });

  test("live run deletes the queue least-liked first", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [
        post({ id: "a", likes: 30 }),
        post({ id: "b", likes: 1 }),
        post({ id: "keep", likes: 2000 }),
      ],
    });

    const report = await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      maxLikes: 1000,
    });

    expect(deleted).toEqual(["b", "a"]);
    expect(report.deleted).toBe(2);
    expect(report.remaining).toBe(0);
    expect(report.stopped_by).toBe("queue-empty");
  });

  test("retweets are undone, not deleted", async () => {
    const clock = fakeClock();
    const { client, deleted, unretweeted } = fakeClient({
      tweets: [post({ id: "mine", likes: 2 }), post({ id: "rt", authorId: "other", likes: 9 })],
    });

    await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      includeRetweets: true,
    });

    expect(deleted).toEqual(["mine"]);
    expect(unretweeted).toEqual(["rt"]);
  });

  test("pacing is applied between deletions", async () => {
    const clock = fakeClock();
    const { client } = fakeClient({
      tweets: [post({ id: "a" }), post({ id: "b" }), post({ id: "c" })],
    });

    await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      minDelayMs: 6_000,
      maxDelayMs: 6_000,
    });

    expect(clock.now()).toBe(T0 + 12_000); // 3 deletions → 2 gaps
  });

  test("limit caps a run and leaves the rest queued", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a" }), post({ id: "b" }), post({ id: "c" })],
    });

    const report = await purgeTweets(client, { ...baseOpts(clock), dryRun: false, limit: 2 });
    expect(deleted).toHaveLength(2);
    expect(report.stopped_by).toBe("limit");
    expect(report.remaining).toBe(1);
  });

  test("an already-deleted post is skipped, not retried", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "gone", likes: 1 }), post({ id: "ok", likes: 2 })],
      errors: { gone: [new XError("X API error 144: No status found with that ID", 144)] },
    });

    const report = await purgeTweets(client, { ...baseOpts(clock), dryRun: false });
    expect(deleted).toEqual(["gone", "ok"]);
    expect(report.skipped).toBe(1);
    expect(report.deleted).toBe(1);
    expect(report.failed).toBe(0);
  });

  test("a rate limit pauses and retries the same post", async () => {
    const clock = fakeClock();
    const { client, raw, deleted } = fakeClient({
      tweets: [post({ id: "a" })],
      errors: { a: [new XError("X API error 88: Rate limit exceeded", 88)] },
    });
    raw.lastRateLimit = { limit: 50, remaining: 0, reset_epoch: Math.floor((T0 + 300_000) / 1000) };

    const report = await purgeTweets(client, { ...baseOpts(clock), dryRun: false });
    expect(deleted).toEqual(["a", "a"]);
    expect(report.deleted).toBe(1);
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + 300_000);
  });

  test("transient errors are retried then parked as failed", async () => {
    const clock = fakeClock();
    const boom = () => new XError("HTTP 500", -1, 500);
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a", likes: 1 }), post({ id: "b", likes: 2 })],
      errors: { a: [boom(), boom(), boom(), boom()] },
    });

    const report = await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      maxRetries: 2,
    });

    expect(deleted).toEqual(["a", "a", "a", "b"]);
    expect(report.failed).toBe(1);
    expect(report.deleted).toBe(1);
    expect(report.failures[0].id).toBe("a");
  });

  test("an auth error aborts the whole run", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a" }), post({ id: "b" })],
      errors: { a: [new XError("X API error 32: Could not authenticate you", 32)] },
    });

    const report = await purgeTweets(client, { ...baseOpts(clock), dryRun: false });
    expect(deleted).toEqual(["a"]);
    expect(report.stopped_by).toBe("auth-error");
    expect(report.remaining).toBe(2);
  });

  test("an abort signal stops cleanly and keeps the post queued", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a" }), post({ id: "b" }), post({ id: "c" })],
    });

    const report = await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.processed === 1) controller.abort();
      },
    });

    expect(deleted).toHaveLength(1);
    expect(report.stopped_by).toBe("aborted");
    expect(report.remaining).toBe(2);
  });

  test("once returns instead of sleeping through an exhausted budget", async () => {
    const clock = fakeClock();
    const { client, deleted } = fakeClient({
      tweets: [post({ id: "a" }), post({ id: "b" }), post({ id: "c" })],
    });

    const report = await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      once: true,
      perWindow: 2,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(deleted).toHaveLength(2);
    expect(report.stopped_by).toBe("budget");
    expect(clock.now()).toBe(T0);
  });
});

// ---------------------------------------------------------------------------
// Journal / resume
// ---------------------------------------------------------------------------

describe("resumable journal", () => {
  test("a stopped run resumes without re-walking the timelines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-purge-tweets-"));
    const statePath = join(dir, "state.json");
    try {
      const clock = fakeClock();
      const { client, deleted } = fakeClient({
        tweets: [
          post({ id: "a", likes: 1 }),
          post({ id: "b", likes: 2 }),
          post({ id: "c", likes: 3 }),
        ],
      });

      const first = await purgeTweets(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        limit: 1,
        statePath,
      });
      expect(first.deleted).toBe(1);
      expect(deleted).toEqual(["a"]);

      const state = loadTweetState(statePath) as TweetPurgeState;
      expect(state.queue.map((t) => t.id)).toEqual(["b", "c"]);
      expect(state.history).toHaveLength(1);
      // NTFS n'a pas de bits POSIX : cf. CROSS-PLATFORM.md M7.
      if (process.platform !== "win32") {
        expect(statSync(statePath).mode & 0o777).toBe(0o600);
      }

      const second = await purgeTweets(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        statePath,
      });

      expect(deleted).toEqual(["a", "b", "c"]);
      expect(second.deleted).toBe(2);
      expect(second.remaining).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("changing the threshold rebuilds the queue instead of resuming a stale one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-purge-tweets-"));
    const statePath = join(dir, "state.json");
    try {
      const clock = fakeClock();
      const { client } = fakeClient({
        tweets: [post({ id: "a", likes: 5 }), post({ id: "b", likes: 500 })],
      });

      const tight = await purgeTweets(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        maxLikes: 100,
        statePath,
      });
      expect(tight.planned.map((t) => t.id)).toEqual(["a"]);

      const loose = await purgeTweets(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        maxLikes: 1000,
        statePath,
      });
      expect(loose.planned.map((t) => t.id)).toEqual(["a", "b"]);
      expect(loose.max_likes).toBe(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a journal belonging to another account is ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-purge-tweets-"));
    const statePath = join(dir, "state.json");
    try {
      Bun.write(statePath, JSON.stringify({ version: 1, user_id: "other", queue: [] }));
      expect(loadTweetState(statePath, VIEWER)).toBeNull();
      expect(loadTweetState(statePath, "other")).not.toBeNull();
      expect(loadTweetState(join(dir, "nope.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Read resilience
// ---------------------------------------------------------------------------

describe("readWithBackoff", () => {
  function readDeps(clock: ReturnType<typeof fakeClock>, over: Partial<ReadRetryDeps> = {}) {
    return {
      rateLimit: () => null,
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
      label: "tweets",
      ...over,
    } as ReadRetryDeps;
  }

  test("passes a successful read straight through", async () => {
    const clock = fakeClock();
    const got = await readWithBackoff(async () => "page", readDeps(clock));
    expect(got).toBe("page");
    expect(clock.now()).toBe(T0);
  });

  test("waits out a 429 and retries the same page", async () => {
    const clock = fakeClock();
    let calls = 0;
    const reset = Math.floor((T0 + 120_000) / 1000);

    const got = await readWithBackoff(
      async () => {
        if (++calls === 1) throw new XError("HTTP 429", -1, 429);
        return "page";
      },
      readDeps(clock, { rateLimit: () => ({ limit: 50, remaining: 0, reset_epoch: reset }) }),
    );

    expect(got).toBe("page");
    expect(calls).toBe(2);
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + 120_000);
  });

  test("falls back to a full window when no reset header is present", async () => {
    const clock = fakeClock();
    let calls = 0;
    await readWithBackoff(async () => {
      if (++calls === 1) throw new XError("X API error 88", 88);
      return "page";
    }, readDeps(clock));
    expect(clock.now()).toBe(T0 + WINDOW_MS);
  });

  test("gives up after maxWaits consecutive rate limits", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      readWithBackoff(
        async () => {
          calls++;
          throw new XError("HTTP 429", -1, 429);
        },
        readDeps(clock, { maxWaits: 2 }),
      ),
    ).rejects.toThrow("429");
    expect(calls).toBe(3); // initial + 2 waits
  });

  test("retries transient errors with backoff", async () => {
    const clock = fakeClock();
    let calls = 0;
    const got = await readWithBackoff(async () => {
      if (++calls < 3) throw new XError("HTTP 503", -1, 503);
      return "page";
    }, readDeps(clock));
    expect(got).toBe("page");
    expect(clock.now()).toBe(T0 + 2_000 + 4_000);
  });

  test("never retries a dead session — that would burn the cookie", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      readWithBackoff(async () => {
        calls++;
        throw new XError("X API error 32", 32);
      }, readDeps(clock)),
    ).rejects.toThrow("32");
    expect(calls).toBe(1);
  });

  test("a mid-walk 429 no longer throws away the pages already fetched", async () => {
    const clock = fakeClock();
    let served = 0;
    const client = {
      whoami: async () => ({ id: VIEWER, name: "T", screen_name: "tester" }),
      userTweets: async (_i: string, _n: number, cursor?: string) => {
        served++;
        // Page 2 throttles once before succeeding.
        if (served === 2) throw new XError("HTTP 429", -1, 429);
        const offset = cursor ? 1 : 0;
        return {
          tweets: [post({ id: `p${offset}` })],
          next_cursor: offset === 0 ? "c-1" : undefined,
        };
      },
      userTweetsAndReplies: async () => ({ tweets: [], next_cursor: undefined }),
      userMedia: async () => ({ tweets: [], next_cursor: undefined }),
      lastRateLimit: null,
    } as unknown as XClient;

    const archive = await captureArchive(client, VIEWER, "tester", {
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(archive.posts.map((p) => p.id)).toEqual(["p0", "p1"]);
    expect(archive.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Régressions constatées en conditions réelles
// ---------------------------------------------------------------------------

describe("retweet detection (regression)", () => {
  // Sur une timeline utilisateur, X attribue le retweet au RETWEETEUR : author_id
  // vaut notre propre id, donc le controle d'auteur seul ne se declenche jamais.
  const rtOnOwnTimeline = post({
    id: "rt1",
    authorId: VIEWER,
    text: "RT @someone_else: le post original",
  });

  test("a retweet attributed to us is still a retweet", () => {
    expect(classifyPost(rtOnOwnTimeline, VIEWER)).toBe("retweet");
  });

  test("a retweet with media is not mistaken for an own media post", () => {
    const rt = post({
      id: "rt2",
      authorId: VIEWER,
      media: true,
      text: "RT @other: regarde ça https://t.co/x",
    });
    expect(classifyPost(rt, VIEWER)).toBe("retweet");
  });

  test("a genuine post that merely mentions RT is not a retweet", () => {
    expect(classifyPost(post({ id: "1", text: "RT is dead, long live QT" }), VIEWER)).toBe(
      "tweet",
    );
    expect(classifyPost(post({ id: "2", text: "RT @: nope" }), VIEWER)).toBe("tweet");
  });

  test("out-of-scope by default, so a retweet is never deleted as an own post", () => {
    const { queue, byKind, kept } = buildTweetQueue([rtOnOwnTimeline, post({ id: "mine" })], VIEWER, {});
    expect(queue.map((t) => t.id)).toEqual(["mine"]);
    expect(byKind.retweet).toBe(0);
    expect(kept).toBe(1);
  });

  test("our own retweet status is removed with DeleteTweet, not DeleteRetweet", async () => {
    const clock = fakeClock();
    const { client, deleted, unretweeted } = fakeClient({ tweets: [rtOnOwnTimeline] });

    await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      includeRetweets: true,
    });

    // L'id que l'on detient est notre statut de retweet : DeleteTweet le retire.
    expect(deleted).toEqual(["rt1"]);
    expect(unretweeted).toEqual([]);
  });

  test("a payload carrying the original tweet still goes through DeleteRetweet", async () => {
    const clock = fakeClock();
    const foreign = post({ id: "src", authorId: "other" });
    const { client, deleted, unretweeted } = fakeClient({ tweets: [foreign] });

    await purgeTweets(client, {
      ...baseOpts(clock),
      dryRun: false,
      includeRetweets: true,
    });

    expect(unretweeted).toEqual(["src"]);
    expect(deleted).toEqual([]);
  });
});

describe("aborted walk completeness (regression)", () => {
  test("an aborted walk is reported incomplete, never as covered", async () => {
    const controller = new AbortController();
    const many = Array.from({ length: 300 }, (_, i) => post({ id: `t${i}` }));
    const { client } = fakeClient({ tweets: many, pageSize: 100 });

    // Coupe apres la premiere page : les timelines suivantes ne feront 0 page.
    let served = 0;
    const wrapped = {
      ...(client as unknown as Record<string, unknown>),
      userTweets: async (id: string, n: number, cursor?: string) => {
        const page = await (client as unknown as {
          userTweets: (i: string, n: number, c?: string) => Promise<unknown>;
        }).userTweets(id, n, cursor);
        if (++served >= 1) controller.abort();
        return page;
      },
    } as unknown as XClient;

    const archive = await captureArchive(wrapped, VIEWER, "tester", {
      pageSize: 100,
      signal: controller.signal,
    });

    expect(archive.complete).toBe(false);
    // Les timelines non parcourues ne doivent pas passer pour exhaustives.
    for (const s of archive.sources) {
      if (s.pages === 0) expect(s.complete).toBe(false);
    }
  });
});

describe("barren pages (regression)", () => {
  test("stops when X keeps serving fresh cursors over already-seen pages", async () => {
    let served = 0;
    const one = post({ id: "only" });
    const client = {
      // Toujours le meme post, toujours un curseur different : sans garde, la
      // boucle irait jusqu'a maxPages (200 requetes pour rien).
      userTweets: async () => {
        served++;
        return { tweets: [one], next_cursor: `c-${served}` };
      },
      userTweetsAndReplies: async () => ({ tweets: [], next_cursor: undefined }),
      userMedia: async () => ({ tweets: [], next_cursor: undefined }),
      lastRateLimit: null,
    } as unknown as XClient;

    const archive = await captureArchive(client, VIEWER, "tester", { maxBarrenPages: 3 });

    // 1 page utile + 3 steriles, pas 200.
    expect(served).toBe(4);
    expect(archive.posts).toHaveLength(1);
  });

  test("a productive page resets the barren counter", async () => {
    let served = 0;
    const client = {
      userTweets: async () => {
        served++;
        // Neuf en page 1 et 4, steriles ailleurs.
        const fresh = served === 1 || served === 4;
        return {
          tweets: [post({ id: fresh ? `p${served}` : "dup" })],
          next_cursor: served < 8 ? `c-${served}` : undefined,
        };
      },
      userTweetsAndReplies: async () => ({ tweets: [], next_cursor: undefined }),
      userMedia: async () => ({ tweets: [], next_cursor: undefined }),
      lastRateLimit: null,
    } as unknown as XClient;

    const archive = await captureArchive(client, VIEWER, "tester", { maxBarrenPages: 3 });
    // p1, dup(2), dup(3) sterile x2, p4 remet a zero, puis 3 steriles -> arret page 7.
    expect(served).toBe(7);
    expect(archive.posts.map((p) => p.id).sort()).toEqual(["dup", "p1", "p4"]);
  });
});
