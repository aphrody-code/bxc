// SPDX-License-Identifier: Apache-2.0
//! Typed error surface for the Gemini web RPC client.
//!
//! Every public function on [`crate::client::GeminiWebClient`] returns
//! [`Result<T>`] = `Result<T, GeminiError>`. Variants carry enough context for
//! callers to route (auth refresh, retry, surface-back).

use thiserror::Error;

/// Public alias every API function in this crate uses.
pub type Result<T> = core::result::Result<T, GeminiError>;

/// Categorised error for every RPC, transport, bootstrap or parsing failure.
#[derive(Debug, Error)]
pub enum GeminiError {
    /// Transport-level failure (connect / TLS / IO). `reqwest` failures bubble
    /// up here.
    #[error("network failure: {0}")]
    Network(String),

    /// Authentication or session-token problem: 401/403 from `batchexecute`, a
    /// missing/expired cookie jar, or an `at`/`bl` token the upstream rejects.
    #[error("auth failure: {0}")]
    Auth(String),

    /// The page bootstrap could not recover a required token (`at`/`bl`/`f.sid`)
    /// from the Gemini app HTML — usually a signed-out session.
    #[error("bootstrap failure: {0}")]
    Bootstrap(String),

    /// The Boq RPC executed but the response carried a non-2xx HTTP status or a
    /// `UserDisplayableError` envelope.
    #[error("RPC {rpc_id} returned HTTP {status}: {message}")]
    Rpc { rpc_id: String, status: u16, message: String },

    /// Response body could not be parsed (envelope shape unexpected, inner JSON
    /// malformed, missing field on a `wrb.fr` array).
    #[error("parse failure: {0}")]
    Parse(String),
}

impl From<reqwest::Error> for GeminiError {
    fn from(value: reqwest::Error) -> Self {
        GeminiError::Network(value.to_string())
    }
}

impl From<serde_json::Error> for GeminiError {
    fn from(value: serde_json::Error) -> Self {
        GeminiError::Parse(value.to_string())
    }
}

impl From<std::io::Error> for GeminiError {
    fn from(value: std::io::Error) -> Self {
        GeminiError::Network(value.to_string())
    }
}
