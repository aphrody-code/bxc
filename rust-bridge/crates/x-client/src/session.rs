// SPDX-License-Identifier: Apache-2.0
//! Session credential loading for the X native client.
//!
//! Credential lookup order:
//! 1. `XSession::load()` — reads `~/.aphrody/x-session.json`.
//! 2. `XSession::from_env()` — reads `X_AUTH_TOKEN` + `X_CT0` env vars.
//!
//! The JSON file may contain extra fields; they are silently ignored.

use serde::{Deserialize, Serialize};

use crate::{Result, XError};

/// X session credentials loaded from disk or environment.
///
/// # Session file format (`~/.aphrody/x-session.json`)
///
/// ```json
/// {
///   "auth_token": "YOUR_AUTH_TOKEN_HERE",
///   "ct0": "YOUR_CT0_HERE",
///   "handle": "aphrody_code",
///   "transaction_id": null
/// }
/// ```
///
/// Extra unknown fields are silently ignored (via `#[serde(flatten)]` drain).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XSession {
    /// Value of the `auth_token` cookie (hex string, ~40 chars).
    pub auth_token: String,

    /// Value of the `ct0` cookie (also sent as `X-CSRF-Token`).
    pub ct0: String,

    /// Optional X handle (e.g. `"aphrody_code"`) — informational only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,

    /// Optional pre-computed `x-client-transaction-id`.
    ///
    /// X is progressively enforcing this header on write mutations. If you hit
    /// API error code 353, extract the header value from a live browser session
    /// (DevTools → Network → CreateTweet → Request Headers) and set this field.
    /// When `None`, the client sends a static placeholder that works for most
    /// accounts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction_id: Option<String>,

    /// Drain unknown JSON fields so forward-compatible session files can be
    /// written by future tooling without breaking deserialization here.
    #[serde(flatten)]
    _extra: std::collections::HashMap<String, serde_json::Value>,
}

impl XSession {
    /// Create a session directly from known values (useful in tests / scripting).
    pub fn new(auth_token: impl Into<String>, ct0: impl Into<String>) -> Self {
        Self {
            auth_token: auth_token.into(),
            ct0: ct0.into(),
            handle: None,
            transaction_id: None,
            _extra: std::collections::HashMap::new(),
        }
    }

    /// Load credentials from `~/.aphrody/x-session.json`.
    ///
    /// Returns `XError::Auth` when the home directory cannot be determined or
    /// the file does not exist. Use `XSession::from_env()` as a fallback.
    pub fn load() -> Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| {
            XError::Auth("cannot determine home directory (dirs::home_dir() returned None)".into())
        })?;
        let path = home.join(".aphrody").join("x-session.json");
        let raw = std::fs::read_to_string(&path).map_err(|e| {
            XError::Auth(format!(
                "cannot read session file {}: {} — create it or set X_AUTH_TOKEN + X_CT0 env vars",
                path.display(),
                e
            ))
        })?;
        let session: Self = serde_json::from_str(&raw).map_err(|e| {
            XError::Auth(format!(
                "malformed session file {}: {}",
                path.display(),
                e
            ))
        })?;
        session.validate()?;
        Ok(session)
    }

    /// Load credentials from environment variables `X_AUTH_TOKEN` and `X_CT0`.
    ///
    /// Also reads the optional `X_HANDLE` and `X_TRANSACTION_ID` env vars.
    pub fn from_env() -> Result<Self> {
        let auth_token = std::env::var("X_AUTH_TOKEN").map_err(|_| {
            XError::Auth(
                "X_AUTH_TOKEN env var not set — \
                 set X_AUTH_TOKEN + X_CT0, or create ~/.aphrody/x-session.json"
                    .into(),
            )
        })?;
        let ct0 = std::env::var("X_CT0").map_err(|_| {
            XError::Auth("X_CT0 env var not set — required alongside X_AUTH_TOKEN".into())
        })?;
        let session = Self {
            auth_token,
            ct0,
            handle: std::env::var("X_HANDLE").ok().filter(|s| !s.is_empty()),
            transaction_id: std::env::var("X_TRANSACTION_ID")
                .ok()
                .filter(|s| !s.is_empty()),
            _extra: std::collections::HashMap::new(),
        };
        session.validate()?;
        Ok(session)
    }

    /// Try `XSession::load()` first; fall back to `XSession::from_env()`.
    pub fn load_or_env() -> Result<Self> {
        Self::load().or_else(|_| Self::from_env())
    }

    /// Build a session from an explicit cookie string
    /// (`"auth_token=<val>; ct0=<val>"`).
    ///
    /// Parses semicolon-separated `key=value` pairs. Unknown keys are ignored.
    pub fn from_cookie_string(cookie_string: &str) -> Result<Self> {
        let mut auth_token = None;
        let mut ct0 = None;
        for part in cookie_string.split(';') {
            let part = part.trim();
            if let Some((key, value)) = part.split_once('=') {
                match key.trim() {
                    "auth_token" => auth_token = Some(value.trim().to_owned()),
                    "ct0" => ct0 = Some(value.trim().to_owned()),
                    _ => {}
                }
            }
        }
        let session = Self {
            auth_token: auth_token.ok_or_else(|| {
                XError::Auth(
                    "cookie string does not contain auth_token=<value>".into(),
                )
            })?,
            ct0: ct0.ok_or_else(|| {
                XError::Auth("cookie string does not contain ct0=<value>".into())
            })?,
            handle: None,
            transaction_id: None,
            _extra: std::collections::HashMap::new(),
        };
        session.validate()?;
        Ok(session)
    }

    /// Returns the value to use for the `Cookie` request header.
    ///
    /// Only `auth_token` and `ct0` are included — they are the two cookies
    /// that X validates. Other cookies (`twid`, `kdt`, `__cf_bm`, etc.) are
    /// set automatically by X's infrastructure and not required for API calls.
    pub fn cookie_header(&self) -> String {
        format!("auth_token={}; ct0={}", self.auth_token, self.ct0)
    }

    fn validate(&self) -> Result<()> {
        if self.auth_token.is_empty() {
            return Err(XError::Auth("auth_token is empty".into()));
        }
        if self.ct0.is_empty() {
            return Err(XError::Auth("ct0 is empty".into()));
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    const SESSION_JSON: &str = r#"{
        "auth_token": "AUTH_TOKEN_PLACEHOLDER",
        "ct0": "CT0_PLACEHOLDER",
        "handle": "aphrody_code",
        "unknown_future_field": 42,
        "another_extra": {"nested": true}
    }"#;

    #[test]
    fn parse_session_json_with_extra_fields() {
        let session: XSession = serde_json::from_str(SESSION_JSON).unwrap();
        assert_eq!(session.auth_token, "AUTH_TOKEN_PLACEHOLDER");
        assert_eq!(session.ct0, "CT0_PLACEHOLDER");
        assert_eq!(session.handle.as_deref(), Some("aphrody_code"));
        // Extra fields must be silently swallowed.
        assert_eq!(session._extra.len(), 2);
    }

    #[test]
    fn session_roundtrip_serialise() {
        let session: XSession = serde_json::from_str(SESSION_JSON).unwrap();
        let json = serde_json::to_string(&session).unwrap();
        let reparsed: XSession = serde_json::from_str(&json).unwrap();
        assert_eq!(reparsed.auth_token, session.auth_token);
        assert_eq!(reparsed.ct0, session.ct0);
    }

    #[test]
    fn cookie_header_format() {
        let session = XSession::new("AUTH_TOKEN_PLACEHOLDER", "CT0_PLACEHOLDER");
        assert_eq!(
            session.cookie_header(),
            "auth_token=AUTH_TOKEN_PLACEHOLDER; ct0=CT0_PLACEHOLDER"
        );
    }

    #[test]
    fn from_cookie_string_parses_correctly() {
        let s = "auth_token=AUTH_TOKEN_PLACEHOLDER; ct0=CT0_PLACEHOLDER; twid=u%3D123";
        let session = XSession::from_cookie_string(s).unwrap();
        assert_eq!(session.auth_token, "AUTH_TOKEN_PLACEHOLDER");
        assert_eq!(session.ct0, "CT0_PLACEHOLDER");
    }

    #[test]
    fn from_cookie_string_missing_ct0_is_error() {
        let result = XSession::from_cookie_string("auth_token=AUTH_TOKEN_PLACEHOLDER");
        assert!(result.is_err());
    }

    #[test]
    fn from_cookie_string_missing_auth_token_is_error() {
        let result = XSession::from_cookie_string("ct0=CT0_PLACEHOLDER");
        assert!(result.is_err());
    }

    #[test]
    fn empty_auth_token_is_rejected() {
        let result = XSession::from_cookie_string("auth_token=; ct0=CT0_PLACEHOLDER");
        assert!(result.is_err());
    }
}
