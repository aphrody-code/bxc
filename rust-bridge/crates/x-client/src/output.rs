// SPDX-License-Identifier: Apache-2.0
//! Output rendering: JSON (default, LLM-friendly) or plain human text.
//!
//! The CLI is JSON-first (it is built for agents and pipelines), but `--plain`
//! produces stable, emoji-free, color-free text suitable for terminals and
//! grep. This module centralizes both so every command renders consistently.

use serde::Serialize;

use crate::news::NewsItem;
use crate::parse::{Tweet, User};

/// Selected output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    /// Pretty-printed JSON (default).
    Json,
    /// Stable plain text (no emoji, no color).
    Plain,
}

impl OutputMode {
    /// Resolve from the `--plain` flag and an optional config `output` string.
    pub fn resolve(plain_flag: bool, config_output: Option<&str>) -> Self {
        if plain_flag || config_output == Some("plain") {
            Self::Plain
        } else {
            Self::Json
        }
    }
}

/// Print any serializable value as pretty JSON.
pub fn print_json<T: Serialize + ?Sized>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(s) => println!("{s}"),
        Err(e) => eprintln!("failed to serialize output: {e}"),
    }
}

/// Render a page of tweets.
pub fn print_tweets(tweets: &[Tweet], next_cursor: Option<&str>, mode: OutputMode) {
    match mode {
        OutputMode::Json => print_json(&serde_json::json!({
            "tweets": tweets,
            "next_cursor": next_cursor,
        })),
        OutputMode::Plain => {
            for t in tweets {
                print_tweet_plain(t);
                println!("{}", "-".repeat(60));
            }
            if let Some(c) = next_cursor {
                println!("next_cursor: {c}");
            }
        }
    }
}

/// Render a single tweet (plain or JSON).
pub fn print_one_tweet(tweet: &Tweet, mode: OutputMode) {
    match mode {
        OutputMode::Json => print_json(tweet),
        OutputMode::Plain => print_tweet_plain(tweet),
    }
}

fn print_tweet_plain(t: &Tweet) {
    let name = if t.author.name.is_empty() {
        t.author.username.clone()
    } else {
        t.author.name.clone()
    };
    println!("@{} ({}):", t.author.username, name);
    println!("{}", t.text);
    let mut meta = format!(
        "id: {} | likes {} | rt {} | replies {} | quotes {}",
        t.id, t.like_count, t.retweet_count, t.reply_count, t.quote_count
    );
    if let Some(v) = t.view_count {
        meta.push_str(&format!(" | views {v}"));
    }
    if let Some(d) = &t.created_at {
        meta.push_str(&format!(" | {d}"));
    }
    println!("{meta}");
    if let Some(q) = &t.quoted_tweet {
        println!("  quote @{}: {}", q.author.username, q.text);
    }
}

/// Render a page of users.
pub fn print_users(users: &[User], next_cursor: Option<&str>, mode: OutputMode) {
    match mode {
        OutputMode::Json => print_json(&serde_json::json!({
            "users": users,
            "next_cursor": next_cursor,
        })),
        OutputMode::Plain => {
            for u in users {
                let verified = if u.is_blue_verified == Some(true) {
                    " [blue]"
                } else {
                    ""
                };
                println!("@{} ({}){}", u.username, u.name, verified);
                if let Some(d) = &u.description
                    && !d.is_empty()
                {
                    println!("  {d}");
                }
                println!(
                    "  id: {} | followers {} | following {}",
                    u.id,
                    u.followers_count.unwrap_or(0),
                    u.following_count.unwrap_or(0)
                );
            }
            if let Some(c) = next_cursor {
                println!("next_cursor: {c}");
            }
        }
    }
}

/// Render a list of news items.
pub fn print_news(items: &[NewsItem], mode: OutputMode) {
    match mode {
        OutputMode::Json => print_json(items),
        OutputMode::Plain => {
            for n in items {
                let mut line = format!("[{}] {}", n.category, n.headline);
                if let Some(pc) = n.post_count {
                    line.push_str(&format!(" ({pc} posts)"));
                }
                if let Some(t) = &n.time_ago {
                    line.push_str(&format!(" - {t}"));
                }
                println!("{line}");
                if let Some(u) = &n.url {
                    println!("  {u}");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_prefers_plain_flag() {
        assert_eq!(OutputMode::resolve(true, None), OutputMode::Plain);
        assert_eq!(OutputMode::resolve(false, Some("plain")), OutputMode::Plain);
        assert_eq!(OutputMode::resolve(false, Some("json")), OutputMode::Json);
        assert_eq!(OutputMode::resolve(false, None), OutputMode::Json);
    }
}
