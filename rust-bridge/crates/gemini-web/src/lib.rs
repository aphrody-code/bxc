// SPDX-License-Identifier: Apache-2.0
//! `gemini-web` — pure-Rust client for the **Gemini web app**
//! (`gemini.google.com/app`) Boq `batchexecute` RPC surface.
//!
//! Gemini's consumer web app speaks the same Google Boq `batchexecute` protocol
//! as `NotebookLM`, so this crate mirrors [`notebooklm`]'s transport: cookie-jar
//! auth, a page-bootstrap that scrapes the `at`/`bl`/`f.sid` tokens out of
//! `WIZ_global_data`, the `f.req` envelope codec, and a typed RPC surface.
//!
//! ## Auth
//!
//! The user exports their signed-in Google cookies (e.g. via the Cookie-Editor
//! extension) to `~/.aphrody/google-cookies.json`. The jar is replayed on every
//! request; the anti-CSRF `at` token is scraped at construction. Secrets stay
//! under the caller's home — never inside the aphrody workspace.
//!
//! ## Modules
//!
//! * [`rpc_ids`]   — captured Gemini `batchexecute` RPC ids + URL + model header.
//! * [`error`]     — typed [`GeminiError`] / [`Result`].
//! * [`auth`]      — [`Auth`] cookie jar + Cookie-Editor importer + file loader.
//! * [`boq`]       — `f.req` encoder + XSSI stripper + chunk/envelope parser.
//! * [`bootstrap`] — scrape [`SessionTokens`] from the app page HTML.
//! * [`transport`] — pure-HTTP [`HttpTransport`] (reqwest, Chrome UA).
//! * [`payload`]   — `MaZiqc` send-payload builder + response parser.
//! * [`types`]     — [`ChatReply`], [`ConversationMetadata`].
//! * [`client`]    — [`GeminiWebClient`] façade.
//!
//! ## Quick start
//!
//! ```no_run
//! use gemini_web::GeminiWebClient;
//!
//! # async fn run() -> gemini_web::Result<()> {
//! // Install a rustls CryptoProvider before the first reqwest call (caller).
//! let client = GeminiWebClient::from_default_cookie_file("en").await?;
//! let reply = client.ask("Explain io_uring in one sentence.", None).await?;
//! println!("{}", reply.text);
//!
//! // Continue the same conversation:
//! let follow = client.send("And epoll?", None, &reply.metadata, None).await?;
//! println!("{}", follow.text);
//! # Ok(())
//! # }
//! ```
//!
//! ## Cross-platform
//!
//! Native-only in practice (reqwest + rustls). The send/parse logic in
//! [`payload`] and [`boq`] is platform-agnostic and unit-tested everywhere.

// Hardened crate: clippy pedantic is a gating signal (Rust 2026 practice).
#![warn(clippy::pedantic)]
#![allow(clippy::missing_panics_doc)] // regex literals in bootstrap are infallible

pub mod auth;
pub mod boq;
pub mod bootstrap;
pub mod client;
pub mod error;
pub mod models;
pub mod payload;
pub mod rpc_ids;
pub mod transport;
pub mod types;

pub use auth::{Auth, CookieJar, SessionCookie};
pub use client::GeminiWebClient;
pub use error::{GeminiError, Result};
pub use models::{GeminiModel, ReasoningLevel};
pub use transport::{HttpTransport, SessionTokens};
pub use types::{ChatReply, ConversationMetadata, UploadedAttachment};

/// Curated re-exports for a single `use gemini_web::prelude::*;`.
pub mod prelude {
    pub use crate::auth::{Auth, CookieJar, SessionCookie};
    pub use crate::client::GeminiWebClient;
    pub use crate::error::{GeminiError, Result};
    pub use crate::models::{GeminiModel, ReasoningLevel};
    pub use crate::transport::{HttpTransport, SessionTokens};
    pub use crate::types::{ChatReply, ConversationMetadata, UploadedAttachment};
}
