// SPDX-License-Identifier: Apache-2.0
//! Pure-HTTP transport: posts an encoded `f.req` to Gemini's `batchexecute`
//! and returns the inner envelope. No browser, no FFI.
//!
//! Mirrors `notebooklm::transport::HttpTransport`; the Gemini origin/referer
//! and the optional model-selector header are the only Gemini-specific bits.
//! A future stealth path (TLS impersonation via the planned
//! `aphrody-impersonate` crate, cf. `docs/research/bxc-google-module-chrome-mcp.md`)
//! can replace the inner `reqwest::Client` without touching this surface.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::auth::Auth;
use crate::boq::{encode_f_req, first_envelope};
use crate::error::{GeminiError, Result};
use crate::rpc_ids::{MODEL_HEADER, URL_BATCH_EXECUTE, URL_ORIGIN};

const USER_AGENT_CHROME: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// Per-session opaque tokens scraped from the Gemini app bootstrap page.
/// Short-lived (`at` ~10 min); refresh by replaying the page load.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionTokens {
    /// Anti-CSRF token threaded through `f.req` (`at` field; `WIZ_global_data.SNlM0e`).
    pub at: String,
    /// Bootstrap build label (`bl` query param; `WIZ_global_data.cfb2h`).
    pub bl: String,
    /// Session id (`f.sid` query param; `WIZ_global_data.FdrFJe`).
    pub fsid: Option<String>,
    /// Browser language hint (`hl` query param).
    pub language: Option<String>,
}

/// Holds the reqwest client, credentials, session tokens and `_reqid` counter.
#[derive(Debug, Clone)]
pub struct HttpTransport {
    client: reqwest::Client,
    auth: Arc<Auth>,
    tokens: SessionTokens,
    req_counter: Arc<AtomicU64>,
}

impl HttpTransport {
    /// Build a fresh transport. The rustls crypto provider must already be
    /// installed by the calling binary (rustls 0.23, cf. CLAUDE.md §7).
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Network`] if the reqwest client cannot be built.
    pub fn new(auth: Auth, tokens: SessionTokens) -> Result<Self> {
        #[cfg(not(target_arch = "wasm32"))]
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT_CHROME)
            .timeout(Duration::from_mins(2))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| GeminiError::Network(format!("reqwest builder: {e}")))?;

        #[cfg(target_arch = "wasm32")]
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT_CHROME)
            .build()
            .map_err(|e| GeminiError::Network(format!("reqwest builder: {e}")))?;
        Ok(Self {
            client,
            auth: Arc::new(auth),
            tokens,
            req_counter: Arc::new(AtomicU64::new(100_000)),
        })
    }

    /// Replace the session tokens (after a bootstrap refresh).
    pub fn set_tokens(&mut self, tokens: SessionTokens) {
        self.tokens = tokens;
    }

    /// Borrow the active session tokens.
    #[must_use]
    pub fn tokens(&self) -> &SessionTokens {
        &self.tokens
    }

    /// Borrow the active auth (cookie jar).
    #[must_use]
    pub fn auth(&self) -> &Auth {
        self.auth.as_ref()
    }

    fn next_req_id(&self) -> u64 {
        // 100_000 stride matches the JS reference's jittered baseline.
        self.req_counter.fetch_add(100_000, Ordering::SeqCst)
    }

    fn build_headers(&self, content_length: usize, model: Option<&str>) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded;charset=UTF-8"),
        );
        headers.insert(
            reqwest::header::CONTENT_LENGTH,
            HeaderValue::from_str(&content_length.to_string())
                .map_err(|e| GeminiError::Network(format!("invalid content-length: {e}")))?,
        );
        headers.insert(
            HeaderName::from_static("origin"),
            HeaderValue::from_static(URL_ORIGIN),
        );
        headers.insert(
            HeaderName::from_static("referer"),
            HeaderValue::from_static("https://gemini.google.com/"),
        );
        headers.insert(
            HeaderName::from_static("x-same-domain"),
            HeaderValue::from_static("1"),
        );
        if let Some(model_token) = model {
            headers.insert(
                HeaderName::from_static(MODEL_HEADER),
                HeaderValue::from_str(model_token)
                    .map_err(|e| GeminiError::Network(format!("invalid model header: {e}")))?,
            );
        }
        for (name, value) in self.auth.request_headers() {
            let header_name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|e| GeminiError::Auth(format!("invalid auth header name {name}: {e}")))?;
            let header_value = HeaderValue::from_str(&value)
                .map_err(|e| GeminiError::Auth(format!("invalid auth header {name}: {e}")))?;
            headers.insert(header_name, header_value);
        }
        Ok(headers)
    }

    /// Send a generate turn to the streaming endpoint
    /// ([`crate::rpc_ids::URL_STREAM_GENERATE`]) and return the raw streamed
    /// response text for [`crate::payload::parse_stream_response`].
    ///
    /// `inner` is the message list built by
    /// [`crate::payload::build_send_payload`]; it is wrapped as
    /// `f.req=[null,"<inner_json>"]&at=<token>` (the `BardFrontendService`
    /// framing, distinct from `batchexecute`). `model` ships the optional
    /// model-selector header.
    ///
    /// # Errors
    ///
    /// [`GeminiError::Auth`] on 401/403, [`GeminiError::Rpc`] on other non-2xx.
    pub async fn stream_generate(
        &self,
        inner: &Value,
        source_path: Option<&str>,
        model: Option<&str>,
    ) -> Result<String> {
        // f.req envelope is `[null, "<inner json string>"]` (NOT the batchexecute
        // `[[[rpcid,…]]]` shape).
        let envelope = Value::Array(vec![Value::Null, Value::String(inner.to_string())]);
        let body = format!(
            "f.req={}&at={}",
            urlencoded(&envelope.to_string()),
            urlencoded(&self.tokens.at),
        );
        let req_id = self.next_req_id();
        let mut url = url::Url::parse(crate::rpc_ids::URL_STREAM_GENERATE)
            .map_err(|e| GeminiError::Network(format!("invalid stream URL: {e}")))?;
        {
            let mut qp = url.query_pairs_mut();
            qp.append_pair("bl", &self.tokens.bl);
            qp.append_pair("hl", self.tokens.language.as_deref().unwrap_or("en"));
            qp.append_pair("_reqid", &req_id.to_string());
            qp.append_pair("rt", "c");
            if let Some(sid) = &self.tokens.fsid {
                qp.append_pair("f.sid", sid);
            }
        }
        let _ = source_path; // StreamGenerate carries the thread via inner metadata, not the URL.
        let headers = self.build_headers(body.len(), model)?;
        let response = self.client.post(url).headers(headers).body(body).send().await?;
        let status = response.status();
        let text = response.text().await?;
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(GeminiError::Auth(format!("{status}: StreamGenerate rejected")));
        }
        if !status.is_success() {
            return Err(GeminiError::Rpc {
                rpc_id: "StreamGenerate".to_string(),
                status: status.as_u16(),
                message: text.chars().take(200).collect(),
            });
        }
        Ok(text)
    }

    /// Execute a single RPC and return the **raw** response body (diagnostics).
    ///
    /// Same request path as [`Self::rpc_raw`] but returns the un-parsed text,
    /// useful for inspecting Boq error frames or new response shapes.
    ///
    /// # Errors
    ///
    /// [`GeminiError::Auth`] on 401/403, [`GeminiError::Rpc`] on other non-2xx.
    pub async fn rpc_raw_text(
        &self,
        rpc_id: &str,
        payload: &Value,
        source_path: Option<&str>,
        model: Option<&str>,
    ) -> Result<String> {
        let body_form = encode_f_req(rpc_id, payload)?;
        let body = format!("f.req={}&at={}", urlencoded(&body_form), urlencoded(&self.tokens.at));
        let req_id = self.next_req_id();
        let mut url = url::Url::parse(URL_BATCH_EXECUTE)
            .map_err(|e| GeminiError::Network(format!("invalid batch URL: {e}")))?;
        {
            let mut qp = url.query_pairs_mut();
            qp.append_pair("rpcids", rpc_id);
            qp.append_pair("source-path", source_path.unwrap_or("/app"));
            qp.append_pair("bl", &self.tokens.bl);
            qp.append_pair("hl", self.tokens.language.as_deref().unwrap_or("en"));
            qp.append_pair("_reqid", &req_id.to_string());
            qp.append_pair("rt", "c");
            if let Some(sid) = &self.tokens.fsid {
                qp.append_pair("f.sid", sid);
            }
        }
        let headers = self.build_headers(body.len(), model)?;
        let response = self.client.post(url).headers(headers).body(body).send().await?;
        let status = response.status();
        let text = response.text().await?;
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(GeminiError::Auth(format!("{status}: rejected by batchexecute")));
        }
        if !status.is_success() {
            return Err(GeminiError::Rpc {
                rpc_id: rpc_id.to_string(),
                status: status.as_u16(),
                message: text.chars().take(200).collect(),
            });
        }
        Ok(text)
    }

    /// Execute a single RPC and return the inner `wrb.fr` envelope.
    ///
    /// `model` (when set) is the [`crate::rpc_ids`] model-selector token shipped
    /// via the `x-goog-ext-525001261-jspb` header (only meaningful for
    /// `MaZiqc` sends).
    ///
    /// # Errors
    ///
    /// [`GeminiError::Auth`] on 401/403, [`GeminiError::Rpc`] on other non-2xx
    /// or a `UserDisplayableError` body, [`GeminiError::Parse`] on a malformed
    /// envelope.
    pub async fn rpc_raw(
        &self,
        rpc_id: &str,
        payload: &Value,
        source_path: Option<&str>,
        model: Option<&str>,
    ) -> Result<Value> {
        let body_form = encode_f_req(rpc_id, payload)?;
        let body = format!(
            "f.req={}&at={}",
            urlencoded(&body_form),
            urlencoded(&self.tokens.at),
        );
        let req_id = self.next_req_id();
        let mut url = url::Url::parse(URL_BATCH_EXECUTE)
            .map_err(|e| GeminiError::Network(format!("invalid batch URL: {e}")))?;
        {
            let mut qp = url.query_pairs_mut();
            qp.append_pair("rpcids", rpc_id);
            qp.append_pair("source-path", source_path.unwrap_or("/app"));
            qp.append_pair("bl", &self.tokens.bl);
            qp.append_pair("hl", self.tokens.language.as_deref().unwrap_or("en"));
            qp.append_pair("_reqid", &req_id.to_string());
            qp.append_pair("rt", "c");
            if let Some(sid) = &self.tokens.fsid {
                qp.append_pair("f.sid", sid);
            }
        }
        let headers = self.build_headers(body.len(), model)?;
        let response = self.client.post(url).headers(headers).body(body).send().await?;
        let status = response.status();
        let text = response.text().await?;

        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(GeminiError::Auth(format!(
                "{status}: cookie/at rejected by batchexecute (session expired?)"
            )));
        }
        if !status.is_success() {
            return Err(GeminiError::Rpc {
                rpc_id: rpc_id.to_string(),
                status: status.as_u16(),
                message: text.chars().take(200).collect(),
            });
        }
        if text.contains("UserDisplayableError") {
            return Err(GeminiError::Rpc {
                rpc_id: rpc_id.to_string(),
                status: status.as_u16(),
                message: "UserDisplayableError in payload".to_string(),
            });
        }
        first_envelope(&text)
    }

    /// Upload a file to Gemini using Google's resumable Scotty upload flow.
    ///
    /// # Errors
    ///
    /// Returns [`GeminiError::Network`] on failures.
    // The two Scotty preflight bindings (preflight_resp / preflight2_resp) are
    // intentionally parallel names for the two OPTIONS round trips.
    #[allow(clippy::similar_names)]
    pub async fn upload_file(&self, file_name: &str, data: &[u8]) -> Result<String> {
        let upload_url_base = "https://content-push.googleapis.com/upload/";
        
        let mut base_headers = HeaderMap::new();
        base_headers.insert(
            HeaderName::from_static("authority"),
            HeaderValue::from_static("content-push.googleapis.com"),
        );
        base_headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("*/*"),
        );
        base_headers.insert(
            reqwest::header::ACCEPT_LANGUAGE,
            HeaderValue::from_static("en-US,en;q=0.7"),
        );
        base_headers.insert(
            reqwest::header::AUTHORIZATION,
            HeaderValue::from_static("Basic c2F2ZXM6cyNMdGhlNmxzd2F2b0RsN3J1d1U="),
        );
        base_headers.insert(
            HeaderName::from_static("push-id"),
            HeaderValue::from_static("feeds/mcudyrk2a4khkz"),
        );
        base_headers.insert(
            HeaderName::from_static("x-tenant-id"),
            HeaderValue::from_static("bard-storage"),
        );
        base_headers.insert(
            HeaderName::from_static("origin"),
            HeaderValue::from_static(URL_ORIGIN),
        );
        base_headers.insert(
            HeaderName::from_static("referer"),
            HeaderValue::from_static("https://gemini.google.com/"),
        );

        // 1. OPTIONS preflight to base upload URL
        let preflight_resp = self.client.request(reqwest::Method::OPTIONS, upload_url_base)
            .headers(base_headers.clone())
            .send()
            .await
            .map_err(|e| GeminiError::Network(format!("upload preflight 1: {e}")))?;
        if !preflight_resp.status().is_success() {
            return Err(GeminiError::Network(format!("upload preflight 1 failed: {}", preflight_resp.status())));
        }

        // 2. POST start request to establish resumable session
        let mut start_headers = base_headers.clone();
        start_headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded;charset=UTF-8"),
        );
        start_headers.insert(
            HeaderName::from_static("x-goog-upload-protocol"),
            HeaderValue::from_static("resumable"),
        );
        start_headers.insert(
            HeaderName::from_static("x-goog-upload-command"),
            HeaderValue::from_static("start"),
        );
        start_headers.insert(
            HeaderName::from_static("x-goog-upload-header-content-length"),
            HeaderValue::from_str(&data.len().to_string())
                .map_err(|e| GeminiError::Network(format!("invalid file size: {e}")))?,
        );
        start_headers.insert(
            HeaderName::from_static("size"),
            HeaderValue::from_str(&data.len().to_string())
                .map_err(|e| GeminiError::Network(format!("invalid file size: {e}")))?,
        );

        let start_body = format!("File name: {file_name}");
        let start_resp = self.client.post(upload_url_base)
            .headers(start_headers)
            .body(start_body)
            .send()
            .await
            .map_err(|e| GeminiError::Network(format!("upload start: {e}")))?;
        if !start_resp.status().is_success() {
            return Err(GeminiError::Network(format!("upload start failed: {}", start_resp.status())));
        }

        let upload_url = start_resp.headers()
            .get("x-goog-upload-url")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| GeminiError::Network("upload start response missing x-goog-upload-url header".to_string()))?
            .to_string();

        // 3. OPTIONS preflight to custom upload URL
        let mut custom_options_headers = base_headers.clone();
        custom_options_headers.insert(
            HeaderName::from_static("size"),
            HeaderValue::from_str(&data.len().to_string())
                .map_err(|e| GeminiError::Network(format!("invalid file size: {e}")))?,
        );
        custom_options_headers.insert(
            HeaderName::from_static("x-goog-upload-command"),
            HeaderValue::from_static("start"),
        );

        let preflight2_resp = self.client.request(reqwest::Method::OPTIONS, &upload_url)
            .headers(custom_options_headers)
            .send()
            .await
            .map_err(|e| GeminiError::Network(format!("upload preflight 2: {e}")))?;
        if !preflight2_resp.status().is_success() {
            return Err(GeminiError::Network(format!("upload preflight 2 failed: {}", preflight2_resp.status())));
        }

        // 4. POST the raw data bytes
        let mut upload_headers = base_headers.clone();
        upload_headers.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/x-www-form-urlencoded;charset=UTF-8"),
        );
        upload_headers.insert(
            HeaderName::from_static("x-goog-upload-command"),
            HeaderValue::from_static("upload, finalize"),
        );
        upload_headers.insert(
            HeaderName::from_static("x-goog-upload-offset"),
            HeaderValue::from_static("0"),
        );
        upload_headers.insert(
            HeaderName::from_static("size"),
            HeaderValue::from_str(&data.len().to_string())
                .map_err(|e| GeminiError::Network(format!("invalid file size: {e}")))?,
        );

        let upload_resp = self.client.post(&upload_url)
            .headers(upload_headers)
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| GeminiError::Network(format!("upload bytes: {e}")))?;
        if !upload_resp.status().is_success() {
            return Err(GeminiError::Network(format!("upload bytes failed: {}", upload_resp.status())));
        }

        let response_text = upload_resp.text().await
            .map_err(|e| GeminiError::Network(format!("upload read text: {e}")))?;
        Ok(response_text)
    }
}

/// RFC 3986 `application/x-www-form-urlencoded`: unreserved set passes through,
/// space becomes `+`, everything else is percent-encoded.
fn urlencoded(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len() * 3 / 2);
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'*' => {
                out.push(byte as char);
            },
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0f) as usize] as char);
            },
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urlencode_space_becomes_plus() {
        assert_eq!(urlencoded("hello world"), "hello+world");
        assert_eq!(urlencoded("a&b=c"), "a%26b%3Dc");
        assert_eq!(urlencoded("abc-123_.~*"), "abc-123_.~*");
    }

    #[test]
    fn tokens_default_is_empty() {
        let t = SessionTokens::default();
        assert!(t.at.is_empty());
        assert!(t.bl.is_empty());
        assert!(t.fsid.is_none());
    }
}
