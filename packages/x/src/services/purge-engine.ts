// SPDX-License-Identifier: Apache-2.0
/**
 * Shared core for the autonomous purge services.
 *
 * Both `unfollow.ts` (empty the following list) and `purge-tweets.ts` (delete
 * low-engagement posts) drive a long queue of irreversible mutations against
 * endpoints that throttle hard and flag bursts. The parts that must not
 * diverge between them live here:
 *
 *  - {@link RateGovernor} — the pacing budgets and `x-rate-limit-*` handling.
 *  - The error taxonomy ({@link isAuthFailure}, {@link isTerminalError},
 *    {@link isRateLimitError}) — deciding whether a failure means "skip this
 *    target", "wait", "retry", or "stop everything".
 *  - {@link runMutationQueue} — the loop that ties them together, persisting
 *    after every single mutation so a run is resumable at any point.
 *
 * A bug fixed in one purge is therefore fixed in both.
 */

import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { RateLimit } from "../core/client";
import { XError } from "../core/parse";

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** Rolling window used for the per-window budget (X thinks in 15 min slices). */
export const WINDOW_MS = 15 * 60 * 1000;

/** Rolling window used for the per-day budget. */
export const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

/**
 * API error codes meaning "this target can never be mutated again": it is
 * gone, suspended, or the action has already been applied. Recorded as
 * `skipped`, never retried.
 */
export const TERMINAL_CODES = new Set([34, 50, 63, 108, 144, 162, 179, 220, 425]);

/** API error codes that mean the session itself is dead. */
export const AUTH_CODES = new Set([32, 89, 99, 215]);

export function errorCode(err: unknown): number {
  return err instanceof XError ? err.code : -1;
}

export function errorStatus(err: unknown): number | undefined {
  return err instanceof XError ? err.status : undefined;
}

export function isRateLimitError(err: unknown): boolean {
  return errorCode(err) === 88 || errorStatus(err) === 429;
}

export function isTerminalError(err: unknown): boolean {
  return TERMINAL_CODES.has(errorCode(err)) || errorStatus(err) === 404;
}

/**
 * `true` when the failure is the session itself being rejected.
 *
 * Callers must be able to tell "the cookie is dead" from any other failure
 * *before* deciding to retry: relaunching against rejected credentials repairs
 * nothing and is exactly the pattern that gets an account flagged. The CLI
 * maps this to exit code 77 so systemd can refuse to restart.
 */
export function isAuthFailure(err: unknown): boolean {
  const status = errorStatus(err);
  return AUTH_CODES.has(errorCode(err)) || status === 401 || status === 403;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Abortable sleep. Resolves early (does not throw) when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Write JSON atomically with owner-only permissions.
 *
 * Purge journals name the accounts and posts being removed, so they are 0600;
 * the temp-file + rename keeps a crash from leaving a half-written queue.
 */
export function writeJsonPrivate(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort — a non-POSIX filesystem must not break the run
  }
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Knobs shared by every purge service. */
export interface PacingOptions {
  perWindow?: number;
  perDay?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  reserve?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

/** Conservative defaults, well under the observed ceilings. */
export const PACING_DEFAULTS = {
  perWindow: 45,
  perDay: 400,
  minDelayMs: 4_000,
  maxDelayMs: 11_000,
  /** Leave this many header-reported calls unused before waiting out the reset. */
  reserve: 2,
  /** Per-target transient retries before the target is parked as failed. */
  maxRetries: 3,
  /**
   * Consecutive rate-limit waits tolerated on a single target before the run
   * backs off entirely. The target stays queued — a persistent 429 means X
   * wants us gone, not that this target is unmutable.
   */
  maxRateLimitWaits: 6,
} as const;

/**
 * Enforces the pacing budgets for mutation calls.
 *
 * Three independent brakes, all of which must clear before a call goes out:
 * a randomised inter-call delay, a rolling {@link WINDOW_MS} cap, and a rolling
 * {@link DAY_MS} cap. After each call the governor also folds in whatever X
 * reported in `x-rate-limit-remaining` / `x-rate-limit-reset`, so a server-side
 * limit tighter than our own is respected too.
 */
export class RateGovernor {
  public readonly perWindow: number;
  public readonly perDay: number;
  public readonly minDelayMs: number;
  public readonly maxDelayMs: number;
  public readonly reserve: number;

  /** Epoch ms of every mutation, oldest first. */
  private history: number[];
  private lastCallAt = 0;
  private headerWaitUntil = 0;

  private readonly now: () => number;
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: PacingOptions = {}, history: number[] = []) {
    this.perWindow = opts.perWindow ?? PACING_DEFAULTS.perWindow;
    this.perDay = opts.perDay ?? PACING_DEFAULTS.perDay;
    this.minDelayMs = opts.minDelayMs ?? PACING_DEFAULTS.minDelayMs;
    this.maxDelayMs = Math.max(
      opts.maxDelayMs ?? PACING_DEFAULTS.maxDelayMs,
      this.minDelayMs,
    );
    this.reserve = opts.reserve ?? PACING_DEFAULTS.reserve;
    this.now = opts.now ?? Date.now;
    this.sleepFn = opts.sleep ?? sleep;
    this.random = opts.random ?? Math.random;
    this.history = [...history];
  }

  /** Mutation timestamps, pruned to the last {@link DAY_MS}. */
  public get timestamps(): number[] {
    return [...this.history];
  }

  private prune(): void {
    const cutoff = this.now() - DAY_MS;
    this.history = this.history.filter((t) => t > cutoff);
  }

  private countSince(ms: number): number {
    const cutoff = this.now() - ms;
    return this.history.filter((t) => t > cutoff).length;
  }

  /**
   * How long to wait before the next mutation may go out, in ms.
   * `0` means "go now"; a positive value is a hard wait.
   */
  public delayBeforeNext(): { waitMs: number; reason: string } {
    this.prune();
    const now = this.now();

    const headerWait = this.headerWaitUntil - now;
    if (headerWait > 0) {
      return { waitMs: headerWait, reason: "x-rate-limit-reset" };
    }

    if (this.countSince(DAY_MS) >= this.perDay) {
      const oldest = this.history[this.history.length - this.perDay];
      return { waitMs: Math.max(oldest + DAY_MS - now, 0) + 1_000, reason: "day-budget" };
    }

    if (this.countSince(WINDOW_MS) >= this.perWindow) {
      const inWindow = this.history.filter((t) => t > now - WINDOW_MS);
      const oldest = inWindow[inWindow.length - this.perWindow];
      return { waitMs: Math.max(oldest + WINDOW_MS - now, 0) + 1_000, reason: "window-budget" };
    }

    const jitter =
      this.minDelayMs + Math.floor(this.random() * (this.maxDelayMs - this.minDelayMs + 1));
    const sinceLast = now - this.lastCallAt;
    const waitMs = this.lastCallAt === 0 ? 0 : Math.max(jitter - sinceLast, 0);
    return { waitMs, reason: "pace" };
  }

  /** Blocks until a mutation is allowed. Returns the reason it had to wait. */
  public async acquire(signal?: AbortSignal): Promise<string | null> {
    let reason: string | null = null;
    // Re-check after each sleep: a long header wait can expose a budget wait.
    for (let guard = 0; guard < 64; guard++) {
      if (signal?.aborted) return reason;
      const { waitMs, reason: why } = this.delayBeforeNext();
      if (waitMs <= 0) return reason;
      reason = why;
      await this.sleepFn(waitMs, signal);
    }
    return reason;
  }

  /** Records a mutation and folds in the server-reported limit. */
  public record(rateLimit: RateLimit | null): void {
    const now = this.now();
    this.history.push(now);
    this.lastCallAt = now;
    this.prune();

    if (rateLimit && rateLimit.remaining <= this.reserve && rateLimit.reset_epoch > 0) {
      const resetMs = rateLimit.reset_epoch * 1000;
      if (resetMs > now) this.headerWaitUntil = resetMs + 1_000;
    }
  }

  /** Forces a wait after a 429 / code 88, using the reset header when present. */
  public penalise(rateLimit: RateLimit | null): number {
    const now = this.now();
    const resetMs = rateLimit?.reset_epoch ? rateLimit.reset_epoch * 1000 : 0;
    const until = resetMs > now ? resetMs + 1_000 : now + WINDOW_MS;
    this.headerWaitUntil = Math.max(this.headerWaitUntil, until);
    return until - now;
  }

  /** `true` when either rolling budget is saturated right now. */
  public budgetExhausted(): boolean {
    this.prune();
    return (
      this.countSince(WINDOW_MS) >= this.perWindow || this.countSince(DAY_MS) >= this.perDay
    );
  }
}

/**
 * Rough completion date for a queue of `remaining` targets, derived from the
 * budgets (the day cap is the binding constraint past a few hundred targets).
 */
export function estimateEta(
  remaining: number,
  opts: PacingOptions = {},
  from: number = Date.now(),
): number | undefined {
  if (remaining <= 0) return undefined;
  const perDay = opts.perDay ?? PACING_DEFAULTS.perDay;
  const perWindow = opts.perWindow ?? PACING_DEFAULTS.perWindow;
  const windowsPerDay = DAY_MS / WINDOW_MS;
  const effectivePerDay = Math.max(Math.min(perDay, perWindow * windowsPerDay), 1);
  return from + Math.ceil((remaining / effectivePerDay) * DAY_MS);
}

// ---------------------------------------------------------------------------
// Read resilience
// ---------------------------------------------------------------------------

export interface ReadRetryDeps {
  /** Reads the client's latest `x-rate-limit-*` snapshot. */
  rateLimit: () => RateLimit | null;
  /** Consecutive rate-limit waits tolerated before giving up. */
  maxWaits?: number;
  /** Transient-error retries before giving up. */
  maxRetries?: number;
  signal?: AbortSignal;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  log: (line: string) => void;
  /** Shown in the logs so a stall is attributable. */
  label: string;
}

/**
 * Runs one **read** (a timeline page) with the same patience as a mutation.
 *
 * Building a purge queue means walking hundreds of pages across several
 * timelines, so meeting a read rate limit is routine rather than exceptional.
 * Without this, a single 429 in the middle of the walk aborts the whole run and
 * throws away every page already fetched.
 *
 * Reads deliberately do **not** touch the {@link RateGovernor}: its budgets
 * exist to pace irreversible mutations, and spending them on pagination would
 * stall the actual purge for nothing.
 */
export async function readWithBackoff<T>(
  fetchPage: () => Promise<T>,
  d: ReadRetryDeps,
): Promise<T> {
  const maxWaits = d.maxWaits ?? PACING_DEFAULTS.maxRateLimitWaits;
  const maxRetries = d.maxRetries ?? PACING_DEFAULTS.maxRetries;

  let waits = 0;
  let retries = 0;

  for (;;) {
    try {
      return await fetchPage();
    } catch (err) {
      // A dead session or a gone resource will not improve with waiting.
      if (isAuthFailure(err) || isTerminalError(err)) throw err;

      if (isRateLimitError(err)) {
        if (++waits > maxWaits) throw err;
        const reset = d.rateLimit()?.reset_epoch;
        const resetMs = reset ? reset * 1000 - d.now() : 0;
        const waitMs = resetMs > 0 ? resetMs + 1_000 : WINDOW_MS;
        d.log(
          `[read] ${d.label}: rate limit — pause ${Math.round(waitMs / 1000)}s ` +
            `(${waits}/${maxWaits})`,
        );
        await d.sleep(waitMs, d.signal);
        if (d.signal?.aborted) throw err;
        continue;
      }

      if (++retries > maxRetries) throw err;
      const backoff = 2_000 * 2 ** (retries - 1);
      d.log(`[read] ${d.label}: ${errorMessage(err)} — retry dans ${backoff}ms`);
      await d.sleep(backoff, d.signal);
      if (d.signal?.aborted) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Mutation loop
// ---------------------------------------------------------------------------

export type MutationStatus = "done" | "skipped" | "failed";

export interface MutationOutcome {
  status: MutationStatus;
  at: number;
  reason?: string;
}

/** Why {@link runMutationQueue} returned. */
export type StopReason = "queue-empty" | "limit" | "budget" | "aborted" | "auth-error";

export interface RunQueueDeps<T extends { id: string }> {
  /** Consumed from the front; survivors stay queued for the next run. */
  queue: T[];
  /** The irreversible call. Throwing drives the error taxonomy. */
  mutate: (item: T) => Promise<void>;
  /** Persist a terminal outcome. Called exactly once per dequeued item. */
  commit: (item: T, outcome: MutationOutcome) => void;
  governor: RateGovernor;
  /** Reads the client's latest `x-rate-limit-*` snapshot. */
  rateLimit: () => RateLimit | null;
  /** Human-readable target name for the logs. */
  label: (item: T) => string;
  /** Stop after this many successful mutations. */
  limit?: number;
  /** Return when a budget is exhausted instead of sleeping through it. */
  once?: boolean;
  signal?: AbortSignal;
  maxRetries?: number;
  maxRateLimitWaits?: number;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  log: (line: string) => void;
}

export interface RunQueueResult {
  succeeded: number;
  skipped: number;
  failed: number;
  stoppedBy: StopReason;
}

/**
 * Drains `queue`, one paced mutation at a time, persisting after each.
 *
 * Failure handling, in priority order:
 *
 *  - **auth** → stop the whole run; retrying with dead credentials is what
 *    gets an account flagged.
 *  - **terminal** (gone, suspended, already applied) → record `skipped` and
 *    move on; the target will never succeed.
 *  - **rate limit** → back off to the reset and retry the *same* target; a
 *    throttle is not a strike against it. After `maxRateLimitWaits`
 *    consecutive waits, stop the run and leave the target queued.
 *  - **anything else** → exponential backoff up to `maxRetries`, then record
 *    `failed` and move on.
 */
export async function runMutationQueue<T extends { id: string }>(
  d: RunQueueDeps<T>,
): Promise<RunQueueResult> {
  const maxRetries = d.maxRetries ?? PACING_DEFAULTS.maxRetries;
  const maxRateLimitWaits = d.maxRateLimitWaits ?? PACING_DEFAULTS.maxRateLimitWaits;
  const limit = d.limit ?? Infinity;

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedBy: StopReason = "queue-empty";

  while (d.queue.length > 0) {
    if (d.signal?.aborted) {
      stoppedBy = "aborted";
      break;
    }
    if (succeeded >= limit) {
      stoppedBy = "limit";
      break;
    }
    if (d.once && d.governor.budgetExhausted()) {
      stoppedBy = "budget";
      break;
    }

    const waited = await d.governor.acquire(d.signal);
    if (d.signal?.aborted) {
      stoppedBy = "aborted";
      break;
    }
    if (waited && waited !== "pace") d.log(`[purge] budget « ${waited} » — reprise`);

    const item = d.queue[0];
    const name = d.label(item);
    let outcome: MutationOutcome | null = null;
    let rateLimitWaits = 0;
    let throttledOut = false;
    let authFailed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await d.mutate(item);
        d.governor.record(d.rateLimit());
        outcome = { status: "done", at: d.now() };
        break;
      } catch (err) {
        // The call still consumed quota even when it failed.
        d.governor.record(d.rateLimit());

        if (isAuthFailure(err)) {
          d.log(`[purge] session invalide: ${errorMessage(err)} — arrêt`);
          authFailed = true;
          break;
        }

        if (isTerminalError(err)) {
          outcome = { status: "skipped", at: d.now(), reason: errorMessage(err) };
          break;
        }

        if (isRateLimitError(err)) {
          if (++rateLimitWaits > maxRateLimitWaits) {
            d.log(
              `[purge] rate limit persistant après ${maxRateLimitWaits} attentes — ` +
                "arrêt du lot, la file est conservée",
            );
            throttledOut = true;
            break;
          }
          const waitMs = d.governor.penalise(d.rateLimit());
          d.log(`[purge] rate limit sur ${name} — pause ${Math.round(waitMs / 1000)}s`);
          await d.sleep(waitMs, d.signal);
          if (d.signal?.aborted) break;
          attempt--; // a throttle is not a strike against the target
          continue;
        }

        if (attempt >= maxRetries) {
          outcome = { status: "failed", at: d.now(), reason: errorMessage(err) };
          break;
        }

        const backoff = 2_000 * 2 ** attempt;
        d.log(`[purge] ${name}: ${errorMessage(err)} — retry dans ${backoff}ms`);
        await d.sleep(backoff, d.signal);
      }
    }

    if (authFailed) {
      stoppedBy = "auth-error";
      break;
    }
    if (!outcome) {
      // Signal fired mid-retry, or X throttled us out: leave the target queued.
      stoppedBy = throttledOut ? "budget" : "aborted";
      break;
    }

    d.queue.shift();
    d.commit(item, outcome);

    if (outcome.status === "done") succeeded++;
    else if (outcome.status === "skipped") skipped++;
    else failed++;

    const mark = outcome.status === "done" ? "✓" : outcome.status === "skipped" ? "·" : "✗";
    d.log(`[purge] ${mark} ${name} — ${succeeded} traités, ${d.queue.length} restants`);
  }

  return { succeeded, skipped, failed, stoppedBy };
}
