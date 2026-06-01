// SPDX-License-Identifier: Apache-2.0
//! Authentication for the Gemini web client.
//!
//! Gemini reuses the signed-in Google session cookies. The user exports them
//! from a logged-in browser (e.g. the Cookie-Editor extension) into a JSON
//! file; the headless client replays the jar on every `batchexecute` POST. The
//! anti-CSRF `at` token is NOT a cookie — it is scraped from the app page at
//! bootstrap (see [`crate::bootstrap`]).
//!
//! Secrets stay on disk under the caller's home (`~/.aphrody/google-cookies.json`
//! by default); they are never written into the aphrody workspace.

use std::collections::BTreeMap;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{GeminiError, Result};

/// One entry in the cookie jar. Field aliases accept both the Cookie-Editor
/// (`httpOnly`, camel-case) spelling and the `aphrody chromium export-session`
/// schema (`host_key` / `is_secure` / `is_httponly`), so a single struct
/// deserialises either source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionCookie {
    pub name: String,
    pub value: String,
    /// Domain the browser bound the cookie to (e.g. `".google.com"`). Accepts
    /// `domain` (Cookie-Editor) or `host_key` (google-session export).
    #[serde(default, alias = "host_key")]
    pub domain: String,
    #[serde(default = "default_path")]
    pub path: String,
    /// Accepts `secure` (Cookie-Editor) or `is_secure` (google-session export).
    #[serde(default, alias = "is_secure")]
    pub secure: bool,
    /// Accepts `httpOnly` (Cookie-Editor), `http_only`, or `is_httponly`
    /// (google-session export).
    #[serde(default, alias = "httpOnly", alias = "is_httponly")]
    pub http_only: bool,
}

fn default_path() -> String {
    "/".to_string()
}

/// Collection of cookies, indexed by name so dedup is cheap on import.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct CookieJar {
    pub cookies: BTreeMap<String, SessionCookie>,
}

impl CookieJar {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, cookie: SessionCookie) {
        self.cookies.insert(cookie.name.clone(), cookie);
    }

    /// Build the flat `Cookie:` header value the Boq endpoint expects.
    #[must_use]
    pub fn header_value(&self) -> String {
        self.cookies
            .values()
            .map(|c| format!("{}={}", c.name, c.value))
            .collect::<Vec<_>>()
            .join("; ")
    }

    /// Fetch a cookie value by name (used for `SAPISIDHASH` minting).
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&str> {
        self.cookies.get(name).map(|c| c.value.as_str())
    }

    /// Required tokens for a Gemini session — fail fast if any are missing.
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Auth`] when a mandatory cookie is absent.
    pub fn require_google_session(&self) -> Result<()> {
        // `__Secure-1PSID` is the first-party session cookie the Gemini web app
        // (`batchexecute`) authenticates with; the `at` anti-CSRF token is
        // scraped from the page, not derived from cookies. `SAPISID` is only
        // needed to mint a `SAPISIDHASH` for the cross-origin APIs gateway,
        // which this client does not use — so it is NOT required here (many
        // exports, e.g. a single-profile Cookie-Editor dump, omit it).
        if !self.cookies.contains_key("__Secure-1PSID") {
            return Err(GeminiError::Auth(
                "cookie jar is missing `__Secure-1PSID` — re-export the signed-in Google session"
                    .to_owned(),
            ));
        }
        Ok(())
    }
}

/// Cookie-jar credential carrier for the Gemini web surface.
#[derive(Debug, Clone)]
pub struct Auth {
    jar: CookieJar,
}

impl Auth {
    /// Wrap a pre-built jar.
    #[must_use]
    pub fn from_jar(jar: CookieJar) -> Self {
        Self { jar }
    }

    /// Parse the JSON array produced by the Cookie-Editor browser extension
    /// (a flat `Vec<SessionCookie>`).
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Auth`] when the JSON is malformed or the jar is
    /// missing a mandatory Google session cookie.
    pub fn from_cookie_editor_json(payload: &str) -> Result<Self> {
        let raw: Vec<SessionCookie> = serde_json::from_str(payload)
            .map_err(|e| GeminiError::Auth(format!("malformed cookie JSON: {e}")))?;
        let mut jar = CookieJar::new();
        for cookie in raw {
            jar.insert(cookie);
        }
        jar.require_google_session()?;
        Ok(Self { jar })
    }

    /// Parse the `aphrody.google-session/v1` envelope written by
    /// `aphrody chromium export-session` — a `{ "cookies": [ … ], … }` object
    /// whose entries carry `host_key` / `is_secure` / `is_httponly` (mapped onto
    /// [`SessionCookie`] via serde aliases). Extra envelope fields
    /// (`gemini_oauth`, `stats`, …) are ignored.
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Auth`] when the JSON is malformed or the jar is
    /// missing a mandatory Google session cookie.
    pub fn from_google_session_json(payload: &str) -> Result<Self> {
        #[derive(Deserialize)]
        struct Envelope {
            #[serde(default)]
            cookies: Vec<SessionCookie>,
        }
        let env: Envelope = serde_json::from_str(payload)
            .map_err(|e| GeminiError::Auth(format!("malformed google-session JSON: {e}")))?;
        let mut jar = CookieJar::new();
        for cookie in env.cookies {
            jar.insert(cookie);
        }
        jar.require_google_session()?;
        Ok(Self { jar })
    }

    /// Parse either supported on-disk format, dispatching on the first
    /// non-whitespace byte: a `[` is a Cookie-Editor array, anything else is
    /// treated as the google-session envelope object.
    ///
    /// # Errors
    ///
    /// Propagates the [`GeminiError::Auth`] of the selected parser.
    pub fn from_any_json(payload: &str) -> Result<Self> {
        match payload.trim_start().as_bytes().first() {
            Some(b'[') => Self::from_cookie_editor_json(payload),
            _ => Self::from_google_session_json(payload),
        }
    }

    /// Load a cookie jar from a file, accepting **either** a Cookie-Editor array
    /// (default `~/.aphrody/google-cookies.json`) **or** the google-session
    /// envelope (`~/.aphrody/google-session.json`, from `chromium
    /// export-session`).
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Network`] on IO failure or [`GeminiError::Auth`]
    /// on a malformed / incomplete jar.
    #[cfg(not(target_arch = "wasm32"))]
    pub async fn from_cookie_file(path: impl AsRef<Path>) -> Result<Self> {
        let payload = tokio::fs::read_to_string(path.as_ref()).await?;
        Self::from_any_json(&payload)
    }

    /// Borrow the underlying jar (for `SAPISIDHASH` minting / diagnostics).
    #[must_use]
    pub fn jar(&self) -> &CookieJar {
        &self.jar
    }

    /// Materialise the HTTP headers reqwest should ship with every request.
    #[must_use]
    pub fn request_headers(&self) -> Vec<(&'static str, String)> {
        vec![("Cookie", self.jar.header_value())]
    }
}

/// Compute the origin-bound `SAPISIDHASH` value the Google APIs gateway accepts
/// (`<unix_seconds>_<sha256(unix_seconds + ' ' + SAPISID + ' ' + origin)>`).
///
/// Not required by `batchexecute` (which uses the page `at` token), but exposed
/// so callers can mint the `Authorization: SAPISIDHASH` header for the public
/// Google APIs gateway with the same jar.
#[must_use]
pub fn sapisidhash(sapisid: &str, origin: &str, unix_seconds: u64) -> String {
    use sha2::Digest;
    let payload = format!("{unix_seconds} {sapisid} {origin}");
    let mut hasher = sha2::Sha256::new();
    hasher.update(payload.as_bytes());
    let digest = hasher.finalize();
    format!("{unix_seconds}_{}", hex_lowercase(&digest))
}

fn hex_lowercase(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_editor_camelcase_httponly_parses() {
        let json = r#"[
            {"name":"SAPISID","value":"v1","domain":".google.com","path":"/","secure":true,"httpOnly":false},
            {"name":"__Secure-1PSID","value":"v2","domain":".google.com","path":"/","secure":true,"httpOnly":true}
        ]"#;
        let auth = Auth::from_cookie_editor_json(json).unwrap();
        assert_eq!(auth.jar().get("SAPISID"), Some("v1"));
        assert!(auth.jar().cookies["__Secure-1PSID"].http_only);
    }

    #[test]
    fn missing_required_cookie_is_rejected() {
        let json = r#"[{"name":"NID","value":"x","domain":".google.com"}]"#;
        let err = Auth::from_cookie_editor_json(json).unwrap_err();
        assert!(matches!(err, GeminiError::Auth(_)));
    }

    #[test]
    fn google_session_envelope_parses_with_export_field_names() {
        // The `aphrody chromium export-session` shape: an object with a
        // `cookies` array whose entries use host_key / is_secure / is_httponly.
        let json = r#"{
            "schema":"aphrody.google-session/v1",
            "generated_at":"2026-05-26T00:00:00Z",
            "profile":"Profile 1",
            "cookies":[
                {"host_key":".google.com","name":"SAPISID","value":"v1","path":"/","expires_utc":0,"is_secure":true,"is_httponly":false,"is_session":true,"samesite":0},
                {"host_key":".google.com","name":"__Secure-1PSID","value":"v2","path":"/","expires_utc":0,"is_secure":true,"is_httponly":true,"is_session":false,"samesite":1}
            ],
            "gemini_oauth":null,
            "stats":{"total_cookies":2}
        }"#;
        let auth = Auth::from_google_session_json(json).expect("envelope must parse");
        assert_eq!(auth.jar().get("SAPISID"), Some("v1"));
        let secure_psid = &auth.jar().cookies["__Secure-1PSID"];
        assert!(secure_psid.http_only, "is_httponly must map onto http_only");
        assert!(secure_psid.secure, "is_secure must map onto secure");
        assert_eq!(secure_psid.domain, ".google.com", "host_key must map onto domain");
    }

    #[test]
    fn from_any_json_dispatches_on_first_byte() {
        // Array -> Cookie-Editor path.
        let array = r#"[
            {"name":"SAPISID","value":"a"},
            {"name":"__Secure-1PSID","value":"b"}
        ]"#;
        assert_eq!(Auth::from_any_json(array).unwrap().jar().get("SAPISID"), Some("a"));

        // Leading-whitespace object -> google-session envelope path.
        let object = r#"
            {"cookies":[
                {"host_key":".google.com","name":"SAPISID","value":"c"},
                {"host_key":".google.com","name":"__Secure-1PSID","value":"d"}
            ]}"#;
        assert_eq!(Auth::from_any_json(object).unwrap().jar().get("__Secure-1PSID"), Some("d"));
    }

    #[test]
    fn header_value_is_semicolon_joined() {
        let json = r#"[
            {"name":"SAPISID","value":"a"},
            {"name":"__Secure-1PSID","value":"b"}
        ]"#;
        let auth = Auth::from_cookie_editor_json(json).unwrap();
        // BTreeMap orders by name; 'S' (0x53) < '_' (0x5F), so SAPISID first.
        assert_eq!(auth.jar().header_value(), "SAPISID=a; __Secure-1PSID=b");
    }

    #[test]
    fn sapisidhash_is_deterministic() {
        let h = sapisidhash("SAPISIDVALUE", "https://gemini.google.com", 1_700_000_000);
        assert!(h.starts_with("1700000000_"));
        assert_eq!(h.len(), "1700000000_".len() + 64);
    }
}
