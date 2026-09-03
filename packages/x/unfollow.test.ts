// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { XClient } from "./src/core/client";
import { XError } from "./src/core/parse";
import type { User } from "./src/core/parse";
import {
  buildQueue,
  captureFollowGraph,
  collectFollowing,
  DAY_MS,
  estimateEta,
  isAuthFailure,
  loadState,
  purgeFollowing,
  RateGovernor,
  WINDOW_MS,
  type PurgeOptions,
  type PurgeState,
} from "./src/services/unfollow";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

/** Deterministic clock whose `sleep` advances time instead of waiting. */
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

function user(id: string, username = `u${id}`): User {
  return { id, username, name: username };
}

interface FakeOpts {
  following: User[];
  followers: User[];
  /** Per-user-id error to throw on unfollow. A list is consumed one per call. */
  errors?: Record<string, Error[]>;
  pageSize?: number;
}

/** Minimal XClient stand-in: paginated graph + recorded unfollow calls. */
function fakeClient(opts: FakeOpts) {
  const pageSize = opts.pageSize ?? 100;
  const calls: string[] = [];
  const errors: Record<string, Error[]> = {};
  for (const [k, v] of Object.entries(opts.errors ?? {})) errors[k] = [...v];

  const paginate = (all: User[], cursor?: string) => {
    const offset = cursor ? parseInt(cursor.replace("cursor-", ""), 10) : 0;
    const slice = all.slice(offset, offset + pageSize);
    const next = offset + pageSize;
    return {
      users: slice,
      next_cursor: next < all.length ? `cursor-${next}` : undefined,
    };
  };

  const client = {
    session: { handle: "tester" },
    lastRateLimit: null as null | { limit: number; remaining: number; reset_epoch: number },
    whoami: async () => ({ id: "viewer-1", name: "Tester", screen_name: "tester" }),
    following: async (_id: string, _count: number, cursor?: string) =>
      paginate(opts.following, cursor),
    followers: async (_id: string, _count: number, cursor?: string) =>
      paginate(opts.followers, cursor),
    unfollow: async (userId: string) => {
      calls.push(userId);
      const queued = errors[userId];
      if (queued && queued.length > 0) throw queued.shift();
    },
  };

  return { client: client as unknown as XClient, calls, raw: client };
}

function baseOpts(clock: ReturnType<typeof fakeClock>): PurgeOptions {
  return {
    persist: false,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0,
  };
}

// ---------------------------------------------------------------------------
// Queue ordering
// ---------------------------------------------------------------------------

describe("buildQueue", () => {
  test("non-mutuals come first, mutuals last", () => {
    const following = [user("1"), user("2"), user("3"), user("4")];
    const queue = buildQueue(following, ["2", "4"]);

    expect(queue.map((t) => t.id)).toEqual(["1", "3", "2", "4"]);
    expect(queue.slice(0, 2).every((t) => !t.mutual)).toBe(true);
    expect(queue.slice(2).every((t) => t.mutual)).toBe(true);
  });

  test("preserves timeline order inside each group", () => {
    const following = [user("a"), user("b"), user("c"), user("d"), user("e")];
    const queue = buildQueue(following, new Set(["a", "c"]));
    expect(queue.map((t) => t.id)).toEqual(["b", "d", "e", "a", "c"]);
  });

  test("nonMutualOnly drops mutuals entirely", () => {
    const queue = buildQueue([user("1"), user("2")], ["2"], { nonMutualOnly: true });
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe("1");
  });

  test("empty following yields an empty queue", () => {
    expect(buildQueue([], ["1", "2"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rate governor
// ---------------------------------------------------------------------------

describe("RateGovernor", () => {
  test("first call goes out immediately, later ones are paced", async () => {
    const clock = fakeClock();
    const gov = new RateGovernor({
      ...baseOpts(clock),
      minDelayMs: 5_000,
      maxDelayMs: 5_000,
    });

    expect(gov.delayBeforeNext().waitMs).toBe(0);
    gov.record(null);

    const { waitMs, reason } = gov.delayBeforeNext();
    expect(reason).toBe("pace");
    expect(waitMs).toBe(5_000);

    await gov.acquire();
    expect(clock.now()).toBe(T0 + 5_000);
    expect(gov.delayBeforeNext().waitMs).toBe(0);
  });

  test("window budget forces a wait until the oldest call ages out", () => {
    const clock = fakeClock();
    const gov = new RateGovernor({ ...baseOpts(clock), perWindow: 3, minDelayMs: 0, maxDelayMs: 0 });

    for (let i = 0; i < 3; i++) {
      gov.record(null);
      clock.advance(1_000);
    }

    expect(gov.budgetExhausted()).toBe(true);
    const { waitMs, reason } = gov.delayBeforeNext();
    expect(reason).toBe("window-budget");
    // Oldest call was 3s ago; it ages out one window after it happened.
    expect(waitMs).toBeGreaterThan(WINDOW_MS - 3_100);
    expect(waitMs).toBeLessThanOrEqual(WINDOW_MS);
  });

  test("day budget outranks the window budget", () => {
    const clock = fakeClock();
    const gov = new RateGovernor({
      ...baseOpts(clock),
      perWindow: 1_000,
      perDay: 2,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    gov.record(null);
    clock.advance(WINDOW_MS * 2);
    gov.record(null);

    const { waitMs, reason } = gov.delayBeforeNext();
    expect(reason).toBe("day-budget");
    expect(waitMs).toBeGreaterThan(DAY_MS - WINDOW_MS * 2 - 1);
  });

  test("honours x-rate-limit-remaining by waiting for the reset", () => {
    const clock = fakeClock();
    const gov = new RateGovernor({ ...baseOpts(clock), reserve: 2, minDelayMs: 0, maxDelayMs: 0 });

    const resetEpoch = Math.floor((T0 + 60_000) / 1000);
    gov.record({ limit: 50, remaining: 1, reset_epoch: resetEpoch });

    const { waitMs, reason } = gov.delayBeforeNext();
    expect(reason).toBe("x-rate-limit-reset");
    expect(waitMs).toBeGreaterThan(55_000);
  });

  test("a healthy remaining count does not trigger a header wait", () => {
    const clock = fakeClock();
    const gov = new RateGovernor({ ...baseOpts(clock), reserve: 2, minDelayMs: 0, maxDelayMs: 0 });
    gov.record({ limit: 50, remaining: 40, reset_epoch: Math.floor((T0 + 60_000) / 1000) });
    expect(gov.delayBeforeNext().reason).toBe("pace");
  });

  test("penalise falls back to a full window with no reset header", () => {
    const clock = fakeClock();
    const gov = new RateGovernor(baseOpts(clock));
    const waitMs = gov.penalise(null);
    expect(waitMs).toBe(WINDOW_MS);
    expect(gov.delayBeforeNext().reason).toBe("x-rate-limit-reset");
  });

  test("history is pruned to the last 24h", () => {
    const clock = fakeClock();
    const gov = new RateGovernor(baseOpts(clock));
    gov.record(null);
    clock.advance(DAY_MS + 60_000);
    gov.record(null);
    expect(gov.timestamps).toHaveLength(1);
  });

  test("seeded history from a previous run is honoured", () => {
    const clock = fakeClock();
    const gov = new RateGovernor(
      { ...baseOpts(clock), perWindow: 2, minDelayMs: 0, maxDelayMs: 0 },
      [T0 - 1_000, T0 - 500],
    );
    expect(gov.budgetExhausted()).toBe(true);
    expect(gov.delayBeforeNext().reason).toBe("window-budget");
  });
});

// ---------------------------------------------------------------------------
// Graph collection
// ---------------------------------------------------------------------------

describe("graph collection", () => {
  test("walks every page and dedupes", async () => {
    const following = Array.from({ length: 250 }, (_, i) => user(String(i)));
    const { client } = fakeClient({ following, followers: [], pageSize: 100 });

    const res = await collectFollowing(client, "viewer-1", { pageSize: 100 });
    expect(res.users).toHaveLength(250);
    expect(res.pages).toBe(3);
    expect(res.complete).toBe(true);
    expect(new Set(res.users.map((u) => u.id)).size).toBe(250);
  });

  test("maxPages caps the walk and reports it as incomplete", async () => {
    const following = Array.from({ length: 500 }, (_, i) => user(String(i)));
    const { client } = fakeClient({ following, followers: [], pageSize: 100 });

    const res = await collectFollowing(client, "viewer-1", { pageSize: 100, maxPages: 2 });
    expect(res.users).toHaveLength(200);
    expect(res.complete).toBe(false);
  });

  test("a repeated cursor stops pagination instead of looping forever", async () => {
    let pages = 0;
    const client = {
      following: async () => {
        pages++;
        return { users: [user("1")], next_cursor: "stuck" };
      },
    } as unknown as XClient;

    const res = await collectFollowing(client, "viewer-1", {});
    expect(pages).toBe(2); // second page returns the same cursor → stop
    expect(res.users).toHaveLength(1);
  });

  test("captureFollowGraph reads both sides", async () => {
    const { client } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [user("2")],
    });
    const graph = await captureFollowGraph(client, "viewer-1", "tester", {});
    expect(graph.following).toHaveLength(3);
    expect(graph.follower_ids).toEqual(["2"]);
    expect(graph.following_complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Purge engine
// ---------------------------------------------------------------------------

describe("purgeFollowing", () => {
  test("dry-run plans the queue without any mutation", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [user("2")],
    });

    const report = await purgeFollowing(client, { ...baseOpts(clock) });

    expect(calls).toHaveLength(0);
    expect(report.dry_run).toBe(true);
    expect(report.stopped_by).toBe("dry-run");
    expect(report.following_total).toBe(3);
    expect(report.non_mutual_total).toBe(2);
    expect(report.mutual_total).toBe(1);
    expect(report.planned.map((t) => t.id)).toEqual(["1", "3", "2"]);
    expect(report.eta_epoch).toBeGreaterThan(clock.now());
  });

  test("live run empties the whole list, non-mutuals first", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3"), user("4")],
      followers: [user("1"), user("4")],
    });

    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });

    expect(calls).toEqual(["2", "3", "1", "4"]);
    expect(report.unfollowed).toBe(4);
    expect(report.remaining).toBe(0);
    expect(report.stopped_by).toBe("queue-empty");
    expect(report.failed).toBe(0);
  });

  test("pacing is applied between mutations", async () => {
    const clock = fakeClock();
    const { client } = fakeClient({ following: [user("1"), user("2"), user("3")], followers: [] });

    await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      minDelayMs: 6_000,
      maxDelayMs: 6_000,
    });

    // 3 unfollows → 2 inter-call delays.
    expect(clock.now()).toBe(T0 + 12_000);
  });

  test("nonMutualOnly stops at the mutuals", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [user("3")],
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      nonMutualOnly: true,
    });

    expect(calls).toEqual(["1", "2"]);
    expect(report.unfollowed).toBe(2);
  });

  test("limit caps a single run and leaves the rest queued", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3"), user("4")],
      followers: [],
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      limit: 2,
    });

    expect(calls).toEqual(["1", "2"]);
    expect(report.unfollowed).toBe(2);
    expect(report.remaining).toBe(2);
    expect(report.stopped_by).toBe("limit");
  });

  test("suspended / missing accounts are skipped, not retried", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2")],
      followers: [],
      errors: { "1": [new XError("X API error 63: User has been suspended", 63)] },
    });

    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });

    expect(calls).toEqual(["1", "2"]); // one attempt on the dead account, then move on
    expect(report.skipped).toBe(1);
    expect(report.unfollowed).toBe(1);
    expect(report.failed).toBe(0);
  });

  test("a rate limit pauses and retries the same target", async () => {
    const clock = fakeClock();
    const { client, raw } = fakeClient({
      following: [user("1")],
      followers: [],
      errors: { "1": [new XError("X API error 88: Rate limit exceeded", 88)] },
    });
    raw.lastRateLimit = { limit: 50, remaining: 0, reset_epoch: Math.floor((T0 + 300_000) / 1000) };

    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });

    expect(report.unfollowed).toBe(1);
    expect(report.failed).toBe(0);
    // Waited out the reset window rather than hammering.
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + 300_000);
  });

  test("a persistent rate limit stops the run and keeps the target queued", async () => {
    const clock = fakeClock();
    const rateLimited = () => new XError("X API error 88: Rate limit exceeded", 88);
    const { client } = fakeClient({
      following: [user("1"), user("2")],
      followers: [],
      errors: { "1": Array.from({ length: 20 }, rateLimited) },
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      maxRateLimitWaits: 3,
    });

    expect(report.stopped_by).toBe("budget");
    expect(report.unfollowed).toBe(0);
    expect(report.remaining).toBe(2);
  });

  test("transient errors are retried then parked as failed", async () => {
    const clock = fakeClock();
    const boom = () => new XError("HTTP 500", -1, 500);
    const { client, calls } = fakeClient({
      following: [user("1"), user("2")],
      followers: [],
      errors: { "1": [boom(), boom(), boom(), boom(), boom()] },
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      maxRetries: 2,
    });

    // 3 attempts on target 1 (initial + 2 retries), then target 2.
    expect(calls).toEqual(["1", "1", "1", "2"]);
    expect(report.failed).toBe(1);
    expect(report.unfollowed).toBe(1);
    expect(report.failures[0].username).toBe("u1");
  });

  test("a transient error that clears is retried successfully", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1")],
      followers: [],
      errors: { "1": [new XError("HTTP 503", -1, 503)] },
    });

    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });
    expect(calls).toEqual(["1", "1"]);
    expect(report.unfollowed).toBe(1);
    expect(report.failed).toBe(0);
  });

  test("an auth error aborts the whole run", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [],
      errors: { "1": [new XError("X API error 32: Could not authenticate you", 32)] },
    });

    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });

    expect(calls).toEqual(["1"]);
    expect(report.stopped_by).toBe("auth-error");
    expect(report.unfollowed).toBe(0);
    expect(report.remaining).toBe(3);
  });

  test("an abort signal stops cleanly and keeps the target queued", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [],
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.processed === 1) controller.abort();
      },
    });

    expect(calls).toEqual(["1"]);
    expect(report.stopped_by).toBe("aborted");
    expect(report.remaining).toBe(2);
  });

  test("once returns instead of sleeping through an exhausted budget", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [],
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      once: true,
      perWindow: 2,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(calls).toEqual(["1", "2"]);
    expect(report.stopped_by).toBe("budget");
    expect(clock.now()).toBe(T0); // no sleeping
  });

  test("without once it sleeps through the window and finishes", async () => {
    const clock = fakeClock();
    const { client, calls } = fakeClient({
      following: [user("1"), user("2"), user("3")],
      followers: [],
    });

    const report = await purgeFollowing(client, {
      ...baseOpts(clock),
      dryRun: false,
      perWindow: 2,
      minDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(calls).toEqual(["1", "2", "3"]);
    expect(report.stopped_by).toBe("queue-empty");
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + WINDOW_MS);
  });
});

// ---------------------------------------------------------------------------
// Journal / resume
// ---------------------------------------------------------------------------

describe("resumable journal", () => {
  test("a stopped run resumes exactly where it left off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-unfollow-"));
    const statePath = join(dir, "state.json");
    try {
      const clock = fakeClock();
      const { client, calls } = fakeClient({
        following: [user("1"), user("2"), user("3"), user("4")],
        followers: [user("4")],
      });

      const first = await purgeFollowing(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        limit: 2,
        statePath,
      });
      expect(first.unfollowed).toBe(2);
      expect(calls).toEqual(["1", "2"]);

      const state = loadState(statePath) as PurgeState;
      expect(state.queue.map((t) => t.id)).toEqual(["3", "4"]);
      expect(Object.keys(state.done)).toHaveLength(2);
      expect(state.history).toHaveLength(2);

      // Second run: graph is NOT re-read, the queue continues.
      const second = await purgeFollowing(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        statePath,
      });

      expect(calls).toEqual(["1", "2", "3", "4"]);
      expect(second.unfollowed).toBe(2);
      expect(second.remaining).toBe(0);

      const final = loadState(statePath) as PurgeState;
      expect(final.queue).toHaveLength(0);
      expect(Object.keys(final.done)).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the journal is written owner-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-unfollow-"));
    const statePath = join(dir, "state.json");
    try {
      const clock = fakeClock();
      const { client } = fakeClient({ following: [user("1")], followers: [] });
      await purgeFollowing(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        statePath,
      });
      const mode = Bun.file(statePath).size >= 0 ? readFileSync(statePath, "utf-8") : "";
      expect(mode).toContain('"version": 1');
      // NTFS n'a pas de bits POSIX : l'assertion ne vaut que hors Windows,
      // où writeJsonPrivate() avertit à la place (cf. CROSS-PLATFORM.md M7).
      if (process.platform !== "win32") {
        const { statSync } = await import("node:fs");
        expect(statSync(statePath).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refresh rebuilds the queue from a fresh graph read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-unfollow-"));
    const statePath = join(dir, "state.json");
    try {
      const clock = fakeClock();
      const { client, calls } = fakeClient({
        following: [user("1"), user("2")],
        followers: [],
      });

      await purgeFollowing(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: false,
        limit: 1,
        statePath,
      });
      expect(calls).toEqual(["1"]);

      const report = await purgeFollowing(client, {
        now: clock.now,
        sleep: clock.sleep,
        random: () => 0,
        dryRun: true,
        refresh: true,
        statePath,
      });

      // The fake graph is static, so a refresh re-plans both accounts.
      expect(report.planned.map((t) => t.id)).toEqual(["1", "2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a journal belonging to another account is ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "bxc-unfollow-"));
    const statePath = join(dir, "state.json");
    try {
      Bun.write(
        statePath,
        JSON.stringify({ version: 1, user_id: "someone-else", queue: [] }),
      );
      expect(loadState(statePath, "viewer-1")).toBeNull();
      expect(loadState(statePath, "someone-else")).not.toBeNull();
      expect(loadState(join(dir, "missing.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isAuthFailure", () => {
  test("recognises the API codes that mean a dead session", () => {
    for (const code of [32, 89, 99, 215]) {
      expect(isAuthFailure(new XError(`X API error ${code}`, code))).toBe(true);
    }
  });

  test("recognises 401 / 403 statuses", () => {
    expect(isAuthFailure(new XError("HTTP 401", -1, 401))).toBe(true);
    expect(isAuthFailure(new XError("HTTP 403", -1, 403))).toBe(true);
  });

  test("does not fire on transient or terminal target errors", () => {
    expect(isAuthFailure(new XError("HTTP 503", -1, 503))).toBe(false);
    expect(isAuthFailure(new XError("suspended", 63))).toBe(false);
    expect(isAuthFailure(new XError("rate limited", 88))).toBe(false);
    expect(isAuthFailure(new Error("boom"))).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });

  test("matches what the purge loop treats as an auth abort", async () => {
    const clock = fakeClock();
    const { client } = fakeClient({
      following: [user("1")],
      followers: [],
      errors: { "1": [new XError("X API error 89: invalid token", 89)] },
    });
    const report = await purgeFollowing(client, { ...baseOpts(clock), dryRun: false });
    expect(report.stopped_by).toBe("auth-error");
  });
});

// ---------------------------------------------------------------------------
// ETA
// ---------------------------------------------------------------------------

describe("estimateEta", () => {
  test("an empty queue has no ETA", () => {
    expect(estimateEta(0, {}, T0)).toBeUndefined();
  });

  test("the day budget drives the estimate", () => {
    // 800 targets at 400/day → 2 days.
    const eta = estimateEta(800, { perDay: 400, perWindow: 1_000 }, T0);
    expect(eta).toBe(T0 + 2 * DAY_MS);
  });

  test("a tight window budget binds before the day budget", () => {
    // 10/window → 960/day theoretical, but perDay 400 caps it.
    const eta = estimateEta(400, { perDay: 400, perWindow: 10 }, T0);
    expect(eta).toBe(T0 + DAY_MS);
  });
});
