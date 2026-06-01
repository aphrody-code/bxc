// SPDX-License-Identifier: Apache-2.0
//! Twitter/X data-archive import into the local store.
//!
//! A Twitter data export ships `data/tweets.js` (and `tweet.js` on older
//! exports) as a JS-assignment-wrapped JSON array:
//!
//! ```text
//! window.YTD.tweets.part0 = [ { "tweet": { "id_str": ..., "full_text": ... } }, ... ]
//! ```
//!
//! This module strips the assignment prefix, parses the array, maps each
//! legacy tweet object onto our canonical [`Tweet`], and upserts it into the
//! store with an `authored` edge — the same shape live sync produces, so an
//! archive and live data merge seamlessly.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::parse::{Author, Tweet};
use crate::store::{edge, Store};
use crate::{Result, XError};

/// Locate the tweets file inside an archive: accept a direct file, or a
/// directory containing `data/tweets.js` / `data/tweet.js` / `tweets.js`.
fn resolve_tweets_file(input: &Path) -> Option<PathBuf> {
    if input.is_file() {
        return Some(input.to_path_buf());
    }
    for rel in ["data/tweets.js", "data/tweet.js", "tweets.js", "tweet.js"] {
        let candidate = input.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Strip the `window.YTD.* = ` assignment prefix and parse the JSON array.
fn parse_archive_array(raw: &str) -> Result<Vec<Value>> {
    let start = raw
        .find('[')
        .ok_or_else(|| XError::Auth("archive file has no JSON array".into()))?;
    let end = raw
        .rfind(']')
        .ok_or_else(|| XError::Auth("archive file has no JSON array end".into()))?;
    if end < start {
        return Err(XError::Auth("archive file array delimiters inverted".into()));
    }
    let arr: Vec<Value> = serde_json::from_str(&raw[start..=end])?;
    Ok(arr)
}

fn count_field(legacy: &Value, key: &str) -> u64 {
    legacy
        .get(key)
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()))
        .unwrap_or(0)
}

/// Convert one archive `{ "tweet": {legacy} }` element into a [`Tweet`].
fn archive_tweet_to_tweet(elem: &Value, owner: &Author) -> Option<Tweet> {
    let legacy = elem.get("tweet").unwrap_or(elem);
    let id = legacy.get("id_str").and_then(Value::as_str)?.to_owned();
    let text = legacy
        .get("full_text")
        .or_else(|| legacy.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    Some(Tweet {
        id: id.clone(),
        text,
        author: owner.clone(),
        author_id: None,
        created_at: legacy
            .get("created_at")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        reply_count: count_field(legacy, "reply_count"),
        retweet_count: count_field(legacy, "retweet_count"),
        like_count: count_field(legacy, "favorite_count"),
        quote_count: count_field(legacy, "quote_count"),
        view_count: None,
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
        is_note_tweet: false,
        quoted_tweet: None,
    })
}

/// Import an archive into `store`, attributing tweets to `owner_handle`.
///
/// Returns the number of tweets imported.
pub fn import_archive(store: &Store, path: &Path, owner_handle: &str) -> Result<usize> {
    let file = resolve_tweets_file(path).ok_or_else(|| {
        XError::Auth(format!(
            "no tweets.js found at {} (expected a tweets.js file or an archive dir)",
            path.display()
        ))
    })?;
    let raw = std::fs::read_to_string(&file)?;
    let arr = parse_archive_array(&raw)?;

    let owner = Author {
        username: owner_handle.trim_start_matches('@').to_owned(),
        name: owner_handle.trim_start_matches('@').to_owned(),
    };

    let mut imported = 0usize;
    for elem in &arr {
        if let Some(tweet) = archive_tweet_to_tweet(elem, &owner) {
            store.upsert_tweet(&tweet)?;
            store.add_edge(&owner.username, edge::AUTHORED, &tweet.id)?;
            imported += 1;
        }
    }
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_js_wrapped_archive() {
        let raw = r#"window.YTD.tweets.part0 = [
          { "tweet" : { "id_str": "1", "full_text": "hello archive", "favorite_count": "12", "created_at": "Wed May 22 10:00:00 +0000 2026" } },
          { "tweet" : { "id_str": "2", "full_text": "second", "retweet_count": "3" } }
        ]"#;
        let arr = parse_archive_array(raw).unwrap();
        assert_eq!(arr.len(), 2);
        let owner = Author {
            username: "aphrody_code".into(),
            name: "aphrody_code".into(),
        };
        let t = archive_tweet_to_tweet(&arr[0], &owner).unwrap();
        assert_eq!(t.id, "1");
        assert_eq!(t.text, "hello archive");
        assert_eq!(t.like_count, 12);
        assert_eq!(t.author.username, "aphrody_code");
        let t2 = archive_tweet_to_tweet(&arr[1], &owner).unwrap();
        assert_eq!(t2.retweet_count, 3);
    }

    #[test]
    fn handles_plain_json_array() {
        let raw = r#"[ { "tweet": { "id_str": "9", "full_text": "x" } } ]"#;
        let arr = parse_archive_array(raw).unwrap();
        assert_eq!(arr.len(), 1);
    }

    #[test]
    fn rejects_non_array() {
        assert!(parse_archive_array("window.YTD.tweets.part0 = {}").is_err());
    }
}
