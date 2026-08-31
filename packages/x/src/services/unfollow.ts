// SPDX-License-Identifier: Apache-2.0
/**
 * Autonomous "purge following" engine.
 *
 * Empties an account's entire following list, **non-mutuals first** (accounts
 * you follow that do not follow you back), then mutuals.
 *
 * The pacing, error taxonomy and mutation loop live in `purge-engine.ts` and
 * are shared with the tweet purge; this module owns what is specific to the
 * follow graph: reading both sides of it, ordering the queue, and the
 * resumable journal.
 *
 * Two constraints shape the whole design:
 *
 *  - **Rate limits.** `POST friendships/destroy.json` is aggressively throttled
 *    and bursts are a well-known automation signature, so every mutation goes
 *    through {@link RateGovernor}.
 *  - **Autonomy.** A 4 000-account list at a safe pace spans days, so the run
 *    persists a journal after every mutation and resumes from it exactly.
 *
 * Unfollowing cannot be undone in bulk, so the engine defaults to
 * `dryRun: true`; callers must opt in explicitly.
 *
 * @example
 * ```ts
 * const client = new XClient(XSession.loadOrEnv());
 * const report = await purgeFollowing(client, { dryRun: false, onLog: console.error });
 * console.log(report.unfollowed, "comptes retirés");
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { XClient } from "../core/client";
import { XError } from "../core/parse";
import type { User } from "../core/parse";
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

export {
  DAY_MS,
  RateGovernor,
  WINDOW_MS,
  estimateEta,
  isAuthFailure,
  sleep,
} from "./purge-engine";

/** Pacing + walk defaults for the follow purge. */
export const DEFAULTS = {
  ...PACING_DEFAULTS,
  /** Safety stop for cursor pagination (100 users/page → 20 000 accounts). */
  maxPages: 200,
  /**
   * Consecutive pages yielding nothing new before the walk stops. X keeps
   * handing back fresh cursors over pages already seen, so "no next cursor" is
   * not a reliable end-of-timeline signal.
   */
  maxBarrenPages: 3,
  /** Page size for the Following / Followers timelines. */
  pageSize: 100,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One account queued for removal. */
export interface UnfollowTarget {
  id: string;
  username: string;
  /** `true` when the account follows you back (processed last). */
  mutual: boolean;
}

/** Outcome recorded for a processed target. */
export type TargetStatus = "unfollowed" | "skipped" | "failed" | "planned";

export interface TargetRecord {
  id: string;
  username: string;
  mutual: boolean;
  status: TargetStatus;
  at: number;
  reason?: string;
}

/** Result of a full paginated timeline walk. */
export interface CollectResult {
  users: User[];
  /** `false` when pagination hit {@link PurgeOptions.maxPages} before the end. */
  complete: boolean;
  pages: number;
}

/** Snapshot of the follow graph the queue was built from. */
export interface FollowGraph {
  user_id: string;
  handle: string;
  following: User[];
  follower_ids: string[];
  captured_at: number;
  following_complete: boolean;
  followers_complete: boolean;
}

/** Persisted, resumable run journal. */
export interface PurgeState {
  version: 1;
  user_id: string;
  handle: string;
  created_at: number;
  updated_at: number;
  /** Remaining targets, non-mutuals first. */
  queue: UnfollowTarget[];
  /** Terminal outcomes keyed by user id. */
  done: Record<string, TargetRecord>;
  graph: {
    captured_at: number;
    following_total: number;
    followers_total: number;
    non_mutual_total: number;
    following_complete: boolean;
    followers_complete: boolean;
  };
  /** Mutation timestamps (epoch ms) used for the rolling budgets. */
  history: number[];
}

export interface PurgeOptions extends PacingOptions {
  /** When `true` (default) nothing is mutated — the queue is only planned. */
  dryRun?: boolean;
  /** Stop after this many successful unfollows in this run. */
  limit?: number;
  /** Skip mutuals entirely; only clear accounts that don't follow back. */
  nonMutualOnly?: boolean;
  /** Re-read the follow graph and rebuild the queue, discarding the old one. */
  refresh?: boolean;
  /** Return as soon as a budget is exhausted instead of sleeping through it. */
  once?: boolean;
  /** Journal path. Defaults to `~/.aphrody/x-unfollow-<handle>.json`. */
  statePath?: string;
  /** Set `false` to keep everything in memory (tests). */
  persist?: boolean;

  maxRetries?: number;
  maxRateLimitWaits?: number;
  maxPages?: number;
  maxBarrenPages?: number;
  pageSize?: number;

  /** Cancels sleeps and stops the loop at the next safe point. */
  signal?: AbortSignal;
  /** Human-readable progress. */
  onLog?: (line: string) => void;
  /** Structured progress, fired after every processed target. */
  onProgress?: (p: PurgeProgress) => void;
}

export interface PurgeProgress {
  record: TargetRecord;
  processed: number;
  remaining: number;
  unfollowed: number;
  skipped: number;
  failed: number;
}

export interface PurgeReport {
  handle: string;
  user_id: string;
  dry_run: boolean;
  /** Total accounts followed when the graph was captured. */
  following_total: number;
  non_mutual_total: number;
  mutual_total: number;
  /** Targets planned in dry-run mode (empty on a live run). */
  planned: UnfollowTarget[];
  unfollowed: number;
  skipped: number;
  failed: number;
  remaining: number;
  /** Why the loop returned. */
  stopped_by: StopReason | "dry-run";
  state_path?: string;
  failures: TargetRecord[];
  /** Wall-clock ms spent in the mutation loop. */
  elapsed_ms: number;
  /** Estimated epoch ms at which the remaining queue would drain. */
  eta_epoch?: number;
}

// ---------------------------------------------------------------------------
// Graph collection
// ---------------------------------------------------------------------------

function defaultStatePath(handle: string): string {
  const safe = handle.replace(/[^A-Za-z0-9_.-]/g, "_") || "viewer";
  return join(homedir(), ".aphrody", `x-unfollow-${safe}.json`);
}

async function collectUsers(
  client: XClient,
  fetchPage: (cursor?: string) => Promise<{ users: User[]; next_cursor?: string }>,
  opts: PurgeOptions,
  label: string,
): Promise<CollectResult> {
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const maxBarren = opts.maxBarrenPages ?? DEFAULTS.maxBarrenPages;
  const log = opts.onLog;
  const readDeps = {
    rateLimit: () => client.lastRateLimit,
    maxWaits: opts.maxRateLimitWaits,
    maxRetries: opts.maxRetries,
    signal: opts.signal,
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? sleep,
    log: log ?? (() => {}),
    label,
  };

  const users: User[] = [];
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
    for (const u of page.users) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      users.push(u);
      fresh++;
    }

    log?.(`[graph] ${label}: page ${pages} → +${fresh} (total ${users.length})`);

    // A page full of already-seen accounts means we have reached the end, even
    // though X still offers a cursor. Give it a few pages of slack, then stop.
    barren = fresh === 0 ? barren + 1 : 0;
    if (barren >= maxBarren) {
      log?.(`[graph] ${label}: ${barren} pages sans rien de neuf — fin de liste`);
      break;
    }

    const next = page.next_cursor;
    // X keeps handing back a bottom cursor forever; stop on the real signals.
    if (!next || next === cursor || seenCursors.has(next) || page.users.length === 0) break;
    seenCursors.add(next);
    cursor = next;
  }

  // An aborted walk is NOT complete: recording it as such would let the purge
  // run on a partial graph while believing it had covered everything.
  return { users, complete: !aborted && pages < maxPages, pages };
}

/** Walks the full `Following` timeline. */
export async function collectFollowing(
  client: XClient,
  userId: string,
  opts: PurgeOptions = {},
): Promise<CollectResult> {
  const size = opts.pageSize ?? DEFAULTS.pageSize;
  return collectUsers(client, (cursor) => client.following(userId, size, cursor), opts, "following");
}

/** Walks the full `Followers` timeline. */
export async function collectFollowers(
  client: XClient,
  userId: string,
  opts: PurgeOptions = {},
): Promise<CollectResult> {
  const size = opts.pageSize ?? DEFAULTS.pageSize;
  return collectUsers(client, (cursor) => client.followers(userId, size, cursor), opts, "followers");
}

/** Captures both sides of the follow graph for `handle` / `userId`. */
export async function captureFollowGraph(
  client: XClient,
  userId: string,
  handle: string,
  opts: PurgeOptions = {},
): Promise<FollowGraph> {
  const following = await collectFollowing(client, userId, opts);
  const followers = await collectFollowers(client, userId, opts);

  return {
    user_id: userId,
    handle,
    following: following.users,
    follower_ids: followers.users.map((u) => u.id),
    captured_at: (opts.now ?? Date.now)(),
    following_complete: following.complete,
    followers_complete: followers.complete,
  };
}

/**
 * Orders the removal queue: **non-mutuals first** (in timeline order, i.e.
 * most recently followed first), then mutuals.
 */
export function buildQueue(
  following: User[],
  followerIds: Iterable<string>,
  opts: { nonMutualOnly?: boolean } = {},
): UnfollowTarget[] {
  const followers = followerIds instanceof Set ? followerIds : new Set(followerIds);

  const nonMutual: UnfollowTarget[] = [];
  const mutual: UnfollowTarget[] = [];

  for (const u of following) {
    const target: UnfollowTarget = {
      id: u.id,
      username: u.username,
      mutual: followers.has(u.id),
    };
    (target.mutual ? mutual : nonMutual).push(target);
  }

  return opts.nonMutualOnly ? nonMutual : [...nonMutual, ...mutual];
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/** Reads a run journal, or `null` when absent / unreadable / foreign. */
export function loadState(path: string, userId?: string): PurgeState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as PurgeState;
    if (parsed.version !== 1 || !Array.isArray(parsed.queue)) return null;
    if (userId && parsed.user_id && parsed.user_id !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persists a run journal (0600, atomic rename). */
export function saveState(path: string, state: PurgeState): void {
  writeJsonPrivate(path, state);
}

function stateFromGraph(graph: FollowGraph, queue: UnfollowTarget[], now: number): PurgeState {
  return {
    version: 1,
    user_id: graph.user_id,
    handle: graph.handle,
    created_at: now,
    updated_at: now,
    queue,
    done: {},
    graph: {
      captured_at: graph.captured_at,
      following_total: graph.following.length,
      followers_total: graph.follower_ids.length,
      non_mutual_total: queue.filter((t) => !t.mutual).length,
      following_complete: graph.following_complete,
      followers_complete: graph.followers_complete,
    },
    history: [],
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Empties the authenticated account's following list, non-mutuals first.
 *
 * Safe by default: with `dryRun` left at `true` the graph is read and the queue
 * is planned, but nothing is mutated. Pass `dryRun: false` to actually unfollow.
 *
 * The run is resumable — stop it at any time (Ctrl-C, `signal`, budget
 * exhaustion) and call again to pick up exactly where it left off.
 */
export async function purgeFollowing(
  client: XClient,
  opts: PurgeOptions = {},
): Promise<PurgeReport> {
  const now = opts.now ?? Date.now;
  const log = opts.onLog ?? (() => {});
  const dryRun = opts.dryRun !== false;
  const persist = opts.persist !== false;
  const startedAt = now();

  const viewer = await client.whoami();
  if (!viewer.id) throw new XError("cannot resolve the authenticated account", -1);
  const handle = viewer.screen_name || client.session.handle || "viewer";
  const statePath = opts.statePath ?? defaultStatePath(handle);

  log(`[purge] compte @${handle} (${viewer.id}) — ${dryRun ? "DRY-RUN" : "LIVE"}`);

  // --- queue: resume or (re)build -----------------------------------------
  let state = opts.refresh || !persist ? null : loadState(statePath, viewer.id);

  if (state) {
    log(
      `[purge] reprise de ${statePath} — ${state.queue.length} restants, ` +
        `${Object.keys(state.done).length} déjà traités`,
    );
  } else {
    log("[purge] lecture du graphe d'abonnements…");
    const graph = await captureFollowGraph(client, viewer.id, handle, opts);
    const queue = buildQueue(graph.following, graph.follower_ids, {
      nonMutualOnly: opts.nonMutualOnly,
    });
    state = stateFromGraph(graph, queue, now());
    if (!graph.following_complete || !graph.followers_complete) {
      log(
        "[purge] ATTENTION: pagination tronquée (maxPages atteint) — " +
          "relancer avec --refresh après ce lot pour capturer le reste",
      );
    }
    log(
      `[purge] ${graph.following.length} abonnements, ${state.graph.non_mutual_total} non-mutuels, ` +
        `${queue.length} en file`,
    );
    if (persist) saveState(statePath, state);
  }

  // A queue built without --non-mutual-only still honours the flag on resume.
  if (opts.nonMutualOnly) {
    state.queue = state.queue.filter((t) => !t.mutual);
  }

  const mutualTotal = state.graph.following_total - state.graph.non_mutual_total;
  const buildReport = (
    stoppedBy: PurgeReport["stopped_by"],
    counts: { unfollowed: number; skipped: number; failed: number },
    planned: UnfollowTarget[],
  ): PurgeReport => ({
    handle,
    user_id: viewer.id,
    dry_run: stoppedBy === "dry-run",
    following_total: state!.graph.following_total,
    non_mutual_total: state!.graph.non_mutual_total,
    mutual_total: mutualTotal,
    planned,
    ...counts,
    remaining: state!.queue.length,
    stopped_by: stoppedBy,
    state_path: persist ? statePath : undefined,
    failures: Object.values(state!.done).filter((r) => r.status === "failed"),
    elapsed_ms: now() - startedAt,
    eta_epoch: estimateEta(state!.queue.length, opts, now()),
  });

  if (dryRun) {
    log(`[purge] dry-run: ${state.queue.length} comptes seraient retirés, aucun appel de mutation`);
    return buildReport("dry-run", { unfollowed: 0, skipped: 0, failed: 0 }, state.queue);
  }

  // --- mutation loop -------------------------------------------------------
  const governor = new RateGovernor(opts, state.history);
  let unfollowed = 0;
  let skipped = 0;
  let failed = 0;

  const result = await runMutationQueue<UnfollowTarget>({
    queue: state.queue,
    mutate: (t) => client.unfollow(t.id),
    rateLimit: () => client.lastRateLimit,
    label: (t) => `@${t.username}${t.mutual ? " (mutuel)" : ""}`,
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
      const record: TargetRecord = {
        id: target.id,
        username: target.username,
        mutual: target.mutual,
        status: outcome.status === "done" ? "unfollowed" : outcome.status,
        at: outcome.at,
        reason: outcome.reason,
      };
      state!.done[record.id] = record;
      state!.history = governor.timestamps;
      state!.updated_at = now();
      if (persist) saveState(statePath, state!);

      if (record.status === "unfollowed") unfollowed++;
      else if (record.status === "skipped") skipped++;
      else failed++;

      opts.onProgress?.({
        record,
        processed: unfollowed + skipped + failed,
        remaining: state!.queue.length,
        unfollowed,
        skipped,
        failed,
      });
    },
  });

  state.history = governor.timestamps;
  state.updated_at = now();
  if (persist) saveState(statePath, state);

  return buildReport(result.stoppedBy, { unfollowed, skipped, failed }, []);
}
