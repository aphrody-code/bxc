// SPDX-License-Identifier: Apache-2.0
//! [`GeminiWebClient`] — the public façade composing auth + bootstrap +
//! transport into a scriptable Gemini web client.

#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};

use crate::auth::Auth;
use crate::bootstrap::fetch_session_tokens;
use crate::error::{GeminiError, Result};
use crate::payload::{build_send_payload, parse_stream_response};
use crate::rpc_ids::GET_CONFIG_FLAG;
use crate::transport::HttpTransport;
use crate::types::{ChatReply, ConversationMetadata, UploadedAttachment};
use serde_json::json;

/// Scriptable, non-interactive Gemini web (`gemini.google.com/app`) client.
///
/// Auth = the signed-in Google cookie jar (exported to
/// `~/.aphrody/google-cookies.json`); the anti-CSRF `at` token is scraped from
/// the app page at construction. No browser, no FFI.
#[derive(Debug, Clone)]
pub struct GeminiWebClient {
    transport: HttpTransport,
    language: String,
}

impl GeminiWebClient {
    /// Default cookie-jar location: `~/.aphrody/google-cookies.json`.
    ///
    /// Resolves `HOME` (Unix) or `USERPROFILE` (Windows). Returns `None` when
    /// neither is set.
    #[must_use]
    #[cfg(not(target_arch = "wasm32"))]
    pub fn default_cookie_path() -> Option<PathBuf> {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))?;
        Some(PathBuf::from(home).join(".aphrody").join("google-cookies.json"))
    }

    /// Build a client from a cookie-jar file, bootstrapping session tokens.
    ///
    /// # Errors
    ///
    /// Propagates auth (bad/missing jar), bootstrap (signed out) and network
    /// errors.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn from_cookie_file(path: impl AsRef<Path>, language: &str) -> Result<Self> {
        let auth = Auth::from_cookie_file(path).await?;
        Self::from_auth(auth, language).await
    }

    /// Build a client from the default jar path, accepting either on-disk
    /// source: the Cookie-Editor jar (`~/.aphrody/google-cookies.json`,
    /// preferred) or the `chromium export-session` envelope
    /// (`~/.aphrody/google-session.json`). The first that exists is used;
    /// [`Auth::from_cookie_file`] auto-detects its format. When neither exists,
    /// the conventional `google-cookies.json` path is surfaced in the error.
    ///
    /// # Errors
    ///
    /// [`GeminiError::Auth`] if no home directory is resolvable, plus the same
    /// errors as [`Self::from_cookie_file`].
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn from_default_cookie_file(language: &str) -> Result<Self> {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .ok_or_else(|| {
                GeminiError::Auth("cannot resolve HOME/USERPROFILE for default cookie path".into())
            })?;
        let dir = PathBuf::from(home).join(".aphrody");
        let cookies = dir.join("google-cookies.json");
        let session = dir.join("google-session.json");
        let path = if cookies.is_file() {
            cookies
        } else if session.is_file() {
            session
        } else {
            cookies
        };
        Self::from_cookie_file(path, language).await
    }

    /// Build a client from an explicit [`Auth`], bootstrapping session tokens.
    ///
    /// # Errors
    ///
    /// Propagates bootstrap + network errors.
    pub async fn from_auth(auth: Auth, language: &str) -> Result<Self> {
        let tokens = fetch_session_tokens(&auth, Some(language)).await?;
        let transport = HttpTransport::new(auth, tokens)?;
        Ok(Self { transport, language: language.to_string() })
    }

    /// Re-scrape the session tokens (call after a [`GeminiError::Auth`] on a
    /// long-lived client — the `at` token expires in ~10 min).
    ///
    /// # Errors
    ///
    /// Propagates bootstrap + network errors.
    pub async fn refresh(&mut self) -> Result<()> {
        let tokens = fetch_session_tokens(self.transport.auth(), Some(&self.language)).await?;
        self.transport.set_tokens(tokens);
        Ok(())
    }

    /// Send a prompt and return the parsed [`ChatReply`].
    ///
    /// Pass [`ConversationMetadata::default`] to start a new conversation, or a
    /// prior reply's [`ChatReply::metadata`] to continue the same thread.
    /// `model` is an optional [`crate::rpc_ids`] model-selector token
    /// (`MODEL_FLASH` / `MODEL_PRO` / `MODEL_THINKING`); `None` = account default.
    /// Optionally pass a list of attachments previously uploaded via [`Self::upload_file`].
    ///
    /// # Errors
    ///
    /// Propagates transport errors and [`GeminiError::Parse`] if the response
    /// carries no reply candidate.
    pub async fn send(
        &self,
        prompt: &str,
        model: Option<&str>,
        meta: &ConversationMetadata,
        attachments: Option<&[UploadedAttachment]>,
    ) -> Result<ChatReply> {
        let payload = build_send_payload(prompt, &self.language, meta, attachments);
        // Follow-up turns are threaded via the inner metadata; the optional
        // source-path mirrors the web UI for parity.
        let source_path = meta.conversation_id.as_ref().map(|cid| format!("/app/{cid}"));
        let raw = self
            .transport
            .stream_generate(&payload, source_path.as_deref(), model)
            .await?;
        parse_stream_response(&raw)
    }

    /// Convenience: start a fresh conversation with one prompt.
    ///
    /// # Errors
    ///
    /// See [`Self::send`].
    pub async fn ask(&self, prompt: &str, model: Option<&str>) -> Result<ChatReply> {
        self.send(prompt, model, &ConversationMetadata::default(), None).await
    }

    /// Upload a local file to Google's Scotty storage, returning an `UploadedAttachment` that can be attached to a message.
    ///
    /// # Errors
    ///
    /// Propagates network and protocol errors.
    pub async fn upload_file(&self, file_name: &str, data: &[u8]) -> Result<UploadedAttachment> {
        let url = self.transport.upload_file(file_name, data).await?;
        Ok(UploadedAttachment {
            url,
            name: file_name.to_string(),
        })
    }

    /// Read a server config flag (`ESY5D`), e.g. `bard_activity_enabled`.
    /// Returns the boolean the server reports for the flag.
    ///
    /// # Errors
    ///
    /// Propagates transport errors; [`GeminiError::Parse`] on an unexpected
    /// envelope shape.
    pub async fn get_config_flag(&self, flag: &str) -> Result<bool> {
        let payload = json!([[[flag]]]);
        let inner = self.transport.rpc_raw(GET_CONFIG_FLAG, &payload, Some("/app"), None).await?;
        // Observed live: [[null,null,null,null,true]] -> the trailing bool.
        let value = inner
            .get(0)
            .and_then(|v| v.as_array())
            .and_then(|a| a.iter().rev().find_map(serde_json::Value::as_bool));
        value.ok_or_else(|| GeminiError::Parse(format!("ESY5D: no bool for flag `{flag}`")))
    }

    /// Borrow the transport (diagnostics / advanced callers).
    #[must_use]
    pub fn transport(&self) -> &HttpTransport {
        &self.transport
    }
}
