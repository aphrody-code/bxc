// SPDX-License-Identifier: Apache-2.0
//! Typed extraction of tweets and users from X's GraphQL timeline trees.
//!
//! X's GraphQL responses are deeply nested and vary per operation
//! (`HomeTimeline`, `SearchTimeline`, `UserTweets`, `TweetDetail`,
//! `Bookmarks`, …). Rather than special-case each shape, this module walks the
//! response recursively, locating every `instructions` array and pulling out
//! `tweet_results` / `user_results` entries plus the bottom pagination cursor.
//! This keeps a single, robust parser working across all timeline operations
//! and survives minor shape changes.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A tweet author (the two fields the UI surfaces).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Author {
    /// Handle without the leading `@`.
    pub username: String,
    /// Display name.
    pub name: String,
}

/// A fully-parsed tweet, mirroring the reference client's JSON schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tweet {
    /// Numeric tweet REST id.
    pub id: String,
    /// Full text (note/article body when present, else `legacy.full_text`).
    pub text: String,
    /// Author handle + display name.
    pub author: Author,
    /// Author numeric id, if resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    /// Creation timestamp (X's `created_at` string form).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Reply count.
    pub reply_count: u64,
    /// Retweet count.
    pub retweet_count: u64,
    /// Like (favorite) count.
    pub like_count: u64,
    /// Quote count.
    pub quote_count: u64,
    /// View count (impressions), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<u64>,
    /// Conversation (thread root) id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// Parent tweet id when this is a reply.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub in_reply_to_status_id: Option<String>,
    /// BCP-47 language code, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
    /// Whether this carries long-form note-tweet content.
    pub is_note_tweet: bool,
    /// Embedded quoted tweet (depth-limited during extraction).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quoted_tweet: Option<Box<Tweet>>,
}

/// A parsed user (for follower/following/list-member timelines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// Numeric user id.
    pub id: String,
    /// Handle without `@`.
    pub username: String,
    /// Display name.
    pub name: String,
    /// Bio / description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Followers count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followers_count: Option<u64>,
    /// Following count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub following_count: Option<u64>,
    /// Blue (paid) verification flag.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_blue_verified: Option<bool>,
    /// Profile image URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_image_url: Option<String>,
    /// Account creation timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A page of tweets plus the cursor needed to fetch the next page.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TweetPage {
    /// Tweets in document order.
    pub tweets: Vec<Tweet>,
    /// Bottom cursor to pass as `cursor` for the next page, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// A page of users plus the next cursor.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserPage {
    /// Users in document order.
    pub users: Vec<User>,
    /// Bottom cursor for the next page, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Maximum quoted-tweet nesting depth to follow (mirrors `--quote-depth`).
const DEFAULT_QUOTE_DEPTH: u32 = 1;

// ---------------------------------------------------------------------------
// Tweet extraction
// ---------------------------------------------------------------------------

/// Unwrap a `tweet_results.result` node, handling the
/// `TweetWithVisibilityResults` wrapper that nests the real tweet under
/// `.tweet`.
fn unwrap_tweet_result(result: &Value) -> Option<&Value> {
    match result.get("__typename").and_then(Value::as_str) {
        Some("TweetWithVisibilityResults") => result.get("tweet"),
        Some("TweetTombstone") => None,
        _ => {
            if result.get("legacy").is_some() || result.get("rest_id").is_some() {
                Some(result)
            } else if result.get("tweet").is_some() {
                result.get("tweet")
            } else {
                None
            }
        }
    }
}

/// Resolve `{username, name}` from a `user_results.result` node, tolerating both
/// the legacy (`legacy.{name,screen_name}`) and current (`core.{name,screen_name}`)
/// layouts.
fn extract_author(user_result: &Value) -> Author {
    let core = user_result.get("core");
    let name = core
        .and_then(|c| c.get("name"))
        .and_then(Value::as_str)
        .or_else(|| user_result.pointer("/legacy/name").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    let username = core
        .and_then(|c| c.get("screen_name"))
        .and_then(Value::as_str)
        .or_else(|| {
            user_result
                .pointer("/legacy/screen_name")
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_owned();
    Author { username, name }
}

/// Pull the long-form note-tweet text, if this tweet carries one.
fn extract_note_text(tweet: &Value) -> Option<String> {
    tweet
        .pointer("/note_tweet/note_tweet_results/result/text")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn count_u64(legacy: &Value, key: &str) -> u64 {
    legacy.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Parse a `tweet_results.result` value into a [`Tweet`].
///
/// `quote_depth` bounds recursion into quoted tweets (0 disables embedding).
pub fn parse_tweet_result(result: &Value, quote_depth: u32) -> Option<Tweet> {
    let tweet = unwrap_tweet_result(result)?;
    let legacy = tweet.get("legacy")?;

    let id = tweet
        .get("rest_id")
        .and_then(Value::as_str)
        .or_else(|| legacy.get("id_str").and_then(Value::as_str))
        .unwrap_or_default()
        .to_owned();
    if id.is_empty() {
        return None;
    }

    let note_text = extract_note_text(tweet);
    let is_note_tweet = note_text.is_some();
    let text = note_text
        .or_else(|| {
            legacy
                .get("full_text")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();

    let author = tweet
        .pointer("/core/user_results/result")
        .map(extract_author)
        .unwrap_or(Author {
            username: String::new(),
            name: String::new(),
        });

    let author_id = legacy
        .get("user_id_str")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    let view_count = tweet
        .pointer("/views/count")
        .and_then(Value::as_str)
        .and_then(|s| s.parse::<u64>().ok());

    let quoted_tweet = if quote_depth > 0 {
        tweet
            .pointer("/quoted_status_result/result")
            .and_then(|q| parse_tweet_result(q, quote_depth - 1))
            .map(Box::new)
    } else {
        None
    };

    Some(Tweet {
        id,
        text,
        author,
        author_id,
        created_at: legacy
            .get("created_at")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        reply_count: count_u64(legacy, "reply_count"),
        retweet_count: count_u64(legacy, "retweet_count"),
        like_count: count_u64(legacy, "favorite_count"),
        quote_count: count_u64(legacy, "quote_count"),
        view_count,
        conversation_id: legacy
            .get("conversation_id_str")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        in_reply_to_status_id: legacy
            .get("in_reply_to_status_id_str")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        lang: legacy
            .get("lang")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        is_note_tweet,
        quoted_tweet,
    })
}

// ---------------------------------------------------------------------------
// Timeline walking
// ---------------------------------------------------------------------------

/// Recursively collect every `instructions` array found anywhere in `root`.
fn find_instruction_arrays<'a>(root: &'a Value, out: &mut Vec<&'a Value>) {
    match root {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "instructions"
                    && let Some(arr) = v.as_array()
                {
                    out.push(v);
                    let _ = arr;
                }
                find_instruction_arrays(v, out);
            }
        }
        Value::Array(arr) => {
            for v in arr {
                find_instruction_arrays(v, out);
            }
        }
        _ => {}
    }
}

/// Walk a single entry's content, pushing any tweet(s) and noting cursors.
fn walk_entry_content(content: &Value, quote_depth: u32, tweets: &mut Vec<Tweet>, bottom: &mut Option<String>) {
    let entry_type = content
        .get("entryType")
        .or_else(|| content.get("__typename"))
        .and_then(Value::as_str)
        .unwrap_or("");

    match entry_type {
        "TimelineTimelineItem" => {
            if let Some(result) = content.pointer("/itemContent/tweet_results/result")
                && let Some(t) = parse_tweet_result(result, quote_depth)
            {
                tweets.push(t);
            }
        }
        "TimelineTimelineCursor" => {
            let cursor_type = content.get("cursorType").and_then(Value::as_str).unwrap_or("");
            if cursor_type == "Bottom"
                && let Some(v) = content.get("value").and_then(Value::as_str)
            {
                *bottom = Some(v.to_owned());
            }
        }
        "TimelineTimelineModule" => {
            // Conversation modules: items[].item.itemContent
            if let Some(items) = content.get("items").and_then(Value::as_array) {
                for item in items {
                    if let Some(ic) = item.pointer("/item/itemContent") {
                        // itemContent may hold a tweet or a cursor.
                        if let Some(result) = ic.pointer("/tweet_results/result")
                            && let Some(t) = parse_tweet_result(result, quote_depth)
                        {
                            tweets.push(t);
                        }
                        if ic.get("cursorType").and_then(Value::as_str) == Some("Bottom")
                            && let Some(v) = ic.get("value").and_then(Value::as_str)
                        {
                            *bottom = Some(v.to_owned());
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// Extract all tweets and the bottom cursor from any timeline-shaped response.
pub fn walk_timeline_tweets(root: &Value, quote_depth: u32) -> TweetPage {
    let mut instruction_sets = Vec::new();
    find_instruction_arrays(root, &mut instruction_sets);

    let mut tweets = Vec::new();
    let mut bottom: Option<String> = None;

    for instructions in instruction_sets {
        let Some(arr) = instructions.as_array() else {
            continue;
        };
        for instruction in arr {
            // TimelineAddEntries / TimelineAddToModule etc.
            if let Some(entries) = instruction.get("entries").and_then(Value::as_array) {
                for entry in entries {
                    if let Some(content) = entry.get("content") {
                        walk_entry_content(content, quote_depth, &mut tweets, &mut bottom);
                    }
                }
            }
            // TimelineReplaceEntry / pin etc. carry a single `entry`.
            if let Some(entry) = instruction.get("entry")
                && let Some(content) = entry.get("content")
            {
                walk_entry_content(content, quote_depth, &mut tweets, &mut bottom);
            }
        }
    }

    TweetPage {
        tweets,
        next_cursor: bottom,
    }
}

/// Extract all users and the bottom cursor from a user-list timeline.
pub fn walk_timeline_users(root: &Value) -> UserPage {
    let mut instruction_sets = Vec::new();
    find_instruction_arrays(root, &mut instruction_sets);

    let mut users = Vec::new();
    let mut bottom: Option<String> = None;

    for instructions in instruction_sets {
        let Some(arr) = instructions.as_array() else {
            continue;
        };
        for instruction in arr {
            let Some(entries) = instruction.get("entries").and_then(Value::as_array) else {
                continue;
            };
            for entry in entries {
                let content = entry.get("content");
                let entry_type = content
                    .and_then(|c| c.get("entryType"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if entry_type == "TimelineTimelineCursor" {
                    if content.and_then(|c| c.get("cursorType")).and_then(Value::as_str)
                        == Some("Bottom")
                        && let Some(v) =
                            content.and_then(|c| c.get("value")).and_then(Value::as_str)
                    {
                        bottom = Some(v.to_owned());
                    }
                    continue;
                }
                if let Some(result) = content.and_then(|c| c.pointer("/itemContent/user_results/result"))
                    && let Some(u) = parse_user_result(result)
                {
                    users.push(u);
                }
            }
        }
    }

    UserPage {
        users,
        next_cursor: bottom,
    }
}

/// Parse a `user_results.result` node into a [`User`].
pub fn parse_user_result(result: &Value) -> Option<User> {
    let id = result
        .get("rest_id")
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/legacy/id_str").and_then(Value::as_str))?
        .to_owned();

    let author = extract_author(result);
    if author.username.is_empty() {
        return None;
    }

    let legacy = result.get("legacy");
    let description = legacy
        .and_then(|l| l.get("description"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let followers_count = legacy
        .and_then(|l| l.get("followers_count"))
        .and_then(Value::as_u64);
    let following_count = legacy
        .and_then(|l| l.get("friends_count"))
        .and_then(Value::as_u64);
    let is_blue_verified = result.get("is_blue_verified").and_then(Value::as_bool);
    let profile_image_url = legacy
        .and_then(|l| l.get("profile_image_url_https"))
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/avatar/image_url").and_then(Value::as_str))
        .map(ToOwned::to_owned);
    let created_at = legacy
        .and_then(|l| l.get("created_at"))
        .and_then(Value::as_str)
        .or_else(|| result.pointer("/core/created_at").and_then(Value::as_str))
        .map(ToOwned::to_owned);

    Some(User {
        id,
        username: author.username,
        name: author.name,
        description,
        followers_count,
        following_count,
        is_blue_verified,
        profile_image_url,
        created_at,
    })
}

/// Convenience: parse a single tweet response (e.g. `TweetDetail` for one id)
/// at the default quote depth.
pub fn parse_single_tweet(root: &Value, tweet_id: &str) -> Option<Tweet> {
    let page = walk_timeline_tweets(root, DEFAULT_QUOTE_DEPTH);
    page.tweets.into_iter().find(|t| t.id == tweet_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_tweet_result() -> Value {
        json!({
            "__typename": "Tweet",
            "rest_id": "1900000000000000001",
            "core": {
                "user_results": {
                    "result": {
                        "rest_id": "2244994945",
                        "core": { "name": "Aphrody", "screen_name": "aphrody_code" }
                    }
                }
            },
            "views": { "count": "4242" },
            "legacy": {
                "full_text": "hello world",
                "favorite_count": 10,
                "retweet_count": 2,
                "reply_count": 1,
                "quote_count": 0,
                "created_at": "Wed May 22 10:00:00 +0000 2026",
                "conversation_id_str": "1900000000000000001",
                "user_id_str": "2244994945",
                "lang": "en"
            }
        })
    }

    #[test]
    fn parses_basic_tweet() {
        let t = parse_tweet_result(&sample_tweet_result(), 1).expect("must parse");
        assert_eq!(t.id, "1900000000000000001");
        assert_eq!(t.text, "hello world");
        assert_eq!(t.author.username, "aphrody_code");
        assert_eq!(t.author.name, "Aphrody");
        assert_eq!(t.like_count, 10);
        assert_eq!(t.retweet_count, 2);
        assert_eq!(t.reply_count, 1);
        assert_eq!(t.view_count, Some(4242));
        assert_eq!(t.author_id.as_deref(), Some("2244994945"));
        assert_eq!(t.lang.as_deref(), Some("en"));
        assert!(!t.is_note_tweet);
    }

    #[test]
    fn legacy_author_layout_supported() {
        let mut r = sample_tweet_result();
        // Drop the new core layout, fall back to legacy.
        r["core"]["user_results"]["result"]["core"] = Value::Null;
        r["core"]["user_results"]["result"]["legacy"] =
            json!({ "name": "Old Name", "screen_name": "old_handle" });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert_eq!(t.author.username, "old_handle");
        assert_eq!(t.author.name, "Old Name");
    }

    #[test]
    fn note_tweet_text_preferred() {
        let mut r = sample_tweet_result();
        r["note_tweet"] = json!({
            "note_tweet_results": { "result": { "text": "the full long-form body" } }
        });
        let t = parse_tweet_result(&r, 1).unwrap();
        assert!(t.is_note_tweet);
        assert_eq!(t.text, "the full long-form body");
    }

    #[test]
    fn visibility_wrapper_unwrapped() {
        let inner = sample_tweet_result();
        let wrapped = json!({
            "__typename": "TweetWithVisibilityResults",
            "tweet": inner
        });
        let t = parse_tweet_result(&wrapped, 1).unwrap();
        assert_eq!(t.text, "hello world");
    }

    #[test]
    fn quote_depth_limits_recursion() {
        let mut r = sample_tweet_result();
        let mut quoted = sample_tweet_result();
        quoted["rest_id"] = json!("1900000000000000999");
        quoted["legacy"]["full_text"] = json!("the quoted one");
        r["quoted_status_result"] = json!({ "result": quoted });

        let with_quote = parse_tweet_result(&r, 1).unwrap();
        assert!(with_quote.quoted_tweet.is_some());
        assert_eq!(with_quote.quoted_tweet.unwrap().text, "the quoted one");

        let no_quote = parse_tweet_result(&r, 0).unwrap();
        assert!(no_quote.quoted_tweet.is_none());
    }

    #[test]
    fn walks_timeline_entries_and_cursor() {
        let root = json!({
            "data": { "x": { "timeline": { "instructions": [
                {
                    "type": "TimelineAddEntries",
                    "entries": [
                        {
                            "entryId": "tweet-1",
                            "content": {
                                "entryType": "TimelineTimelineItem",
                                "itemContent": { "tweet_results": { "result": sample_tweet_result() } }
                            }
                        },
                        {
                            "entryId": "cursor-bottom",
                            "content": {
                                "entryType": "TimelineTimelineCursor",
                                "cursorType": "Bottom",
                                "value": "CURSOR_ABC"
                            }
                        }
                    ]
                }
            ]}}}
        });
        let page = walk_timeline_tweets(&root, 1);
        assert_eq!(page.tweets.len(), 1);
        assert_eq!(page.tweets[0].id, "1900000000000000001");
        assert_eq!(page.next_cursor.as_deref(), Some("CURSOR_ABC"));
    }

    #[test]
    fn walks_user_timeline() {
        let root = json!({
            "data": { "user": { "result": { "timeline": { "timeline": { "instructions": [
                {
                    "type": "TimelineAddEntries",
                    "entries": [
                        {
                            "entryId": "user-1",
                            "content": {
                                "entryType": "TimelineTimelineItem",
                                "itemContent": { "user_results": { "result": {
                                    "rest_id": "2244994945",
                                    "core": { "name": "Aphrody", "screen_name": "aphrody_code" },
                                    "is_blue_verified": true,
                                    "legacy": { "followers_count": 100, "friends_count": 50, "description": "bio" }
                                } } }
                            }
                        },
                        {
                            "entryId": "cursor-bottom",
                            "content": { "entryType": "TimelineTimelineCursor", "cursorType": "Bottom", "value": "UCUR" }
                        }
                    ]
                }
            ]}}}}}
        });
        let page = walk_timeline_users(&root);
        assert_eq!(page.users.len(), 1);
        assert_eq!(page.users[0].username, "aphrody_code");
        assert_eq!(page.users[0].followers_count, Some(100));
        assert_eq!(page.users[0].is_blue_verified, Some(true));
        assert_eq!(page.next_cursor.as_deref(), Some("UCUR"));
    }
}
