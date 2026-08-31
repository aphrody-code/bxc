// SPDX-License-Identifier: Apache-2.0
/**
 * Autonomous "purge posts" engine.
 *
 * Deletes an account's own tweets, replies and media posts below an engagement
 * threshold — **least-liked first**, so stopping early always means the
 * deadest posts are the ones already gone.
 *
 * Pacing, error taxonomy and the mutation loop are shared with the follow
 * purge (`purge-engine.ts`). What is specific here:
 *
 *  - **Three timelines, one archive.** `UserTweets` omits replies and
 *    `UserMedia` only carries media, so all three are walked and deduped by id;
 *    no single endpoint enumerates everything.
 *  - **Classification.** Each post becomes a `tweet`, `reply`, `media` or
 *    `retweet`, which decides both whether it is in scope and which mutation
 *    removes it (`DeleteTweet` vs `DeleteRetweet`).
 *  - **A keep rule.** Only posts strictly below {@link PurgeTweetsOptions.maxLikes}
 *    are queued, so the ones that actually landed survive.
 *
 * Deletion is irreversible and X offers no bulk undo, so the engine defaults to
 * `dryRun: true`; callers must opt in explicitly.
 *
 * @example
 * ```ts
 * const client = new XClient(XSession.loadOrEnv());
 * const plan = await purgeTweets(client, { maxLikes: 1000 });
 * console.log(plan.queued, "posts sous le seuil");
 * await purgeTweets(client, { maxLikes: 1000, dryRun: false, onLog: console.error });
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { XClient } from "../core/client";
import { XError } from "../core/parse";
import type { Tweet, TweetPage } from "../core/parse";
import {
  PACING_DEFAULTS,
  RateGovernor,
  estimateEta,
  readWithBackoff,
  runMutationQueue,
  sleep,
  writeJsonPrivate,
  type MutationOutcome,
  type PacingOptions,
  type StopReason,
} from "./purge-engine";

/** Pacing + walk defaults for the post purge. */
export const TWEET_PURGE_DEFAULTS = {
  ...PACING_DEFAULTS,
  /** Keep anything that reached this many likes. Strictly-below is deleted. */
  maxLikes: 1000,
  /** Safety stop per timeline walk (100 posts/page → 20 000 posts each). */
  maxPages: 200,
  /**
   * Consecutive pages yielding nothing new before the walk stops.
   *
   * X keeps handing back fresh cursors over pages we have already seen, so
   * "no next cursor" is not a reliable end-of-timeline signal. Without this the
   * walk runs to `maxPages` — a hundred-plus pointless requests that burn the
   * read budget and trigger the very 429 the backoff then has to wait out.
   */
  maxBarrenPages: 3,
  pageSize: 100,
} as const;

/** The three timelines that together enumerate an account's own posts. */
export const ARCHIVE_SOURCES = ["tweets", "replies", "media"] as const;
export type ArchiveSource = (typeof ARCHIVE_SOURCES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What a post is, for scoping and for picking the mutation.
 *
 * A reply carrying media classifies as `reply`: the reply nature is the more
 * specific fact, and both kinds are in scope by default anyway.
 */
export type PostKind = "tweet" | "reply" | "media" | "retweet";

/** One post queued for deletion. */
export interface TweetTarget {
  id: string;
  kind: PostKind;
  like_count: number;
  created_at?: string;
  /**
   * For a retweet: `true` when the payload was attributed to us, meaning the
   * id is our own retweet status and `DeleteTweet` removes it. Absent for
   * anything else.
   */
  own_status?: boolean;
  /** Truncated text, so the journal and logs stay readable. */
  preview: string;
}

export type TweetTargetStatus = "deleted" | "skipped" | "failed";

export interface TweetRecord {
  id: string;
  kind: PostKind;
  like_count: number;
  status: TweetTargetStatus;
  at: number;
  reason?: string;
}

export interface SourceResult {
  source: ArchiveSource;
  found: number;
  pages: number;
  /** `false` when pagination hit `maxPages` before the end. */
  complete: boolean;
}

/** Everything the three walks turned up, deduped by post id. */
export interface ArchiveSnapshot {
  user_id: string;
  handle: string;
  posts: Tweet[];
  captured_at: number;
  sources: SourceResult[];
  complete: boolean;
}

/** Persisted, resumable run journal. */
export interface TweetPurgeState {
  version: 1;
  user_id: string;
  handle: string;
  created_at: number;
  updated_at: number;
  max_likes: number;
  /** Remaining targets, least-liked first. */
  queue: TweetTarget[];
  done: Record<string, TweetRecord>;
  archive: {
    captured_at: number;
    posts_total: number;
    queued_total: number;
    kept_total: number;
    by_kind: Record<PostKind, number>;
    sources: SourceResult[];
    complete: boolean;
  };
  history: number[];
}

export interface PurgeTweetsOptions extends PacingOptions {
  /** When `true` (default) nothing is deleted — the queue is only planned. */
  dryRun?: boolean;
  /** Keep posts with at least this many likes. Default 1000. */
  maxLikes?: number;
  /** Which kinds to delete. Default: tweets, replies and media (not retweets). */
  kinds?: readonly PostKind[];
  /**
   * Include retweets. Off by default: a retweet's like count belongs to
   * someone else's post, so the "under N likes" rule says nothing about it.
   * When on, retweets are queued regardless of like count and removed with
   * `DeleteRetweet`.
   */
  includeRetweets?: boolean;
  /** Post ids to never touch (pinned post, keepsakes). */
  protectIds?: readonly string[];
  /** Stop after this many successful deletions in this run. */
  limit?: number;
  /** Re-walk the timelines and rebuild the queue, discarding the old one. */
  refresh?: boolean;
  /** Return as soon as a budget is exhausted instead of sleeping through it. */
  once?: boolean;
  /** Journal path. Defaults to `~/.aphrody/x-purge-tweets-<handle>.json`. */
  statePath?: string;
  /** Set `false` to keep everything in memory (tests). */
  persist?: boolean;

  maxRetries?: number;
  maxRateLimitWaits?: number;
  maxPages?: number;
  maxBarrenPages?: number;
  pageSize?: number;

  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onProgress?: (p: TweetPurgeProgress) => void;
}

export interface TweetPurgeProgress {
  record: TweetRecord;
  processed: number;
  remaining: number;
  deleted: number;
  skipped: number;
  failed: number;
}

export interface TweetPurgeReport {
  handle: string;
  user_id: string;
  dry_run: boolean;
  max_likes: number;
  /** Posts discovered across the three timelines. */
  posts_total: number;
  /** Posts that matched the threshold and scope. */
  queued: number;
  /** Posts left alone (above the threshold, out of scope, or protected). */
  kept: number;
  by_kind: Record<PostKind, number>;
  /** Targets planned in dry-run mode (empty on a live run). */
  planned: TweetTarget[];
  deleted: number;
  skipped: number;
  failed: number;
  remaining: number;
  stopped_by: StopReason | "dry-run";
  state_path?: string;
  failures: TweetRecord[];
  /** `false` when a timeline walk was truncated — rerun with `refresh`. */
  archive_complete: boolean;
  sources: SourceResult[];
  elapsed_ms: number;
  eta_epoch?: number;
}

// ---------------------------------------------------------------------------
// Archive collection
// ---------------------------------------------------------------------------

function defaultStatePath(handle: string): string {
  const safe = handle.replace(/[^A-Za-z0-9_.-]/g, "_") || "viewer";
  return join(homedir(), ".aphrody", `x-purge-tweets-${safe}.json`);
}

function preview(text: string, max = 80): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Walks one timeline to the end, deduping and stopping on the cursor signals
 * X actually gives (missing, repeated, or an empty page).
 */
export async function collectTimeline(
  client: XClient,
  fetchPage: (cursor?: string) => Promise<TweetPage>,
  source: ArchiveSource,
  opts: PurgeTweetsOptions = {},
): Promise<{ posts: Tweet[]; result: SourceResult }> {
  const maxPages = opts.maxPages ?? TWEET_PURGE_DEFAULTS.maxPages;
  const maxBarren = opts.maxBarrenPages ?? TWEET_PURGE_DEFAULTS.maxBarrenPages;
  const log = opts.onLog;
  const readDeps = {
    rateLimit: () => client.lastRateLimit,
    maxWaits: opts.maxRateLimitWaits,
    maxRetries: opts.maxRetries,
    signal: opts.signal,
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? sleep,
    log: log ?? (() => {}),
    label: source,
  };

  const posts: Tweet[] = [];
  const seen = new Set<string>();
  const seenCursors = new Set<string>();

  let cursor: string | undefined;
  let pages = 0;
  let barren = 0;
  let aborted = false;

  while (pages < maxPages) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }

    const page = await readWithBackoff(() => fetchPage(cursor), readDeps);
    pages++;

    let fresh = 0;
    for (const t of page.tweets) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);
      posts.push(t);
      fresh++;
    }

    log?.(`[archive] ${source}: page ${pages} → +${fresh} (total ${posts.length})`);

    // A page full of already-seen posts means we have reached the end, even
    // though X still offers a cursor. Give it a few pages of slack, then stop.
    barren = fresh === 0 ? barren + 1 : 0;
    if (barren >= maxBarren) {
      log?.(`[archive] ${source}: ${barren} pages sans rien de neuf — fin de timeline`);
      break;
    }

    const next = page.next_cursor;
    if (!next || next === cursor || seenCursors.has(next) || page.tweets.length === 0) break;
    seenCursors.add(next);
    cursor = next;
  }

  // An aborted walk is NOT complete: recording it as such would let the purge
  // delete a partial archive while believing it had covered everything.
  return {
    posts,
    result: { source, found: posts.length, pages, complete: !aborted && pages < maxPages },
  };
}

/**
 * Walks all three timelines and merges them into one deduped archive.
 *
 * None of the three is a superset of the others: `UserTweets` drops replies,
 * `UserTweetsAndReplies` can lag on older media, and `UserMedia` only carries
 * media. Walking all three is what makes "everything under N likes" true.
 */
export async function captureArchive(
  client: XClient,
  userId: string,
  handle: string,
  opts: PurgeTweetsOptions = {},
): Promise<ArchiveSnapshot> {
  const size = opts.pageSize ?? TWEET_PURGE_DEFAULTS.pageSize;

  const walks: Array<[ArchiveSource, (cursor?: string) => Promise<TweetPage>]> = [
    ["tweets", (c) => client.userTweets(userId, size, c, 0)],
    ["replies", (c) => client.userTweetsAndReplies(userId, size, c, 0)],
    ["media", (c) => client.userMedia(userId, size, c, 0)],
  ];

  const byId = new Map<string, Tweet>();
  const sources: SourceResult[] = [];

  for (const [source, fetchPage] of walks) {
    const { posts, result } = await collectTimeline(client, fetchPage, source, opts);
    for (const t of posts) {
      // First writer wins: the earlier walks carry the richer payload.
      if (!byId.has(t.id)) byId.set(t.id, t);
    }
    sources.push(result);
  }

  return {
    user_id: userId,
    handle,
    posts: [...byId.values()],
    captured_at: (opts.now ?? Date.now)(),
    sources,
    complete: sources.every((s) => s.complete),
  };
}

/**
 * Buckets a post.
 *
 * Retweet detection cannot rely on the author alone: on a user timeline X
 * attributes a retweet to the **retweeter**, so `author_id` is your own id and
 * an author check never fires. The reliable signal on this parse path is the
 * legacy `RT @handle:` prefix that X keeps on retweeted text. Both are checked:
 * the prefix catches retweets on your own timeline, the author check catches
 * payloads that carry the original tweet instead.
 *
 * Getting this wrong is not cosmetic — a misclassified retweet is treated as
 * your own post and deleted by a purge that was told to leave retweets alone.
 */
export function classifyPost(post: Tweet, viewerId: string): PostKind {
  if (post.author_id && viewerId && post.author_id !== viewerId) return "retweet";
  if (/^RT @[A-Za-z0-9_]{1,15}:/.test(post.text ?? "")) return "retweet";
  if (post.in_reply_to_status_id) return "reply";
  if (Array.isArray(post.media) && post.media.length > 0) return "media";
  return "tweet";
}

/**
 * Which mutation removes a retweet.
 *
 * When the payload is attributed to us, the id we hold is our own retweet
 * status and `DeleteTweet` removes it. When it is attributed to the original
 * author, the id is the source tweet and only `DeleteRetweet` applies.
 */
export function retweetIsOwnStatus(target: TweetTarget): boolean {
  return target.own_status === true;
}

/**
 * Selects and orders the deletion queue: **least-liked first**, oldest as the
 * tie-break, so an interrupted run has always removed the deadest posts.
 */
/**
 * Le seuil de conservation, ou une erreur.
 *
 * `?? defaut` ne rattrape pas NaN, et la regle de conservation est
 * `likes >= maxLikes` : face a NaN elle est fausse pour tout entier, donc plus
 * un seul post n'est protege et la file devient l'archive complete. Un seuil
 * illisible doit arreter la purge, jamais l'elargir.
 */
function resolveMaxLikes(value: number | undefined): number {
  if (value === undefined) return TWEET_PURGE_DEFAULTS.maxLikes;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`purgeTweets: maxLikes invalide (${value}) — entier >= 0 attendu`);
  }
  return value;
}

export function buildTweetQueue(
  posts: Tweet[],
  viewerId: string,
  opts: PurgeTweetsOptions = {},
): { queue: TweetTarget[]; byKind: Record<PostKind, number>; kept: number } {
  const maxLikes = resolveMaxLikes(opts.maxLikes);
  const kinds = new Set<PostKind>(opts.kinds ?? ["tweet", "reply", "media"]);
  if (opts.includeRetweets) kinds.add("retweet");
  const protectedIds = new Set(opts.protectIds ?? []);

  const byKind: Record<PostKind, number> = { tweet: 0, reply: 0, media: 0, retweet: 0 };
  const queue: TweetTarget[] = [];
  let kept = 0;

  for (const post of posts) {
    const kind = classifyPost(post, viewerId);
    const likes = typeof post.like_count === "number" ? post.like_count : 0;

    // A retweet's like count is the original author's, so the threshold says
    // nothing about it: scope alone decides.
    const overThreshold = kind !== "retweet" && likes >= maxLikes;

    if (protectedIds.has(post.id) || !kinds.has(kind) || overThreshold) {
      kept++;
      continue;
    }

    byKind[kind]++;
    queue.push({
      id: post.id,
      kind,
      like_count: likes,
      created_at: post.created_at,
      ...(kind === "retweet"
        ? { own_status: !post.author_id || post.author_id === viewerId }
        : {}),
      preview: preview(post.text),
    });
  }

  queue.sort((a, b) => {
    if (a.like_count !== b.like_count) return a.like_count - b.like_count;
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return ta - tb;
  });

  return { queue, byKind, kept };
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/** Reads a run journal, or `null` when absent / unreadable / foreign. */
export function loadTweetState(path: string, userId?: string): TweetPurgeState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as TweetPurgeState;
    if (parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
    if (userId && parsed.user_id && parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persists a run journal (0600, atomic rename). */
export function saveTweetState(path: string, state: TweetPurgeState): void {
  writeJsonPrivate(path, state);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Deletes the authenticated account's posts below the like threshold.
 *
 * Safe by default: with `dryRun` left at `true` the timelines are walked and
 * the queue is planned, but nothing is deleted. Pass `dryRun: false` to
 * actually delete.
 *
 * The run is resumable — stop it at any time and call again to pick up exactly
 * where it left off, without re-walking the timelines.
 */
export async function purgeTweets(
  client: XClient,
  opts: PurgeTweetsOptions = {},
): Promise<TweetPurgeReport> {
  const now = opts.now ?? Date.now;
  const log = opts.onLog ?? (() => {});
  const dryRun = opts.dryRun !== false;
  const persist = opts.persist !== false;
  const maxLikes = resolveMaxLikes(opts.maxLikes);
  const startedAt = now();

  const viewer = await client.whoami();
  if (!viewer.id) throw new XError("cannot resolve the authenticated account", -1);
  const handle = viewer.screen_name || client.session.handle || "viewer";
  const statePath = opts.statePath ?? defaultStatePath(handle);

  log(`[purge] compte @${handle} (${viewer.id}) — ${dryRun ? "DRY-RUN" : "LIVE"}, seuil ${maxLikes} likes`);

  // --- queue: resume or (re)build -----------------------------------------
  let state = opts.refresh || !persist ? null : loadTweetState(statePath, viewer.id);

  if (state && state.max_likes !== maxLikes) {
    log(
      `[purge] seuil changé (${state.max_likes} → ${maxLikes}) — la file est reconstruite`,
    );
    state = null;
  }

  if (state) {
    log(
      `[purge] reprise de ${statePath} — ${state.queue.length} restants, ` +
        `${Object.keys(state.done).length} déjà traités`,
    );
  } else {
    log("[purge] lecture des timelines (tweets, réponses, médias)…");
    const archive = await captureArchive(client, viewer.id, handle, opts);
    const { queue, byKind, kept } = buildTweetQueue(archive.posts, viewer.id, opts);

    if (!archive.complete) {
      log(
        "[purge] ATTENTION: pagination tronquée (maxPages atteint) — " +
          "relancer avec --refresh après ce lot pour capturer le reste",
      );
    }
    log(
      `[purge] ${archive.posts.length} posts trouvés, ${queue.length} sous ${maxLikes} likes ` +
        `(${byKind.tweet} tweets, ${byKind.reply} réponses, ${byKind.media} médias, ` +
        `${byKind.retweet} retweets), ${kept} conservés`,
    );

    state = {
      version: 1,
      user_id: viewer.id,
      handle,
      created_at: now(),
      updated_at: now(),
      max_likes: maxLikes,
      queue,
      done: {},
      archive: {
        captured_at: archive.captured_at,
        posts_total: archive.posts.length,
        queued_total: queue.length,
        kept_total: kept,
        by_kind: byKind,
        sources: archive.sources,
        complete: archive.complete,
      },
      history: [],
    };
    if (persist) saveTweetState(statePath, state);
  }

  const buildReport = (
    stoppedBy: TweetPurgeReport["stopped_by"],
    counts: { deleted: number; skipped: number; failed: number },
    planned: TweetTarget[],
  ): TweetPurgeReport => ({
    handle,
    user_id: viewer.id,
    dry_run: stoppedBy === "dry-run",
    max_likes: state!.max_likes,
    posts_total: state!.archive.posts_total,
    queued: state!.archive.queued_total,
    kept: state!.archive.kept_total,
    by_kind: state!.archive.by_kind,
    planned,
    ...counts,
    remaining: state!.queue.length,
    stopped_by: stoppedBy,
    state_path: persist ? statePath : undefined,
    failures: Object.values(state!.done).filter((r) => r.status === "failed"),
    archive_complete: state!.archive.complete,
    sources: state!.archive.sources,
    elapsed_ms: now() - startedAt,
    eta_epoch: estimateEta(state!.queue.length, opts, now()),
  });

  if (dryRun) {
    log(`[purge] dry-run: ${state.queue.length} posts seraient supprimés, aucune mutation`);
    return buildReport("dry-run", { deleted: 0, skipped: 0, failed: 0 }, state.queue);
  }

  // --- mutation loop -------------------------------------------------------
  const governor = new RateGovernor(opts, state.history);
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  const result = await runMutationQueue<TweetTarget>({
    queue: state.queue,
    mutate: (t) =>
      t.kind === "retweet" && !retweetIsOwnStatus(t)
        ? // The id is the original tweet: only DeleteRetweet applies.
          client.unretweet(t.id)
        : // Our own post, or our own retweet status — DeleteTweet removes it.
          client.deleteTweet(t.id),
    rateLimit: () => client.lastRateLimit,
    label: (t) => `${t.kind} ${t.id} (${t.like_count}♥) "${t.preview}"`,
    governor,
    limit: opts.limit,
    once: opts.once,
    signal: opts.signal,
    maxRetries: opts.maxRetries,
    maxRateLimitWaits: opts.maxRateLimitWaits,
    now,
    sleep: opts.sleep ?? sleep,
    log,
    commit: (target, outcome: MutationOutcome) => {
      const record: TweetRecord = {
        id: target.id,
        kind: target.kind,
        like_count: target.like_count,
        status: outcome.status === "done" ? "deleted" : outcome.status,
        at: outcome.at,
        reason: outcome.reason,
      };
      state!.done[record.id] = record;
      state!.history = governor.timestamps;
      state!.updated_at = now();
      if (persist) saveTweetState(statePath, state!);

      if (record.status === "deleted") deleted++;
      else if (record.status === "skipped") skipped++;
      else failed++;

      opts.onProgress?.({
        record,
        processed: deleted + skipped + failed,
        remaining: state!.queue.length,
        deleted,
        skipped,
        failed,
      });
    },
  });

  state.history = governor.timestamps;
  state.updated_at = now();
  if (persist) saveTweetState(statePath, state);

  return buildReport(result.stoppedBy, { deleted, skipped, failed }, []);
}
