// SPDX-License-Identifier: Apache-2.0
//! X private API methods — GraphQL (via catalog) + REST v1.1.
//!
//! All methods live on `XClient`. They:
//! 1. Delegate to `XClient::graphql` (which resolves `queryId` from the
//!    embedded catalog) or issue REST v1.1 calls directly.
//! 2. Parse the successful JSON into a typed result struct.
//!
//! # QueryID stability
//!
//! The `queryId` values are read at runtime from `data/x-graphql-catalog.json`
//! (embedded at compile time).  Re-run the extraction script against a fresh
//! X JS bundle when operations start returning HTTP 404, then rebuild the
//! binary — no source change needed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::client::{check_api_errors, XClient, API_BASE};
use crate::features::CREATE_TWEET_FEATURES_KNOWN_GOOD;
use crate::parse::{self, TweetPage, UserPage};
use crate::{Result, XError};

// ---------------------------------------------------------------------------
// Result structs (tolerant of missing fields via serde defaults).
// ---------------------------------------------------------------------------

/// Result of a successful tweet creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TweetResult {
    /// Numeric tweet ID string (REST ID format, e.g. `"1234567890123456789"`).
    pub id: String,
    /// Full text of the created tweet.
    pub text: String,
}

/// Public user information returned by `UserByScreenName`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    /// Numeric user REST ID (e.g. `"2244994945"`).
    pub id: String,
    /// Display name (e.g. `"aphrody"`).
    pub name: String,
    /// Screen name / handle without `@` (e.g. `"aphrody_code"`).
    pub screen_name: String,
    /// Follower count (`None` if missing in response).
    #[serde(default)]
    pub followers_count: Option<u64>,
    /// Following count (`None` if missing in response).
    #[serde(default)]
    pub friends_count: Option<u64>,
}

/// A Twitter list (from `ListOwnerships` / `ListMemberships`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListInfo {
    /// Numeric list id.
    pub id: String,
    /// List name.
    pub name: String,
    /// Member count, when present.
    #[serde(default)]
    pub member_count: Option<u64>,
    /// Subscriber count, when present.
    #[serde(default)]
    pub subscriber_count: Option<u64>,
    /// Visibility mode (e.g. "Public" / "Private").
    #[serde(default)]
    pub mode: Option<String>,
}

/// A tweet entry from the home timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTweet {
    /// Numeric tweet REST ID.
    pub id: String,
    /// Full tweet text.
    pub text: String,
}

// ---------------------------------------------------------------------------
// Pure body builders — unit-testable without network.
// ---------------------------------------------------------------------------

/// Build the JSON `variables` map for a `CreateTweet` mutation.
///
/// Extracted as a pure function so unit tests can verify the structure
/// without constructing an `XClient` or hitting the network.
pub fn build_create_tweet_body(text: &str, reply_to: Option<&str>) -> Value {
    // Use the known-good feature blob for CreateTweet (proven to reach the
    // endpoint successfully).
    let features: Value = serde_json::from_str(CREATE_TWEET_FEATURES_KNOWN_GOOD)
        .expect("CREATE_TWEET_FEATURES_KNOWN_GOOD is valid JSON — bug in constant");

    let mut variables = json!({
        "tweet_text": text,
        "dark_request": false,
        "media": {
            "media_entities": [],
            "possibly_sensitive": false
        },
        "semantic_annotation_ids": []
    });

    if let Some(reply_id) = reply_to {
        variables["reply"] = json!({
            "in_reply_to_tweet_id": reply_id,
            "exclude_reply_user_ids": []
        });
    }

    // Return the full body shape (catalog invoker will override features with
    // its own merged set, but this function is also used by build_* tests).
    json!({
        "variables": variables,
        "features": features,
        "queryId": "H-t2v_HvFR07ZBP9aOeKoA"
    })
}

// ---------------------------------------------------------------------------
// XClient API methods
// ---------------------------------------------------------------------------

impl XClient {
    // -----------------------------------------------------------------------
    // Tweets
    // -----------------------------------------------------------------------

    /// Post a new tweet, optionally as a reply to an existing tweet.
    ///
    /// Uses `CreateTweet` from the catalog.
    ///
    /// # Arguments
    ///
    /// - `text` — tweet text (max 280 chars unless X Premium subscriber).
    /// - `reply_to` — numeric tweet ID to reply to, or `None` for a root tweet.
    ///
    /// # Errors
    ///
    /// - `XError::Api { code: 32 }` — authentication failure.
    /// - `XError::Api { code: 187 }` — duplicate tweet.
    /// - `XError::Api { code: 353 }` — `x-client-transaction-id` enforcement.
    /// - `XError::Api { code: 344 }` — daily tweet cap (hard server-side limit).
    pub async fn create_tweet(&self, text: &str, reply_to: Option<&str>) -> Result<TweetResult> {
        self.create_tweet_with_media(text, reply_to, &[]).await
    }

    /// Post a tweet with attached media ids (from [`XClient::upload_media`]).
    ///
    /// Up to 4 images/GIFs or 1 video. Pass an empty slice for a text-only
    /// tweet (equivalent to [`XClient::create_tweet`]).
    pub async fn create_tweet_with_media(
        &self,
        text: &str,
        reply_to: Option<&str>,
        media_ids: &[String],
    ) -> Result<TweetResult> {
        // Use the known-good feature blob for CreateTweet.
        let extra_features: Value = serde_json::from_str(CREATE_TWEET_FEATURES_KNOWN_GOOD)
            .expect("CREATE_TWEET_FEATURES_KNOWN_GOOD is valid JSON");

        let media_entities: Vec<Value> = media_ids
            .iter()
            .map(|id| json!({ "media_id": id, "tagged_users": [] }))
            .collect();

        let mut variables = json!({
            "tweet_text": text,
            "dark_request": false,
            "media": {
                "media_entities": media_entities,
                "possibly_sensitive": false
            },
            "semantic_annotation_ids": []
        });

        if let Some(reply_id) = reply_to {
            variables["reply"] = json!({
                "in_reply_to_tweet_id": reply_id,
                "exclude_reply_user_ids": []
            });
        }

        let json = match self
            .graphql("CreateTweet", variables, Some(extra_features))
            .await
        {
            Ok(v) => v,
            // Error 226 = X flagged the request as "automated". The legacy
            // statuses/update.json endpoint is more lenient; fall back to it,
            // exactly like the reference client does.
            Err(XError::Api { code: 226, .. }) => {
                return self.create_tweet_rest(text, reply_to).await;
            }
            Err(e) => return Err(e),
        };

        let result = json
            .pointer("/data/create_tweet/tweet_results/result")
            .ok_or_else(|| XError::Api {
                code: -1,
                message: "CreateTweet response missing data.create_tweet.tweet_results.result"
                    .into(),
            })?;

        let id = result
            .get("rest_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let full_text = result
            .pointer("/legacy/full_text")
            .and_then(Value::as_str)
            .unwrap_or(text)
            .to_owned();

        Ok(TweetResult { id, text: full_text })
    }

    /// Post a tweet via the legacy REST v1.1 `statuses/update.json` endpoint.
    ///
    /// Used as an automatic fallback when GraphQL `CreateTweet` returns error
    /// `226` ("this request looks like it might be automated"). The legacy
    /// endpoint accepts the same cookie auth and is historically more lenient.
    pub async fn create_tweet_rest(&self, text: &str, reply_to: Option<&str>) -> Result<TweetResult> {
        let url = format!("{API_BASE}/1.1/statuses/update.json");
        let mut form: Vec<(&str, String)> = vec![
            ("status", text.to_owned()),
            ("tweet_mode", "extended".to_owned()),
        ];
        if let Some(reply_id) = reply_to {
            form.push(("in_reply_to_status_id", reply_id.to_owned()));
            form.push(("auto_populate_reply_metadata", "true".to_owned()));
        }

        let resp = self
            .inner()
            .post(&url)
            .header("x-client-transaction-id", crate::client::random_transaction_id())
            .form(&form)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status} from statuses/update.json"),
            });
        }
        check_api_errors(&json)?;

        let id = json
            .get("id_str")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let full_text = json
            .get("full_text")
            .or_else(|| json.get("text"))
            .and_then(Value::as_str)
            .unwrap_or(text)
            .to_owned();
        Ok(TweetResult { id, text: full_text })
    }

    /// Delete a tweet by its numeric ID.
    pub async fn delete_tweet(&self, id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": id,
            "dark_request": false
        });
        let json = self.graphql("DeleteTweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Like / Unlike
    // -----------------------------------------------------------------------

    /// Like (favorite) a tweet.
    pub async fn like(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({ "tweet_id": tweet_id });
        let json = self.graphql("FavoriteTweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    /// Unlike (remove favorite) a tweet.
    pub async fn unlike(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({ "tweet_id": tweet_id });
        let json = self.graphql("UnfavoriteTweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Retweet / Unretweet
    // -----------------------------------------------------------------------

    /// Retweet a tweet.
    pub async fn retweet(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": tweet_id,
            "dark_request": false
        });
        let json = self.graphql("CreateRetweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    /// Remove a retweet.
    pub async fn unretweet(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "source_tweet_id": tweet_id,
            "dark_request": false
        });
        let json = self.graphql("DeleteRetweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Bookmark
    // -----------------------------------------------------------------------

    /// Bookmark a tweet by its numeric tweet ID.
    ///
    /// Uses `CreateBookmark` from the catalog.
    pub async fn bookmark(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": tweet_id
        });
        let json = self.graphql("CreateBookmark", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    /// Remove a bookmark from a tweet.
    ///
    /// Uses `DeleteBookmark` from the catalog.
    pub async fn unbookmark(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": tweet_id
        });
        let json = self.graphql("DeleteBookmark", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Pin / Unpin
    // -----------------------------------------------------------------------

    /// Pin a tweet to the authenticated user's profile.
    ///
    /// Uses `PinTweet` from the catalog.
    pub async fn pin_tweet(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": tweet_id
        });
        let json = self.graphql("PinTweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    /// Unpin the pinned tweet from the authenticated user's profile.
    ///
    /// Uses `UnpinTweet` from the catalog.
    pub async fn unpin_tweet(&self, tweet_id: &str) -> Result<()> {
        let variables = json!({
            "tweet_id": tweet_id
        });
        let json = self.graphql("UnpinTweet", variables, None).await?;
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Note tweets (long-form)
    // -----------------------------------------------------------------------

    /// Post a long-form note tweet (up to ~25,000 chars on Premium accounts).
    ///
    /// Uses `CreateNoteTweet` from the catalog.  The `note_text` is the
    /// rich-text body; `tweet_text` is the short public preview (optional,
    /// defaults to the first 280 chars of `note_text` if `None`).
    pub async fn note_tweet(
        &self,
        tweet_text: Option<&str>,
        note_text: &str,
    ) -> Result<TweetResult> {
        let preview = tweet_text
            .map(|s| s.to_owned())
            .unwrap_or_else(|| note_text.chars().take(280).collect::<String>());

        let variables = json!({
            "tweet_text": preview,
            "dark_request": false,
            "media": {
                "media_entities": [],
                "possibly_sensitive": false
            },
            "semantic_annotation_ids": [],
            "note_tweet": {
                "note_tweet_richtext": {
                    "text": note_text,
                    "entities": []
                },
                "media_entities": []
            }
        });

        let json = self.graphql("CreateNoteTweet", variables, None).await?;

        // CreateNoteTweet has a slightly different response shape:
        // data.notetweet_create.tweet_results.result
        let result = json
            .pointer("/data/notetweet_create/tweet_results/result")
            .or_else(|| json.pointer("/data/create_tweet/tweet_results/result"))
            .ok_or_else(|| XError::Api {
                code: -1,
                message: "CreateNoteTweet response missing tweet_results.result".into(),
            })?;

        let id = result
            .get("rest_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let text_out = result
            .pointer("/legacy/full_text")
            .and_then(Value::as_str)
            .unwrap_or(&preview)
            .to_owned();

        Ok(TweetResult { id, text: text_out })
    }

    // -----------------------------------------------------------------------
    // Follow / Unfollow (REST v1.1)
    // -----------------------------------------------------------------------

    /// Follow a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /friendships/create.json` endpoint with
    /// `application/x-www-form-urlencoded` body (not GraphQL).
    pub async fn follow(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/friendships/create.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    /// Unfollow a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /friendships/destroy.json` endpoint.
    pub async fn unfollow(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/friendships/destroy.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Block / Unblock (REST v1.1)
    // -----------------------------------------------------------------------

    /// Block a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /blocks/create.json` endpoint.
    pub async fn block(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/blocks/create.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    /// Unblock a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /blocks/destroy.json` endpoint.
    pub async fn unblock(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/blocks/destroy.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Mute / Unmute (REST v1.1)
    // -----------------------------------------------------------------------

    /// Mute a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /mutes/users/create.json` endpoint.
    pub async fn mute(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/mutes/users/create.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    /// Unmute a user by their numeric user ID.
    ///
    /// Uses the REST v1.1 `POST /mutes/users/destroy.json` endpoint.
    pub async fn unmute(&self, user_id: &str) -> Result<()> {
        let url = format!("{}/1.1/mutes/users/destroy.json", API_BASE);
        let params = [("user_id", user_id)];
        let resp = self
            .inner
            .post(&url)
            .header("content-type", "application/x-www-form-urlencoded")
            .form(&params)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // User lookup
    // -----------------------------------------------------------------------

    /// Look up a user by screen name (handle, without `@`).
    ///
    /// Uses `UserByScreenName` from the catalog.
    pub async fn user_by_screen_name(&self, handle: &str) -> Result<UserInfo> {
        let variables = json!({
            "screen_name": handle,
            "withSafetyModeUserFields": true
        });

        let json = self
            .graphql("UserByScreenName", variables, None)
            .await?;

        let result = json
            .pointer("/data/user/result")
            .ok_or_else(|| XError::Api {
                code: -1,
                message: "UserByScreenName response missing data.user.result".into(),
            })?;
        let legacy = result.get("legacy").unwrap_or(&Value::Null);
        let core = result.get("core").unwrap_or(&Value::Null);

        let id = result
            .get("rest_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        // X moved name/screen_name from legacy into a nested `core` object;
        // prefer core, fall back to legacy.
        let name = core
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| legacy.get("name").and_then(Value::as_str))
            .unwrap_or_default()
            .to_owned();
        let screen_name = core
            .get("screen_name")
            .and_then(Value::as_str)
            .or_else(|| legacy.get("screen_name").and_then(Value::as_str))
            .unwrap_or(handle)
            .to_owned();
        let followers_count = legacy.get("followers_count").and_then(Value::as_u64);
        let friends_count = legacy.get("friends_count").and_then(Value::as_u64);

        Ok(UserInfo {
            id,
            name,
            screen_name,
            followers_count,
            friends_count,
        })
    }

    // -----------------------------------------------------------------------
    // Home timeline
    // -----------------------------------------------------------------------

    /// Fetch tweets from the authenticated user's home timeline.
    ///
    /// Uses `HomeTimeline` from the catalog.  Returns up to `count` tweets.
    /// Timeline entries are heavily nested in X's GraphQL response; this
    /// parser is tolerant of missing fields and will silently skip entries it
    /// cannot decode.
    pub async fn home_timeline(&self, count: u32) -> Result<Vec<TimelineTweet>> {
        let variables = json!({
            "count": count,
            "includePromotedContent": false,
            "latestControlAvailable": true,
            "requestContext": "launch"
        });

        let json = self.graphql("HomeTimeline", variables, None).await?;

        let mut tweets = Vec::new();

        // Walk: data.home.home_timeline_urt.instructions[].entries[].content
        //       .itemContent.tweet_results.result
        if let Some(instructions) = json
            .pointer("/data/home/home_timeline_urt/instructions")
            .and_then(Value::as_array)
        {
            for instruction in instructions {
                let Some(entries) = instruction.get("entries").and_then(Value::as_array) else {
                    continue;
                };
                for entry in entries {
                    let Some(result) =
                        entry.pointer("/content/itemContent/tweet_results/result")
                    else {
                        continue;
                    };
                    let id = result
                        .get("rest_id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    let text = result
                        .pointer("/legacy/full_text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned();
                    if !id.is_empty() {
                        tweets.push(TimelineTweet { id, text });
                    }
                }
            }
        }

        Ok(tweets)
    }

    // -----------------------------------------------------------------------
    // Direct messages
    // -----------------------------------------------------------------------

    /// Send a direct message to a recipient by their numeric user ID.
    ///
    /// Uses the private REST v1.1 `POST /dm/new2.json` endpoint.
    ///
    /// # Rate limits
    ///
    /// X limits DMs per day. Exceeding the limit returns error code 226
    /// ("This request looks automated"). The limit is not publicly documented
    /// but is generally in the hundreds per day for normal accounts.
    pub async fn send_dm(&self, recipient_id: &str, text: &str) -> Result<()> {
        let url = format!("{}/1.1/dm/new2.json", API_BASE);
        let body = json!({
            "conversation_id": format!("{}-{}", recipient_id, recipient_id),
            "recipient_ids": false,
            "request_id": uuid_v4_hex(),
            "text": text,
            "cards_platform": "Web-12",
            "include_cards": 1,
            "include_quote_count": true,
            "dm_users": false
        });

        let resp = self.inner.post(&url).json(&body).send().await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        let json: Value = resp.json().await?;
        if !status.is_success() {
            check_api_errors(&json)?;
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("HTTP {status}"),
            });
        }
        check_api_errors(&json)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Reading: timelines, threads, search (typed, paginated)
    // -----------------------------------------------------------------------

    /// Run a timeline-shaped GraphQL query and parse it into a [`TweetPage`].
    async fn timeline_tweets(
        &self,
        op: &str,
        variables: Value,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let json = self.graphql(op, variables, None).await?;
        Ok(parse::walk_timeline_tweets(&json, quote_depth))
    }

    /// Run a user-list GraphQL query and parse it into a [`UserPage`].
    async fn timeline_users(&self, op: &str, variables: Value) -> Result<UserPage> {
        let json = self.graphql(op, variables, None).await?;
        Ok(parse::walk_timeline_users(&json))
    }

    /// Resolve a handle (without `@`) to its numeric user id.
    pub async fn user_id_for(&self, handle: &str) -> Result<String> {
        let info = self.user_by_screen_name(handle).await?;
        if info.id.is_empty() {
            return Err(XError::Api {
                code: -1,
                message: format!("could not resolve user id for @{handle}"),
            });
        }
        Ok(info.id)
    }

    /// Fetch a single tweet by id (with its quoted tweet up to `quote_depth`).
    ///
    /// Uses `TweetDetail`. Returns `None` if the tweet is not present in the
    /// response (deleted / protected / tombstoned).
    pub async fn get_tweet(&self, tweet_id: &str, quote_depth: u32) -> Result<Option<parse::Tweet>> {
        let json = self.tweet_detail_raw(tweet_id, None).await?;
        let page = parse::walk_timeline_tweets(&json, quote_depth);
        Ok(page.tweets.into_iter().find(|t| t.id == tweet_id))
    }

    /// Fetch the full conversation thread for a tweet as a [`TweetPage`].
    ///
    /// Uses `TweetDetail`; replies and ancestor tweets are returned in document
    /// order. Pass `cursor` to page deeper into long threads.
    pub async fn thread(
        &self,
        tweet_id: &str,
        cursor: Option<&str>,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let json = self.tweet_detail_raw(tweet_id, cursor).await?;
        Ok(parse::walk_timeline_tweets(&json, quote_depth))
    }

    /// Raw `TweetDetail` GraphQL call (shared by `get_tweet` / `thread`).
    async fn tweet_detail_raw(&self, tweet_id: &str, cursor: Option<&str>) -> Result<Value> {
        let mut variables = json!({
            "focalTweetId": tweet_id,
            "with_rux_injections": false,
            "includePromotedContent": false,
            "withCommunity": true,
            "withQuickPromoteEligibilityTweetFields": true,
            "withBirdwatchNotes": true,
            "withVoice": true,
            "withV2Timeline": true
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.graphql("TweetDetail", variables, None).await
    }

    /// Search tweets matching `query`.
    ///
    /// `product` selects the search tab: `"Latest"`, `"Top"`, `"People"`,
    /// `"Photos"`, `"Videos"` (defaults to `"Latest"`). Pass `cursor` to page.
    pub async fn search(
        &self,
        query: &str,
        count: u32,
        cursor: Option<&str>,
        product: &str,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let mut variables = json!({
            "rawQuery": query,
            "count": count,
            "querySource": "typed_query",
            "product": product,
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets("SearchTimeline", variables, quote_depth)
            .await
    }

    /// Fetch a user's profile timeline by numeric user id.
    pub async fn user_tweets(
        &self,
        user_id: &str,
        count: u32,
        cursor: Option<&str>,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let mut variables = json!({
            "userId": user_id,
            "count": count,
            "includePromotedContent": false,
            "withQuickPromoteEligibilityTweetFields": true,
            "withVoice": true,
            "withV2Timeline": true
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets("UserTweets", variables, quote_depth)
            .await
    }

    /// Fetch the home timeline as a paginated [`TweetPage`].
    ///
    /// When `latest` is true, uses the chronological "Following" feed
    /// (`HomeLatestTimeline`); otherwise the algorithmic "For You" feed
    /// (`HomeTimeline`).
    pub async fn home(
        &self,
        count: u32,
        cursor: Option<&str>,
        latest: bool,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let op = if latest {
            "HomeLatestTimeline"
        } else {
            "HomeTimeline"
        };
        let mut variables = json!({
            "count": count,
            "includePromotedContent": false,
            "latestControlAvailable": true,
            "requestContext": "launch",
            "seenTweetIds": []
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets(op, variables, quote_depth).await
    }

    /// Fetch a user's liked tweets by numeric user id.
    pub async fn likes(
        &self,
        user_id: &str,
        count: u32,
        cursor: Option<&str>,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let mut variables = json!({
            "userId": user_id,
            "count": count,
            "includePromotedContent": false,
            "withClientEventToken": false,
            "withVoice": true,
            "withV2Timeline": true
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets("Likes", variables, quote_depth).await
    }

    /// Fetch the authenticated user's bookmarks.
    pub async fn bookmarks(
        &self,
        count: u32,
        cursor: Option<&str>,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let mut variables = json!({
            "count": count,
            "includePromotedContent": false
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets("Bookmarks", variables, quote_depth)
            .await
    }

    /// List the accounts a user follows (by numeric user id).
    pub async fn following(
        &self,
        user_id: &str,
        count: u32,
        cursor: Option<&str>,
    ) -> Result<UserPage> {
        let mut variables = json!({
            "userId": user_id,
            "count": count,
            "includePromotedContent": false
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_users("Following", variables).await
    }

    /// List the accounts that follow a user (by numeric user id).
    pub async fn followers(
        &self,
        user_id: &str,
        count: u32,
        cursor: Option<&str>,
    ) -> Result<UserPage> {
        let mut variables = json!({
            "userId": user_id,
            "count": count,
            "includePromotedContent": false
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_users("Followers", variables).await
    }

    /// Fetch tweets from a list timeline (by numeric list id).
    pub async fn list_timeline(
        &self,
        list_id: &str,
        count: u32,
        cursor: Option<&str>,
        quote_depth: u32,
    ) -> Result<TweetPage> {
        let mut variables = json!({
            "listId": list_id,
            "count": count
        });
        if let Some(c) = cursor {
            variables["cursor"] = json!(c);
        }
        self.timeline_tweets("ListLatestTweetsTimeline", variables, quote_depth)
            .await
    }

    /// List the lists owned by (or that include) a user.
    ///
    /// `member_of = false` → `ListOwnerships` (lists the user owns);
    /// `member_of = true` → `ListMemberships` (lists the user belongs to).
    pub async fn lists(
        &self,
        user_id: &str,
        member_of: bool,
        count: u32,
    ) -> Result<Vec<ListInfo>> {
        let op = if member_of {
            "ListMemberships"
        } else {
            "ListOwnerships"
        };
        // `isListMemberTargetUserId` is a required variable (X 422s with
        // "must be defined" without it).
        let variables = json!({
            "userId": user_id,
            "count": count,
            "isListMemberTargetUserId": false
        });
        let features = crate::features::default_features();
        let json = self.graphql(op, variables, Some(features)).await?;
        Ok(parse_lists(&json))
    }

    /// Resolve the authenticated account (whoami) via the `Viewer` GraphQL op.
    ///
    /// Returns the logged-in user the cookies belong to.
    pub async fn whoami(&self) -> Result<UserInfo> {
        let variables = json!({
            "withCommunitiesMemberships": false
        });
        let json = self.graphql("Viewer", variables, None).await?;

        // Locate the viewer's user_results.result anywhere under data.viewer.
        let result = json
            .pointer("/data/viewer/user_results/result")
            .or_else(|| json.pointer("/data/viewer_v2/user_results/result"))
            .ok_or_else(|| XError::Api {
                code: -1,
                message: "Viewer response missing user_results.result".into(),
            })?;

        let core = result.get("core").unwrap_or(&Value::Null);
        let legacy = result.get("legacy").unwrap_or(&Value::Null);
        let id = result
            .get("rest_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let name = core
            .get("name")
            .and_then(Value::as_str)
            .or_else(|| legacy.get("name").and_then(Value::as_str))
            .unwrap_or_default()
            .to_owned();
        let screen_name = core
            .get("screen_name")
            .and_then(Value::as_str)
            .or_else(|| legacy.get("screen_name").and_then(Value::as_str))
            .unwrap_or_default()
            .to_owned();

        Ok(UserInfo {
            id,
            name,
            screen_name,
            followers_count: legacy.get("followers_count").and_then(Value::as_u64),
            friends_count: legacy.get("friends_count").and_then(Value::as_u64),
        })
    }
}

/// Walk a list-timeline response and extract [`ListInfo`] entries.
///
/// List entries appear as `itemContent.list` objects (with `id_str`, `name`,
/// `member_count`, …) inside the timeline instruction tree.
fn parse_lists(root: &Value) -> Vec<ListInfo> {
    let mut out = Vec::new();
    // Iterative traversal with an explicit work stack — no recursion, so a
    // deeply-nested response can never overflow the thread stack.
    let mut stack: Vec<&Value> = vec![root];
    while let Some(v) = stack.pop() {
        match v {
            Value::Object(map) => {
                if let (Some(id), Some(name)) = (
                    map.get("id_str").and_then(Value::as_str),
                    map.get("name").and_then(Value::as_str),
                ) && (map.contains_key("member_count")
                    || map.contains_key("mode")
                    || map.contains_key("subscriber_count"))
                {
                    out.push(ListInfo {
                        id: id.to_owned(),
                        name: name.to_owned(),
                        member_count: map.get("member_count").and_then(Value::as_u64),
                        subscriber_count: map.get("subscriber_count").and_then(Value::as_u64),
                        mode: map.get("mode").and_then(Value::as_str).map(ToOwned::to_owned),
                    });
                }
                stack.extend(map.values());
            }
            Value::Array(arr) => stack.extend(arr.iter()),
            _ => {}
        }
    }
    // Deduplicate by id (a list can appear under multiple keys).
    let mut seen = std::collections::HashSet::new();
    out.retain(|l| seen.insert(l.id.clone()));
    out
}

/// Generate a hex UUID-v4-like nonce for DM `request_id`.
///
/// Uses timestamp + process-ID + static salt for a collision-resistant
/// value that does not require an external RNG dependency.
fn uuid_v4_hex() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    format!("{:032x}", ts ^ (pid << 64) ^ 0xdeadbeef_cafebabe)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_create_tweet_body_has_tweet_text() {
        let body = build_create_tweet_body("Hello world", None);
        assert_eq!(
            body.pointer("/variables/tweet_text")
                .and_then(Value::as_str),
            Some("Hello world")
        );
    }

    #[test]
    fn build_create_tweet_body_has_query_id() {
        let body = build_create_tweet_body("test", None);
        // The body always embeds the live catalog queryId for CreateTweet.
        assert_eq!(
            body.get("queryId").and_then(Value::as_str),
            Some("H-t2v_HvFR07ZBP9aOeKoA"),
        );
    }

    #[test]
    fn build_create_tweet_body_no_reply_when_none() {
        let body = build_create_tweet_body("test", None);
        assert!(
            body.pointer("/variables/reply").is_none(),
            "reply key must be absent when reply_to is None"
        );
    }

    #[test]
    fn build_create_tweet_body_with_reply_sets_in_reply_to() {
        let body = build_create_tweet_body("test reply", Some("1234567890123456789"));
        assert_eq!(
            body.pointer("/variables/reply/in_reply_to_tweet_id")
                .and_then(Value::as_str),
            Some("1234567890123456789")
        );
    }

    #[test]
    fn build_create_tweet_body_reply_has_exclude_user_ids() {
        let body = build_create_tweet_body("reply text", Some("999"));
        let exclude = body
            .pointer("/variables/reply/exclude_reply_user_ids")
            .and_then(Value::as_array)
            .expect("exclude_reply_user_ids must be an array");
        assert!(
            exclude.is_empty(),
            "exclude_reply_user_ids must be empty by default"
        );
    }

    #[test]
    fn build_create_tweet_body_features_is_object() {
        let body = build_create_tweet_body("test", None);
        assert!(
            body.get("features").and_then(Value::as_object).is_some(),
            "features must be a JSON object"
        );
    }

    #[test]
    fn create_tweet_features_known_good_is_valid_json() {
        let v: Value = serde_json::from_str(CREATE_TWEET_FEATURES_KNOWN_GOOD)
            .expect("CREATE_TWEET_FEATURES_KNOWN_GOOD must be valid JSON");
        assert!(v.is_object());
    }
}
