// SPDX-License-Identifier: Apache-2.0
//! Chunked media upload for attaching images / GIFs / video to tweets.
//!
//! Uses X's legacy media upload endpoint (`upload.twitter.com/i/media/upload.json`)
//! with the standard INIT / APPEND / FINALIZE command sequence and cookie auth.
//! Video and animated GIF uploads return async `processing_info`; this module
//! polls the STATUS command until the asset is ready. Optional alt text is set
//! via `media/metadata/create.json`.

use std::path::Path;
use std::time::Duration;

use reqwest::multipart::{Form, Part};
use serde_json::Value;

use crate::client::{check_api_errors, random_transaction_id, XClient};
use crate::{Result, XError};

/// Legacy media upload endpoint (separate host from the GraphQL API).
const UPLOAD_URL: &str = "https://upload.twitter.com/i/media/upload.json";
/// Per-APPEND chunk size (X accepts up to ~5 MiB; 1 MiB is safe and steady).
const CHUNK_SIZE: usize = 1024 * 1024;
/// Max seconds to wait for async (video/GIF) processing before giving up.
const MAX_PROCESSING_WAIT_SECS: u64 = 120;

/// Resolved MIME type + media category for an upload, derived from extension.
struct MediaKind {
    mime: &'static str,
    category: &'static str,
}

fn detect_media_kind(path: &Path) -> Result<MediaKind> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    let kind = match ext.as_str() {
        "jpg" | "jpeg" => MediaKind {
            mime: "image/jpeg",
            category: "tweet_image",
        },
        "png" => MediaKind {
            mime: "image/png",
            category: "tweet_image",
        },
        "webp" => MediaKind {
            mime: "image/webp",
            category: "tweet_image",
        },
        "gif" => MediaKind {
            mime: "image/gif",
            category: "tweet_gif",
        },
        "mp4" => MediaKind {
            mime: "video/mp4",
            category: "tweet_video",
        },
        "mov" => MediaKind {
            mime: "video/quicktime",
            category: "tweet_video",
        },
        other => {
            return Err(XError::Auth(format!(
                "unsupported media extension '.{other}' (allowed: jpg, jpeg, png, webp, gif, mp4, mov)"
            )));
        }
    };
    Ok(kind)
}

impl XClient {
    /// Upload a local media file and return its `media_id` string.
    ///
    /// Handles the full INIT/APPEND/FINALIZE sequence, polls processing for
    /// video/GIF, and sets `alt` text when provided. The returned id can be
    /// passed to [`XClient::create_tweet_with_media`].
    pub async fn upload_media(&self, path: &Path, alt: Option<&str>) -> Result<String> {
        let bytes = std::fs::read(path)?;
        if bytes.is_empty() {
            return Err(XError::Auth(format!(
                "media file is empty: {}",
                path.display()
            )));
        }
        let kind = detect_media_kind(path)?;

        let media_id = self.media_init(bytes.len(), &kind).await?;

        for (index, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
            self.media_append(&media_id, index as u32, chunk, kind.mime).await?;
        }

        let finalize = self.media_finalize(&media_id).await?;
        self.await_processing(&media_id, &finalize).await?;

        if let Some(text) = alt
            && !text.is_empty()
        {
            self.media_metadata(&media_id, text).await?;
        }

        Ok(media_id)
    }

    async fn media_init(&self, total_bytes: usize, kind: &MediaKind) -> Result<String> {
        let total = total_bytes.to_string();
        // INIT params go in the form-encoded BODY (not the query string), which
        // is what upload.twitter.com expects.
        let form = [
            ("command", "INIT"),
            ("total_bytes", total.as_str()),
            ("media_type", kind.mime),
            ("media_category", kind.category),
        ];
        let resp = self
            .inner()
            .post(UPLOAD_URL)
            .header("x-client-transaction-id", random_transaction_id())
            .form(&form)
            .send()
            .await?;
        let json = read_json(resp).await?;
        json.get("media_id_string")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| json.get("media_id").map(|v| v.to_string()))
            .ok_or_else(|| XError::Api {
                code: -1,
                message: "media INIT response missing media_id_string".into(),
            })
    }

    async fn media_append(
        &self,
        media_id: &str,
        segment_index: u32,
        chunk: &[u8],
        mime: &str,
    ) -> Result<()> {
        // APPEND carries command / media_id / segment_index as multipart fields
        // alongside the binary `media` part.
        let part = Part::bytes(chunk.to_vec())
            .file_name("media")
            .mime_str(mime)
            .map_err(XError::Http)?;
        let form = Form::new()
            .text("command", "APPEND")
            .text("media_id", media_id.to_owned())
            .text("segment_index", segment_index.to_string())
            .part("media", part);
        let resp = self
            .inner()
            .post(UPLOAD_URL)
            .header("x-client-transaction-id", random_transaction_id())
            .multipart(form)
            .send()
            .await?;
        self.capture_rate_limit(resp.headers());
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!(
                    "media APPEND failed: HTTP {status} {}",
                    body.chars().take(160).collect::<String>()
                ),
            });
        }
        Ok(())
    }

    async fn media_finalize(&self, media_id: &str) -> Result<Value> {
        let form = [("command", "FINALIZE"), ("media_id", media_id)];
        let resp = self
            .inner()
            .post(UPLOAD_URL)
            .header("x-client-transaction-id", random_transaction_id())
            .form(&form)
            .send()
            .await?;
        read_json(resp).await
    }

    /// Poll the STATUS command until video/GIF processing succeeds or fails.
    async fn await_processing(&self, media_id: &str, finalize: &Value) -> Result<()> {
        let mut info = finalize.get("processing_info").cloned();
        let mut waited = 0u64;

        while let Some(pi) = info {
            let state = pi.get("state").and_then(Value::as_str).unwrap_or("");
            match state {
                "succeeded" => return Ok(()),
                "failed" => {
                    let msg = pi
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("media processing failed");
                    return Err(XError::Api {
                        code: -1,
                        message: msg.to_owned(),
                    });
                }
                _ => {}
            }
            let check_after = pi
                .get("check_after_secs")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 10);
            if waited + check_after > MAX_PROCESSING_WAIT_SECS {
                return Err(XError::Api {
                    code: -1,
                    message: format!("media processing timed out after {waited}s"),
                });
            }
            tokio::time::sleep(Duration::from_secs(check_after)).await;
            waited += check_after;

            let resp = self
                .inner()
                .get(UPLOAD_URL)
                .query(&[("command", "STATUS"), ("media_id", media_id)])
                .send()
                .await?;
            let json = read_json(resp).await?;
            info = json.get("processing_info").cloned();
        }
        Ok(())
    }

    async fn media_metadata(&self, media_id: &str, alt: &str) -> Result<()> {
        let url = format!("{}/1.1/media/metadata/create.json", crate::client::API_BASE);
        let body = serde_json::json!({
            "media_id": media_id,
            "alt_text": { "text": alt }
        });
        let resp = self
            .inner()
            .post(&url)
            .header("x-client-transaction-id", random_transaction_id())
            .json(&body)
            .send()
            .await?;
        // metadata/create returns 200 with empty body on success.
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(XError::Api {
                code: status.as_u16().into(),
                message: format!("media metadata failed: HTTP {status} {}", body.chars().take(160).collect::<String>()),
            });
        }
        Ok(())
    }
}

async fn read_json(resp: reqwest::Response) -> Result<Value> {
    let status = resp.status();
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        if json.is_object() {
            check_api_errors(&json)?;
        }
        return Err(XError::Api {
            code: status.as_u16().into(),
            message: format!("HTTP {status} from media upload"),
        });
    }
    Ok(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_image_kinds() {
        assert_eq!(detect_media_kind(Path::new("a.jpg")).unwrap().mime, "image/jpeg");
        assert_eq!(detect_media_kind(Path::new("a.PNG")).unwrap().mime, "image/png");
        assert_eq!(
            detect_media_kind(Path::new("a.gif")).unwrap().category,
            "tweet_gif"
        );
        assert_eq!(
            detect_media_kind(Path::new("a.mp4")).unwrap().category,
            "tweet_video"
        );
    }

    #[test]
    fn rejects_unknown_extension() {
        assert!(detect_media_kind(Path::new("a.bmp")).is_err());
        assert!(detect_media_kind(Path::new("noext")).is_err());
    }
}
