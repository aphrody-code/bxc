// SPDX-License-Identifier: Apache-2.0
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import type { Tweet, User } from "../core/parse";

export const edge = {
  AUTHORED: "authored",
  LIKED: "liked",
  BOOKMARKED: "bookmarked",
  TIMELINE: "timeline",
  MENTION: "mention",
} as const;

export interface StoredTweet {
  id: string;
  author_username: string;
  author_name: string;
  text: string;
  created_at?: string;
  like_count: number;
}

export interface Stats {
  path: string;
  tweets: number;
  users: number;
  edges: number;
  follows: number;
  by_kind: [string, number][];
}

export interface Digest {
  top_authors: [string, number][];
  top_tweets: StoredTweet[];
}

export class Store {
  public db: Database;
  private path: string;

  constructor(path?: string) {
    this.path = path || Store.defaultPath();
    const dir = join(this.path, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.path);
    // WAL mode for native concurrent read-write performance
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  public static defaultPath(): string {
    const home = homedir();
    return join(home || ".", ".aphrody", "x-store.sqlite");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tweets (
          id TEXT PRIMARY KEY,
          author_username TEXT NOT NULL DEFAULT '',
          author_name TEXT NOT NULL DEFAULT '',
          author_id TEXT,
          text TEXT NOT NULL DEFAULT '',
          created_at TEXT,
          like_count INTEGER NOT NULL DEFAULT 0,
          retweet_count INTEGER NOT NULL DEFAULT 0,
          reply_count INTEGER NOT NULL DEFAULT 0,
          quote_count INTEGER NOT NULL DEFAULT 0,
          conversation_id TEXT,
          in_reply_to TEXT,
          lang TEXT,
          json TEXT NOT NULL,
          first_seen INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          description TEXT,
          followers_count INTEGER,
          following_count INTEGER,
          json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
          account TEXT NOT NULL,
          kind TEXT NOT NULL,
          tweet_id TEXT NOT NULL,
          ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (account, kind, tweet_id)
      );

      CREATE TABLE IF NOT EXISTS follows (
          account TEXT NOT NULL,
          direction TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (account, direction, user_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts
          USING fts5(text, tweet_id UNINDEXED);
    `);
  }

  public upsertTweet(t: Tweet): void {
    const json = JSON.stringify(t);
    
    // Begin transaction for transactional safety of DB + FTS entries
    const runUpsert = this.db.transaction(() => {
      this.db.run(
        `INSERT INTO tweets
          (id, author_username, author_name, author_id, text, created_at,
           like_count, retweet_count, reply_count, quote_count,
           conversation_id, in_reply_to, lang, json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(id) DO UPDATE SET
           author_username=excluded.author_username,
           author_name=excluded.author_name,
           author_id=excluded.author_id,
           text=excluded.text,
           created_at=excluded.created_at,
           like_count=excluded.like_count,
           retweet_count=excluded.retweet_count,
           reply_count=excluded.reply_count,
           quote_count=excluded.quote_count,
           conversation_id=excluded.conversation_id,
           in_reply_to=excluded.in_reply_to,
           lang=excluded.lang,
           json=excluded.json`,
        [
          t.id,
          t.author.username,
          t.author.name,
          t.author_id || null,
          t.text,
          t.created_at || null,
          t.like_count,
          t.retweet_count,
          t.reply_count,
          t.quote_count,
          t.conversation_id || null,
          t.in_reply_to_status_id || null,
          t.lang || null,
          json,
        ]
      );

      // Refresh full-text index
      this.db.run("DELETE FROM tweets_fts WHERE tweet_id = ?1", [t.id]);
      this.db.run("INSERT INTO tweets_fts (text, tweet_id) VALUES (?1, ?2)", [t.text, t.id]);
    });

    runUpsert();
  }

  public addEdge(account: string, kind: string, tweetId: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO edges (account, kind, tweet_id) VALUES (?1, ?2, ?3)",
      [account, kind, tweetId]
    );
  }

  public upsertUser(u: User): void {
    const json = JSON.stringify(u);
    this.db.run(
      `INSERT INTO users (id, username, name, description, followers_count, following_count, json)
       VALUES (?1,?2,?3,?4,?5,?6,?7)
       ON CONFLICT(id) DO UPDATE SET
         username=excluded.username, name=excluded.name,
         description=excluded.description,
         followers_count=excluded.followers_count,
         following_count=excluded.following_count, json=excluded.json`,
      [
        u.id,
        u.username,
        u.name,
        u.description || null,
        u.followers_count !== undefined ? u.followers_count : null,
        u.following_count !== undefined ? u.following_count : null,
        json,
      ]
    );
  }

  public addFollow(account: string, direction: string, u: User): void {
    this.db.run(
      "INSERT OR IGNORE INTO follows (account, direction, user_id, username, name) VALUES (?1, ?2, ?3, ?4, ?5)",
      [account, direction, u.id, u.username, u.name]
    );
  }

  public search(query: string, limit: number): StoredTweet[] {
    const q = this.db.prepare<StoredTweet, [string, number]>(`
      SELECT t.id, t.author_username, t.author_name, t.text, t.created_at, t.like_count
      FROM tweets_fts f
      JOIN tweets t ON t.id = f.tweet_id
      WHERE tweets_fts MATCH ?1
      ORDER BY t.first_seen DESC
      LIMIT ?2
    `);
    
    const rows = q.all(query, limit);
    return rows.map((r: any) => ({
      id: r.id,
      author_username: r.author_username,
      author_name: r.author_name,
      text: r.text,
      created_at: r.created_at || undefined,
      like_count: Number(r.like_count),
    }));
  }

  public stats(): Stats {
    const count = (table: string): number => {
      const row = this.db.query(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
      return row ? row.cnt : 0;
    };

    const tweets = count("tweets");
    const users = count("users");
    const edges = count("edges");
    const follows = count("follows");

    const kindRows = this.db.query("SELECT kind, COUNT(*) as cnt FROM edges GROUP BY kind ORDER BY kind").all() as { kind: string; cnt: number }[];
    const by_kind = kindRows.map((r) => [r.kind, r.cnt] as [string, number]);

    return {
      path: this.path,
      tweets,
      users,
      edges,
      follows,
      by_kind,
    };
  }

  public exportTweets(): any[] {
    const rows = this.db.query("SELECT json FROM tweets ORDER BY first_seen DESC").all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json));
  }

  public digest(top: number): Digest {
    const authorsRows = this.db.query(
      `SELECT author_username, COUNT(*) AS n FROM tweets
       WHERE author_username <> ''
       GROUP BY author_username ORDER BY n DESC LIMIT ?1`
    ).all(top) as { author_username: string; n: number }[];
    
    const top_authors = authorsRows.map((r) => [r.author_username, r.n] as [string, number]);

    const tweetsRows = this.db.query(
      `SELECT id, author_username, author_name, text, created_at, like_count
       FROM tweets ORDER BY like_count DESC LIMIT ?1`
    ).all(top) as any[];

    const top_tweets = tweetsRows.map((r) => ({
      id: r.id,
      author_username: r.author_username,
      author_name: r.author_name,
      text: r.text,
      created_at: r.created_at || undefined,
      like_count: Number(r.like_count),
    }));

    return {
      top_authors,
      top_tweets,
    };
  }

  public mutuals(account: string): string[] {
    const rows = this.db.query(`
      SELECT username FROM follows WHERE account=?1 AND direction='following'
      INTERSECT
      SELECT username FROM follows WHERE account=?1 AND direction='follower'
    `).all(account) as { username: string }[];
    return rows.map((r) => r.username);
  }

  public nonMutualFollowing(account: string): string[] {
    const rows = this.db.query(`
      SELECT username FROM follows WHERE account=?1 AND direction='following'
      EXCEPT
      SELECT username FROM follows WHERE account=?1 AND direction='follower'
    `).all(account) as { username: string }[];
    return rows.map((r) => r.username);
  }

  public close(): void {
    this.db.close();
  }
}
