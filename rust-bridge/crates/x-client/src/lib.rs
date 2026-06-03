// SPDX-License-Identifier: Apache-2.0
//! aphrody-x-client — native X / Twitter control module.
//!
//! Communicates with X's private web API (GraphQL + REST v1.1) using cookie
//! authentication. Requires a valid `auth_token` + `ct0` pair extracted from
//! a logged-in X session. No X developer portal registration needed.
//!
//! # Auth
//!
//! X's private web API authenticates requests with three cooperating signals:
//!
//! 1. `Cookie: auth_token=<value>; ct0=<value>` — session cookies.
//! 2. `X-CSRF-Token: <ct0>` — the `ct0` cookie value also sent as a header
//!    (CSRF double-submit pattern). These two must match exactly.
//! 3. `Authorization: Bearer <web_bearer>` — a static public bearer token
//!    embedded in X's web bundle (not a personal token; the same value for
//!    all browsers).
//!
//! On a 401 `{"errors":[{"code":32}]}` response, the typical root cause is:
//! - `ct0` cookie value differs from `X-CSRF-Token` value.
//! - `auth_token` cookie is expired or belongs to a different domain.
//! - Missing required headers (user-agent, origin, referer).
//!
//! # Transaction-ID note
//!
//! X has progressively rolled out `x-client-transaction-id` enforcement on
//! some GraphQL mutations (CreateTweet, FavoriteTweet, etc.). This header is
//! computed client-side via a keyed HMAC over the endpoint path + nonce,
//! using a rotating key that X embeds in the main JS bundle. Reverse-
//! engineered implementations exist (Python: `xflux`, JS: `twitter-api-client`)
//! but no stable public Rust port exists yet. Without it, X may return
//! `{"errors":[{"code":353,"message":"..."}]}` on some accounts/IPs.
//!
//! This crate sets a placeholder `x-client-transaction-id` header on write
//! operations. If you hit code 353, extract the real value from a browser
//! session (DevTools → Network → CreateTweet request headers) and pass it
//! via the `XSession::transaction_id` field.

pub mod api;
pub mod archive;
pub mod catalog;
pub mod catalog_sync;
pub mod client;
pub mod premium;
pub mod x_pro_deck;
pub mod surface;
pub mod config;
pub mod features;
pub mod media;
pub mod news;
pub mod output;
pub mod parse;
pub mod runtime_query_ids;
pub mod session;
pub mod store;

pub use api::{ListInfo, TimelineTweet, TweetResult, UserInfo};
pub use catalog::{OpType, Operation};
pub use client::{RateLimit, XClient};
pub use config::Config;
pub use news::{NewsItem, NewsOptions};
pub use output::OutputMode;
pub use parse::{Author, Tweet, TweetPage, User, UserPage};
pub use catalog_sync::{sync_catalog_file, SyncReport};
pub use premium::{
    parse_premium_flags, parse_upsells_response, PremiumAccountFlags, PremiumUpsells,
    UpsellConfigEntry, PREMIUM_GRAPHQL_OPS, PRODUCT_SKUS,
};
pub use x_pro_deck::{
    parse_viewer_account_sync, ViewerAccountSyncResult, XProAccountSyncConfig, XProDeck,
    XProDeckColumn, XProDeckConfig,
};
pub use surface::{
    DISCOVERY_PAGES, GRAPHQL_URL_TEMPLATE, GRYPHON_GRAPHQL_OPS, REST_V1_1_BASE, X_PRO_RECON_URLS,
};
pub use runtime_query_ids::{QueryIdStore, Snapshot as QueryIdSnapshot};
pub use session::XSession;
pub use store::{Stats as StoreStats, Store, StoredTweet};

use thiserror::Error;

/// All errors produced by this crate.
#[derive(Debug, Error)]
pub enum XError {
    /// HTTP transport error (connection refused, timeout, TLS, etc.).
    #[error("HTTP transport error: {0}")]
    Http(#[from] reqwest::Error),

    /// X API returned a structured error object (`errors[].code`).
    #[error("X API error {code}: {message}")]
    Api { code: i64, message: String },

    /// Authentication problem (missing credentials, format error, etc.).
    #[error("authentication error: {0}")]
    Auth(String),

    /// JSON deserialisation failure.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// I/O error (reading session file, etc.).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Local SQLite store error.
    #[error("store error: {0}")]
    Db(#[from] rusqlite::Error),

    /// The requested GraphQL operation name was not found in the embedded
    /// catalog.  Either the name is misspelled or the catalog needs to be
    /// re-extracted from a fresh X JS bundle.
    #[error("unknown GraphQL operation: {0}")]
    UnknownOperation(String),

    /// The operation is rate-limited and the caller's configured `max_wait`
    /// would be exceeded before the reset timestamp.  The caller should either
    /// increase `max_wait` or schedule the call after `reset_epoch`.
    #[error("rate limited until epoch {reset_epoch} (max_wait exceeded)")]
    RateLimited { reset_epoch: i64 },
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, XError>;
