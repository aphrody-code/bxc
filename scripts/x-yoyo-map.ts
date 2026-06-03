#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * x-yoyo-map — full account explorer for @aphrody-code/x
 *
 * Paginates every high-level XClient surface (authored, likes, bookmarks,
 * home, mentions, graph, news, lists), stores canonical rows in the shared
 * Store schema, and archives raw API payloads + sync metadata in yoyo.sqlite.
 *
 * Usage:
 *   bun run scripts/x-yoyo-map.ts
 *   bun run scripts/x-yoyo-map.ts --db ~/.aphrody/yoyo.sqlite --max-pages 10
 *   bun run scripts/x-yoyo-map.ts --kinds authored,likes,graph --count 100
 *
 * Auth: ~/.aphrody/x-session.json or X_AUTH_TOKEN + X_CT0 (see packages/x).
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  XClient,
  XSession,
  Store,
  edge,
  allOperations,
  parseUserResult,
  walkTimelineTweets,
  type Tweet,
  type TweetPage,
  type User,
  type UserPage,
} from "../packages/x/src/index.ts";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const KINDS = [
  "whoami",
  "profile",
  "authored",
  "likes",
  "bookmarks",
  "timeline",
  "mentions",
  "following",
  "followers",
  "news",
  "lists",
  "search-self",
] as const;

type Kind = (typeof KINDS)[number];

interface Options {
  dbPath: string;
  handle?: string;
  kinds: Kind[];
  count: number;
  maxPages: number;
  quoteDepth: number;
  dryRun: boolean;
  bookmarkQuery: string;
}

function parseArgv(argv: string[]): Options {
  const home = homedir() || ".";
  const opts: Options = {
    dbPath: join(home, ".aphrody", "yoyo.sqlite"),
    kinds: [...KINDS],
    count: 40,
    maxPages: 5,
    quoteDepth: 1,
    dryRun: false,
    bookmarkQuery: process.env.YOYO_BOOKMARK_QUERY || "a",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--db":
        opts.dbPath = argv[++i] ?? opts.dbPath;
        break;
      case "--handle":
        opts.handle = argv[++i]?.replace(/^@/, "");
        break;
      case "--kinds":
        opts.kinds = (argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim() as Kind)
          .filter((k) => KINDS.includes(k));
        break;
      case "--count":
      case "-n":
        opts.count = Math.max(1, parseInt(argv[++i], 10) || opts.count);
        break;
      case "--max-pages":
        opts.maxPages = Math.max(1, parseInt(argv[++i], 10) || opts.maxPages);
        break;
      case "--quote-depth":
        opts.quoteDepth = Math.max(0, parseInt(argv[++i], 10) || opts.quoteDepth);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--bookmark-query":
        opts.bookmarkQuery = argv[++i] ?? opts.bookmarkQuery;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith("-")) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`x-yoyo-map — map your X account into yoyo.sqlite (bun:sqlite + @aphrody-code/x)

Usage:
  bun run scripts/x-yoyo-map.ts [options]

Options:
  --db <path>         SQLite path (default: ~/.aphrody/yoyo.sqlite)
  --handle <h>        Override screen name (default: session / whoami)
  --kinds <list>      Comma-separated sync kinds (default: all)
                      ${KINDS.join(", ")}
  --count, -n <N>     Items per page (default: 40)
  --max-pages <N>     Pagination cap per kind (default: 5)
  --quote-depth <N>   Quoted-tweet nesting (default: 1)
  --dry-run           Plan only, no API calls
  --help, -h          This help
`);
}

// ---------------------------------------------------------------------------
// Yoyo DB — Store + analytics / raw archive tables
// ---------------------------------------------------------------------------

class YoyoDB {
  public readonly store: Store;
  private readonly meta: Database;

  constructor(path: string) {
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.store = new Store(path);
    this.meta = this.store.db;
    this.migrateMeta();
  }

  private migrateMeta(): void {
    this.meta.exec(`
      CREATE TABLE IF NOT EXISTS sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT,
        account TEXT NOT NULL,
        kinds TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 1,
        summary_json TEXT
      );

      CREATE TABLE IF NOT EXISTS raw_snapshots (
        key TEXT NOT NULL,
        account TEXT NOT NULL,
        fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        json TEXT NOT NULL,
        PRIMARY KEY (account, key)
      );

      CREATE TABLE IF NOT EXISTS sync_kind_stats (
        run_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        pages INTEGER NOT NULL DEFAULT 0,
        items INTEGER NOT NULL DEFAULT 0,
        errors TEXT,
        PRIMARY KEY (run_id, kind),
        FOREIGN KEY (run_id) REFERENCES sync_runs(id)
      );

      CREATE TABLE IF NOT EXISTS graphql_catalog (
        name TEXT PRIMARY KEY,
        query_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        feature_switches TEXT
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        captured_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        endpoint TEXT,
        limit_val INTEGER,
        remaining INTEGER,
        reset_epoch INTEGER
      );

      CREATE TABLE IF NOT EXISTS entity_map (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        account TEXT NOT NULL,
        label TEXT,
        meta_json TEXT,
        PRIMARY KEY (entity_type, entity_id, account)
      );
    `);
  }

  beginRun(account: string, kinds: Kind[]): number {
    const r = this.meta
      .query(
        `INSERT INTO sync_runs (account, kinds) VALUES (?1, ?2) RETURNING id`,
      )
      .get(account, kinds.join(",")) as { id: number };
    return r.id;
  }

  finishRun(
    runId: number,
    summary: Record<string, unknown>,
    ok = true,
  ): void {
    this.meta.run(
      `UPDATE sync_runs SET finished_at = datetime('now'), summary_json = ?2, ok = ?3 WHERE id = ?1`,
      [runId, JSON.stringify(summary), ok ? 1 : 0],
    );
  }

  recordKind(
    runId: number,
    kind: string,
    pages: number,
    items: number,
    err?: string,
  ): void {
    this.meta.run(
      `INSERT OR REPLACE INTO sync_kind_stats (run_id, kind, pages, items, errors)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
      [runId, kind, pages, items, err ?? null],
    );
  }

  snapshot(account: string, key: string, data: unknown): void {
    this.meta.run(
      `INSERT INTO raw_snapshots (account, key, json) VALUES (?1, ?2, ?3)
       ON CONFLICT(account, key) DO UPDATE SET json = excluded.json, fetched_at = strftime('%s','now')`,
      [account, key, JSON.stringify(data)],
    );
  }

  upsertCatalog(): number {
    const ins = this.meta.prepare(
      `INSERT OR REPLACE INTO graphql_catalog (name, query_id, operation_type, feature_switches)
       VALUES (?1, ?2, ?3, ?4)`,
    );
    const tx = this.meta.transaction(() => {
      for (const op of allOperations()) {
        ins.run(
          op.name,
          op.queryId,
          op.operationType,
          JSON.stringify(op.featureSwitches),
        );
      }
    });
    tx();
    return allOperations().length;
  }

  captureRateLimit(client: XClient, endpoint: string): void {
    const rl = client.lastRateLimit;
    if (!rl) return;
    this.meta.run(
      `INSERT INTO rate_limits (endpoint, limit_val, remaining, reset_epoch)
       VALUES (?1, ?2, ?3, ?4)`,
      [endpoint, rl.limit, rl.remaining, rl.reset_epoch],
    );
  }

  mapEntity(
    account: string,
    entityType: string,
    entityId: string,
    label: string,
    meta?: Record<string, unknown>,
  ): void {
    this.meta.run(
      `INSERT INTO entity_map (entity_type, entity_id, account, label, meta_json)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(entity_type, entity_id, account) DO UPDATE SET
         label = excluded.label, meta_json = excluded.meta_json`,
      [
        entityType,
        entityId,
        account,
        label,
        meta ? JSON.stringify(meta) : null,
      ],
    );
  }

  close(): void {
    this.store.close();
  }
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

async function paginateTweets(
  fetchPage: (cursor?: string) => Promise<TweetPage>,
  maxPages: number,
  onTweet: (t: Tweet) => void,
): Promise<{ pages: number; items: number }> {
  let cursor: string | undefined;
  let pages = 0;
  let items = 0;

  while (pages < maxPages) {
    const page = await fetchPage(cursor);
    pages++;
    for (const t of page.tweets) {
      onTweet(t);
      items++;
    }
    if (!page.next_cursor || page.tweets.length === 0) break;
    cursor = page.next_cursor;
  }
  return { pages, items };
}

async function paginateUsers(
  fetchPage: (cursor?: string) => Promise<UserPage>,
  maxPages: number,
  onUser: (u: User) => void,
): Promise<{ pages: number; items: number }> {
  let cursor: string | undefined;
  let pages = 0;
  let items = 0;

  while (pages < maxPages) {
    const page = await fetchPage(cursor);
    pages++;
    for (const u of page.users) {
      onUser(u);
      items++;
    }
    if (!page.next_cursor || page.users.length === 0) break;
    cursor = page.next_cursor;
  }
  return { pages, items };
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

interface KindResult {
  pages: number;
  items: number;
  error?: string;
}

async function runKind(
  kind: Kind,
  client: XClient,
  db: YoyoDB,
  account: string,
  userId: string,
  opts: Options,
  runId: number,
): Promise<KindResult> {
  const ingestTweet = (t: Tweet, edgeKind: string) => {
    db.store.upsertTweet(t);
    db.store.addEdge(account, edgeKind, t.id);
    db.mapEntity(account, "tweet", t.id, t.text.slice(0, 120), {
      author: t.author.username,
      likes: t.like_count,
      created_at: t.created_at,
    });
  };

  const qd = opts.quoteDepth;

  try {
    switch (kind) {
      case "whoami": {
        const me = await client.whoami();
        db.snapshot(account, "whoami", me);
        db.store.upsertUser({
          id: me.id,
          username: me.screen_name,
          name: me.name,
          followers_count: me.followers_count,
          following_count: me.friends_count,
        });
        db.mapEntity(account, "account", me.id, `@${me.screen_name}`, me);
        db.captureRateLimit(client, "Viewer");
        db.recordKind(runId, kind, 1, 1);
        return { pages: 1, items: 1 };
      }

      case "profile": {
        const raw = await client.graphqlWaiting("UserByScreenName", {
          screen_name: account,
          withSafetyModeUserFields: true,
        });
        db.snapshot(account, "profile_graphql", raw);
        const userNode = raw?.data?.user?.result;
        const parsed = userNode ? parseUserResult(userNode) : null;
        if (parsed) {
          db.store.upsertUser(parsed);
          db.mapEntity(account, "profile", parsed.id, `@${parsed.username}`, parsed);
        }
        db.captureRateLimit(client, "UserByScreenName");
        db.recordKind(runId, kind, 1, parsed ? 1 : 0);
        return { pages: 1, items: parsed ? 1 : 0 };
      }

      case "authored": {
        const r = await paginateTweets(
          (c) => client.userTweets(userId, opts.count, c, qd),
          opts.maxPages,
          (t) => ingestTweet(t, edge.AUTHORED),
        );
        db.captureRateLimit(client, "UserTweets");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "likes": {
        const r = await paginateTweets(
          (c) => client.likes(userId, opts.count, c, qd),
          opts.maxPages,
          (t) => ingestTweet(t, edge.LIKED),
        );
        db.captureRateLimit(client, "Likes");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "bookmarks": {
        // X web bundle no longer exposes a "Bookmarks" timeline op; search within
        // bookmarks via BookmarkSearchTimeline (requires non-empty rawQuery).
        const r = await paginateTweets(
          async (c) => {
            const variables: Record<string, unknown> = {
              count: opts.count,
              includePromotedContent: false,
              rawQuery: opts.bookmarkQuery,
            };
            if (c) variables.cursor = c;
            const json = await client.graphqlWaiting(
              "BookmarkSearchTimeline",
              variables,
            );
            return walkTimelineTweets(json, qd);
          },
          opts.maxPages,
          (t) => ingestTweet(t, edge.BOOKMARKED),
        );
        db.snapshot(account, "bookmarks_query", {
          op: "BookmarkSearchTimeline",
          rawQuery: opts.bookmarkQuery,
          note: "Full bookmark list op absent from 2026 catalog; probe via search.",
        });
        db.captureRateLimit(client, "BookmarkSearchTimeline");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "timeline": {
        const r = await paginateTweets(
          (c) => client.home(opts.count, c, false, qd),
          opts.maxPages,
          (t) => ingestTweet(t, edge.TIMELINE),
        );
        db.captureRateLimit(client, "HomeTimeline");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "mentions": {
        const query = `(@${account})`;
        const r = await paginateTweets(
          (c) => client.search(query, opts.count, c, "Latest", qd),
          opts.maxPages,
          (t) => ingestTweet(t, edge.MENTION),
        );
        db.snapshot(account, "mentions_query", { query });
        db.captureRateLimit(client, "SearchTimeline");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "following": {
        const r = await paginateUsers(
          (c) => client.following(userId, opts.count, c),
          opts.maxPages,
          (u) => {
            db.store.upsertUser(u);
            db.store.addFollow(account, "following", u);
            db.mapEntity(account, "following", u.id, `@${u.username}`, u);
          },
        );
        db.captureRateLimit(client, "Following");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "followers": {
        const r = await paginateUsers(
          (c) => client.followers(userId, opts.count, c),
          opts.maxPages,
          (u) => {
            db.store.upsertUser(u);
            db.store.addFollow(account, "follower", u);
            db.mapEntity(account, "follower", u.id, `@${u.username}`, u);
          },
        );
        db.captureRateLimit(client, "Followers");
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      case "news": {
        const items = await client.getNews(opts.count);
        db.snapshot(account, "news", items);
        for (const item of items) {
          db.mapEntity(account, "news", item.id ?? item.headline, item.headline, item);
        }
        db.captureRateLimit(client, "ExploreNews");
        db.recordKind(runId, kind, 1, items.length);
        return { pages: 1, items: items.length };
      }

      case "lists": {
        const owned = await client.lists(userId, false, 50);
        const memberOf = await client.lists(userId, true, 50);
        db.snapshot(account, "lists_owned", owned);
        db.snapshot(account, "lists_member", memberOf);
        let items = 0;
        for (const l of [...owned, ...memberOf]) {
          db.mapEntity(account, "list", l.id, l.name, l);
          items++;
        }
        db.recordKind(runId, kind, 1, items);
        return { pages: 1, items };
      }

      case "search-self": {
        const r = await paginateTweets(
          (c) => client.search(`from:${account}`, opts.count, c, "Latest", qd),
          Math.min(opts.maxPages, 3),
          (t) => ingestTweet(t, edge.AUTHORED),
        );
        db.snapshot(account, "search_from_self", { query: `from:${account}` });
        db.recordKind(runId, kind, r.pages, r.items);
        return r;
      }

      default:
        return { pages: 0, items: 0, error: "unknown kind" };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    db.recordKind(runId, kind, 0, 0, msg);
    return { pages: 0, items: 0, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));

  if (opts.dryRun) {
    console.log(JSON.stringify({ plan: opts }, null, 2));
    return;
  }

  const session = XSession.loadOrEnv();
  const client = new XClient(session);
  const db = new YoyoDB(opts.dbPath);

  const catalogCount = db.upsertCatalog();
  console.error(`[yoyo] Embedded GraphQL catalog: ${catalogCount} operations`);

  let account = opts.handle ?? session.handle;
  let userId = "";

  if (!account || opts.kinds.includes("whoami")) {
    const me = await client.whoami();
    account = account ?? me.screen_name;
    userId = me.id;
    session.handle = me.screen_name;
  }

  if (!account) {
    throw new Error("Could not resolve account handle; pass --handle or fix session");
  }

  if (!userId) {
    userId = await client.userIdFor(account);
  }

  const accountMetaPath = join(homedir() || ".", ".aphrody", "x-account.json");
  if (existsSync(accountMetaPath)) {
    try {
      const meta = JSON.parse(readFileSync(accountMetaPath, "utf-8"));
      db.snapshot(account, "x_account", meta);
    } catch {
      /* ignore */
    }
  }

  console.error(`[yoyo] Account @${account} (${userId}) → ${opts.dbPath}`);
  console.error(`[yoyo] Kinds: ${opts.kinds.join(", ")}`);

  const runId = db.beginRun(account, opts.kinds);
  const results: Record<string, KindResult> = {};
  let hadError = false;

  for (const kind of opts.kinds) {
    if (kind === "whoami" && results.whoami) continue;
    console.error(`[yoyo] ▶ ${kind}…`);
    const r = await runKind(kind, client, db, account, userId, opts, runId);
    results[kind] = r;
    if (r.error) {
      hadError = true;
      console.error(`[yoyo] ✗ ${kind}: ${r.error}`);
    } else {
      console.error(`[yoyo] ✓ ${kind}: ${r.items} items (${r.pages} pages)`);
    }
  }

  const stats = db.store.stats();
  const digest = db.store.digest(10);
  const mutuals = db.store.mutuals(account);
  const nonMutual = db.store.nonMutualFollowing(account);

  db.snapshot(account, "graph_analysis", {
    mutuals_count: mutuals.length,
    non_mutual_following_count: nonMutual.length,
    mutuals_sample: mutuals.slice(0, 25),
    non_mutual_sample: nonMutual.slice(0, 25),
  });

  const summary = {
    account,
    user_id: userId,
    db_path: opts.dbPath,
    catalog_ops: catalogCount,
    kinds: results,
    store: stats,
    digest,
    graph: {
      mutuals: mutuals.length,
      non_mutual_following: nonMutual.length,
    },
  };

  db.finishRun(runId, summary, !hadError);
  db.close();

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});