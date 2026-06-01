// SPDX-License-Identifier: Apache-2.0
//! Local-first SQLite store — the "claw-able for agents" archive.
//!
//! Mirrors and surpasses `birdclaw`: a single cross-platform SQLite database
//! (`~/.aphrody/x-store.sqlite`) holding canonical tweets and users, with
//! account-scoped membership edges (authored / liked / bookmarked / timeline /
//! mention), an FTS5 full-text index over tweet text, a follow graph, and
//! JSON/JSONL/Markdown export. No Node runtime, no external service — pure Rust
//! with bundled SQLite.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::parse::{Tweet, User};
use crate::Result;

/// Edge kinds that scope a tweet to an account collection.
pub mod edge {
    /// Tweets authored by the account.
    pub const AUTHORED: &str = "authored";
    /// Tweets the account liked.
    pub const LIKED: &str = "liked";
    /// Tweets the account bookmarked.
    pub const BOOKMARKED: &str = "bookmarked";
    /// Tweets seen on the account's home timeline.
    pub const TIMELINE: &str = "timeline";
    /// Tweets mentioning the account.
    pub const MENTION: &str = "mention";
}

/// A handle to the local store.
pub struct Store {
    conn: Connection,
}

/// Aggregate store statistics.
#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    /// Database file path.
    pub path: String,
    /// Total distinct tweets stored.
    pub tweets: i64,
    /// Total distinct users stored.
    pub users: i64,
    /// Total membership edges.
    pub edges: i64,
    /// Total follow-graph rows.
    pub follows: i64,
    /// Per-edge-kind counts.
    pub by_kind: Vec<(String, i64)>,
}

/// A deterministic activity digest over the stored data.
#[derive(Debug, Clone, Serialize)]
pub struct Digest {
    /// Top authors by stored-tweet count: `(handle, count)`.
    pub top_authors: Vec<(String, i64)>,
    /// Most-liked stored tweets.
    pub top_tweets: Vec<StoredTweet>,
}

/// A stored tweet row (search/export result).
#[derive(Debug, Clone, Serialize)]
pub struct StoredTweet {
    /// Tweet id.
    pub id: String,
    /// Author handle.
    pub author_username: String,
    /// Author display name.
    pub author_name: String,
    /// Tweet text.
    pub text: String,
    /// Creation timestamp string.
    pub created_at: Option<String>,
    /// Like count.
    pub like_count: i64,
}

impl Store {
    /// Default store path: `~/.aphrody/x-store.sqlite`.
    pub fn default_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".aphrody")
            .join("x-store.sqlite")
    }

    /// Open (creating if needed) the default store.
    pub fn open_default() -> Result<Self> {
        Self::open(&Self::default_path())
    }

    /// Open (creating if needed) a store at `path`.
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
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
                direction TEXT NOT NULL,   -- 'following' | 'follower'
                user_id TEXT NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                PRIMARY KEY (account, direction, user_id)
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts
                USING fts5(text, tweet_id UNINDEXED);
            "#,
        )?;
        Ok(())
    }

    /// Insert or update a canonical tweet and refresh its FTS row.
    pub fn upsert_tweet(&self, t: &Tweet) -> Result<()> {
        let json = serde_json::to_string(t)?;
        self.conn.execute(
            r#"
            INSERT INTO tweets
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
               json=excluded.json
            "#,
            params![
                t.id,
                t.author.username,
                t.author.name,
                t.author_id,
                t.text,
                t.created_at,
                t.like_count as i64,
                t.retweet_count as i64,
                t.reply_count as i64,
                t.quote_count as i64,
                t.conversation_id,
                t.in_reply_to_status_id,
                t.lang,
                json,
            ],
        )?;
        // Refresh FTS (delete + insert keeps it in sync on updates).
        self.conn
            .execute("DELETE FROM tweets_fts WHERE tweet_id = ?1", params![t.id])?;
        self.conn.execute(
            "INSERT INTO tweets_fts (text, tweet_id) VALUES (?1, ?2)",
            params![t.text, t.id],
        )?;
        Ok(())
    }

    /// Record that `tweet_id` belongs to `account`'s `kind` collection.
    pub fn add_edge(&self, account: &str, kind: &str, tweet_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO edges (account, kind, tweet_id) VALUES (?1,?2,?3)",
            params![account, kind, tweet_id],
        )?;
        Ok(())
    }

    /// Insert or update a canonical user.
    pub fn upsert_user(&self, u: &User) -> Result<()> {
        let json = serde_json::to_string(u)?;
        self.conn.execute(
            r#"
            INSERT INTO users (id, username, name, description, followers_count, following_count, json)
            VALUES (?1,?2,?3,?4,?5,?6,?7)
            ON CONFLICT(id) DO UPDATE SET
              username=excluded.username, name=excluded.name,
              description=excluded.description,
              followers_count=excluded.followers_count,
              following_count=excluded.following_count, json=excluded.json
            "#,
            params![
                u.id,
                u.username,
                u.name,
                u.description,
                u.followers_count.map(|v| v as i64),
                u.following_count.map(|v| v as i64),
                json
            ],
        )?;
        Ok(())
    }

    /// Record a follow-graph edge (`direction` = "following" or "follower").
    pub fn add_follow(&self, account: &str, direction: &str, u: &User) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO follows (account, direction, user_id, username, name) VALUES (?1,?2,?3,?4,?5)",
            params![account, direction, u.id, u.username, u.name],
        )?;
        Ok(())
    }

    /// Full-text search stored tweets (FTS5 MATCH), newest first.
    pub fn search(&self, query: &str, limit: u32) -> Result<Vec<StoredTweet>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT t.id, t.author_username, t.author_name, t.text, t.created_at, t.like_count
            FROM tweets_fts f
            JOIN tweets t ON t.id = f.tweet_id
            WHERE tweets_fts MATCH ?1
            ORDER BY t.first_seen DESC
            LIMIT ?2
            "#,
        )?;
        let rows = stmt
            .query_map(params![query, limit], |r| {
                Ok(StoredTweet {
                    id: r.get(0)?,
                    author_username: r.get(1)?,
                    author_name: r.get(2)?,
                    text: r.get(3)?,
                    created_at: r.get(4)?,
                    like_count: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Compute aggregate statistics.
    pub fn stats(&self, path: &str) -> Result<Stats> {
        let count = |sql: &str| -> Result<i64> {
            Ok(self.conn.query_row(sql, [], |r| r.get(0))?)
        };
        let tweets = count("SELECT COUNT(*) FROM tweets")?;
        let users = count("SELECT COUNT(*) FROM users")?;
        let edges = count("SELECT COUNT(*) FROM edges")?;
        let follows = count("SELECT COUNT(*) FROM follows")?;

        let mut stmt = self
            .conn
            .prepare("SELECT kind, COUNT(*) FROM edges GROUP BY kind ORDER BY kind")?;
        let by_kind = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(Stats {
            path: path.to_owned(),
            tweets,
            users,
            edges,
            follows,
            by_kind,
        })
    }

    /// Export all stored tweets as JSON values (raw `json` column), newest first.
    pub fn export_tweets(&self) -> Result<Vec<serde_json::Value>> {
        let mut stmt = self
            .conn
            .prepare("SELECT json FROM tweets ORDER BY first_seen DESC")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|s| serde_json::from_str(&s).ok())
            .collect())
    }

    /// Build a deterministic activity digest from the stored data.
    ///
    /// A local, LLM-free "what happened" over the archive: top authors by
    /// stored-tweet count and the most-liked stored tweets.
    pub fn digest(&self, top: u32) -> Result<Digest> {
        let mut authors_stmt = self.conn.prepare(
            "SELECT author_username, COUNT(*) AS n FROM tweets
             WHERE author_username <> ''
             GROUP BY author_username ORDER BY n DESC LIMIT ?1",
        )?;
        let top_authors = authors_stmt
            .query_map(params![top], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut top_stmt = self.conn.prepare(
            "SELECT id, author_username, author_name, text, created_at, like_count
             FROM tweets ORDER BY like_count DESC LIMIT ?1",
        )?;
        let top_tweets = top_stmt
            .query_map(params![top], |r| {
                Ok(StoredTweet {
                    id: r.get(0)?,
                    author_username: r.get(1)?,
                    author_name: r.get(2)?,
                    text: r.get(3)?,
                    created_at: r.get(4)?,
                    like_count: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(Digest {
            top_authors,
            top_tweets,
        })
    }

    /// Mutual follows for `account` (in both `following` and `follower`).
    pub fn mutuals(&self, account: &str) -> Result<Vec<String>> {
        self.follow_set_query(
            "SELECT username FROM follows WHERE account=?1 AND direction='following'
             INTERSECT
             SELECT username FROM follows WHERE account=?1 AND direction='follower'",
            account,
        )
    }

    /// Accounts `account` follows that do not follow back.
    pub fn non_mutual_following(&self, account: &str) -> Result<Vec<String>> {
        self.follow_set_query(
            "SELECT username FROM follows WHERE account=?1 AND direction='following'
             EXCEPT
             SELECT username FROM follows WHERE account=?1 AND direction='follower'",
            account,
        )
    }

    fn follow_set_query(&self, sql: &str, account: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt
            .query_map(params![account], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::{Author, Tweet};

    fn sample_tweet(id: &str, text: &str) -> Tweet {
        Tweet {
            id: id.into(),
            text: text.into(),
            author: Author {
                username: "aphrody_code".into(),
                name: "Aphrody".into(),
            },
            author_id: Some("2054".into()),
            created_at: Some("Wed May 22 10:00:00 +0000 2026".into()),
            reply_count: 1,
            retweet_count: 2,
            like_count: 3,
            quote_count: 0,
            view_count: Some(99),
            conversation_id: Some(id.into()),
            in_reply_to_status_id: None,
            lang: Some("en".into()),
            is_note_tweet: false,
            quoted_tweet: None,
        }
    }

    fn mem_store() -> Store {
        let store = Store {
            conn: Connection::open_in_memory().unwrap(),
        };
        store.migrate().unwrap();
        store
    }

    #[test]
    fn upsert_and_fts_search() {
        let s = mem_store();
        s.upsert_tweet(&sample_tweet("1", "hello rustaceans world"))
            .unwrap();
        s.upsert_tweet(&sample_tweet("2", "gardening tips for spring"))
            .unwrap();
        let hits = s.search("rustaceans", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "1");
        assert_eq!(hits[0].author_username, "aphrody_code");
    }

    #[test]
    fn upsert_is_idempotent() {
        let s = mem_store();
        s.upsert_tweet(&sample_tweet("1", "first")).unwrap();
        s.upsert_tweet(&sample_tweet("1", "edited text")).unwrap();
        let stats = s.stats("mem").unwrap();
        assert_eq!(stats.tweets, 1);
        // FTS reflects the update (old term gone, new term present).
        assert_eq!(s.search("first", 10).unwrap().len(), 0);
        assert_eq!(s.search("edited", 10).unwrap().len(), 1);
    }

    #[test]
    fn edges_and_stats() {
        let s = mem_store();
        s.upsert_tweet(&sample_tweet("1", "a")).unwrap();
        s.add_edge("aphrody_code", edge::AUTHORED, "1").unwrap();
        s.add_edge("aphrody_code", edge::AUTHORED, "1").unwrap(); // dedup
        s.add_edge("aphrody_code", edge::LIKED, "1").unwrap();
        let stats = s.stats("mem").unwrap();
        assert_eq!(stats.edges, 2);
        assert!(stats.by_kind.iter().any(|(k, c)| k == "authored" && *c == 1));
    }

    #[test]
    fn mutuals_and_non_mutual() {
        let s = mem_store();
        let mk = |id: &str, un: &str| User {
            id: id.into(),
            username: un.into(),
            name: un.into(),
            description: None,
            followers_count: None,
            following_count: None,
            is_blue_verified: None,
            profile_image_url: None,
            created_at: None,
        };
        s.add_follow("me", "following", &mk("1", "alice")).unwrap();
        s.add_follow("me", "following", &mk("2", "bob")).unwrap();
        s.add_follow("me", "follower", &mk("1", "alice")).unwrap();
        let mut mutuals = s.mutuals("me").unwrap();
        mutuals.sort();
        assert_eq!(mutuals, vec!["alice"]);
        assert_eq!(s.non_mutual_following("me").unwrap(), vec!["bob"]);
    }
}
