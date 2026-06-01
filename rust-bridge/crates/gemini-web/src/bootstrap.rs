// SPDX-License-Identifier: Apache-2.0
//! Headless bootstrap: fetch the Gemini app page with the cookie jar and scrape
//! the per-session tokens (`SNlM0e`=at, `cfb2h`=bl, `FdrFJe`=f.sid) out of the
//! embedded `WIZ_global_data` blob.
//!
//! This is the piece the `notebooklm` crate left "out-of-crate"; here it is a
//! pure-HTTP scrape (no browser). If Google's anti-bot starts gating the page
//! behind a JS challenge, swap the inner client for the planned
//! `aphrody-impersonate` TLS-fingerprint transport (cf.
//! `docs/research/bxc-google-module-chrome-mcp.md`).

use std::sync::LazyLock;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;

use regex::Regex;

use crate::auth::Auth;
use crate::error::{GeminiError, Result};
use crate::rpc_ids::URL_APP;
use crate::transport::SessionTokens;

const USER_AGENT_CHROME: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// `WIZ_global_data` embeds the tokens as `"KEY":"VALUE"`. Compile once.
static RE_AT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""SNlM0e":"([^"]+)""#).unwrap());
static RE_BL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""cfb2h":"([^"]+)""#).unwrap());
static RE_FSID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""FdrFJe":"([^"]+)""#).unwrap());

/// Scrape [`SessionTokens`] from the Gemini app page HTML.
///
/// `language` populates the `hl` query param on subsequent RPCs (default `en`).
///
/// # Errors
///
/// [`GeminiError::Auth`] on 401/403 (signed out), [`GeminiError::Bootstrap`]
/// when the page loaded but the `at`/`bl` tokens are absent.
pub async fn fetch_session_tokens(auth: &Auth, language: Option<&str>) -> Result<SessionTokens> {
    #[cfg(not(target_arch = "wasm32"))]
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT_CHROME)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| GeminiError::Network(format!("reqwest builder: {e}")))?;

    #[cfg(target_arch = "wasm32")]
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT_CHROME)
        .build()
        .map_err(|e| GeminiError::Network(format!("reqwest builder: {e}")))?;

    let mut req = client.get(URL_APP);
    for (name, value) in auth.request_headers() {
        req = req.header(name, value);
    }
    let response = req.send().await.map_err(|e| GeminiError::Network(e.to_string()))?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(GeminiError::Auth(format!(
            "{status}: Gemini app page rejected the cookie jar (signed out?)"
        )));
    }
    let html = response.text().await.map_err(|e| GeminiError::Network(e.to_string()))?;
    parse_tokens_from_html(&html, language)
}

/// Extract the tokens from already-fetched HTML (separated for testability).
///
/// # Errors
///
/// [`GeminiError::Bootstrap`] when the mandatory `at`/`bl` tokens are missing.
pub fn parse_tokens_from_html(html: &str, language: Option<&str>) -> Result<SessionTokens> {
    let at = RE_AT
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            GeminiError::Bootstrap("SNlM0e (at) token not found in page — not signed in?".into())
        })?;
    let bl = RE_BL
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| GeminiError::Bootstrap("cfb2h (bl) token not found in page".into()))?;
    let fsid = RE_FSID
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    Ok(SessionTokens { at, bl, fsid, language: language.map(str::to_string) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tokens_from_wiz_blob() {
        let html = r#"<script>window.WIZ_global_data = {"cfb2h":"boq_x_20260511","FdrFJe":"-12345","SNlM0e":"AOabc:170","qwAQke":"BardChatUi"};</script>"#;
        let t = parse_tokens_from_html(html, Some("fr")).unwrap();
        assert_eq!(t.at, "AOabc:170");
        assert_eq!(t.bl, "boq_x_20260511");
        assert_eq!(t.fsid.as_deref(), Some("-12345"));
        assert_eq!(t.language.as_deref(), Some("fr"));
    }

    #[test]
    fn missing_at_token_is_bootstrap_error() {
        let html = r#"<script>window.WIZ_global_data = {"cfb2h":"boq_x"};</script>"#;
        let err = parse_tokens_from_html(html, None).unwrap_err();
        assert!(matches!(err, GeminiError::Bootstrap(_)));
    }

    #[test]
    fn fsid_is_optional() {
        let html = r#"{"SNlM0e":"AO:1","cfb2h":"boq"}"#;
        let t = parse_tokens_from_html(html, None).unwrap();
        assert!(t.fsid.is_none());
    }
}
