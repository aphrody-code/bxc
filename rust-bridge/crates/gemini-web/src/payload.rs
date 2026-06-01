// SPDX-License-Identifier: Apache-2.0
//! `StreamGenerate` send-payload builder + streamed-response parser.
//!
//! Wire spec captured live from `gemini.google.com` build
//! `boq_assistant-bard-web-server_20260520.03_p0` (2026-05-21). A user message
//! is NOT sent via `batchexecute`; it goes to
//! [`crate::rpc_ids::URL_STREAM_GENERATE`] (the `BardFrontendService` streaming
//! endpoint) with body `f.req=[null,"<inner_list_json>"]&at=<token>`.
//!
//! The `inner_list` (the JSON-stringified slot 1 of the `f.req` envelope) is:
//! ```text
//! [ [prompt, 0, null, null, null, null, 0],   // [0] message_content
//!   [language],                                 // [1] language_tuple
//!   [cid, rid, rcid] ]                          // [2] chat_metadata (null on first turn)
//! ```
//! The live web UI appends further sparse context slots (indices 3+); they are
//! optional for a text-only send and omitted here.

use serde_json::{json, Value};

use crate::boq::parse_envelopes;
use crate::error::{GeminiError, Result};
use crate::types::{ChatReply, ConversationMetadata, UploadedAttachment};

/// Build the `StreamGenerate` `inner_list` for a prompt, optionally including attachments.
///
/// `language` is the `hl` locale (e.g. `"fr"`). `meta` threads a prior turn;
/// pass [`ConversationMetadata::default`] for a fresh conversation.
#[must_use]
pub fn build_send_payload(
    prompt: &str,
    language: &str,
    meta: &ConversationMetadata,
    attachments: Option<&[UploadedAttachment]>,
) -> Value {
    let image_list = if let Some(atts) = attachments {
        let list: Vec<Value> = atts
            .iter()
            .map(|att| {
                json!([
                    [att.url.clone(), 1],
                    att.name.clone()
                ])
            })
            .collect();
        Value::Array(list)
    } else {
        Value::Null
    };

    let message_content = json!([prompt, 0, Value::Null, image_list, Value::Null, Value::Null, 0]);
    let language_tuple = json!([language]);
    let chat_metadata = json!([
        opt_str(meta.conversation_id.as_deref()),
        opt_str(meta.response_id.as_deref()),
        opt_str(meta.choice_id.as_deref()),
    ]);
    json!([message_content, language_tuple, chat_metadata])
}

fn opt_str(v: Option<&str>) -> Value {
    v.map_or(Value::Null, |s| Value::String(s.to_string()))
}

/// Recursively collect Google-hosted image URLs from a JSON subtree (used for
/// generated-image extraction, where the exact leaf path varies by build).
fn collect_image_urls(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_image_urls_into(v, &mut out);
    out
}

fn collect_image_urls_into(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            if (s.starts_with("https://lh3.googleusercontent.com")
                || s.starts_with("https://www.gstatic.com")
                || s.contains("googleusercontent.com/"))
                && !s.contains(".mp4")
                && !out.iter().any(|u| u == s)
            {
                out.push(s.clone());
            }
        },
        Value::Array(a) => {
            for item in a {
                collect_image_urls_into(item, out);
            }
        },
        Value::Object(o) => {
            for item in o.values() {
                collect_image_urls_into(item, out);
            }
        },
        _ => {},
    }
}

/// Recursively collect video URLs (Veo output) from a JSON subtree.
fn collect_video_urls(v: &Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_video_urls_into(v, &mut out);
    out
}

fn collect_video_urls_into(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => {
            let is_video = s.starts_with("https://")
                && (s.contains(".mp4")
                    || s.contains("/video/")
                    || s.contains("videoplayback")
                    || (s.contains("googleusercontent.com") && s.contains("video")));
            if is_video && !out.iter().any(|u| u == s) {
                out.push(s.clone());
            }
        },
        Value::Array(a) => {
            for item in a {
                collect_video_urls_into(item, out);
            }
        },
        Value::Object(o) => {
            for item in o.values() {
                collect_video_urls_into(item, out);
            }
        },
        _ => {},
    }
}

/// Parse the raw streamed `StreamGenerate` response into a [`ChatReply`].
///
/// The body is the Boq `)]}'` + length-prefixed chunk stream; each chunk holds
/// `wrb.fr` envelopes whose inner JSON carries (progressively) the reply. We
/// take the richest envelope (longest reply text). Layout: `inner[1]` =
/// `[cid, rid]`, `inner[4]` = candidate list, candidate = `[rcid, [text, …], …]`.
///
/// # Errors
///
/// [`GeminiError::Parse`] when no envelope yields reply text.
pub fn parse_stream_response(raw: &str) -> Result<ChatReply> {
    let mut best: Option<ChatReply> = None;
    for inner in parse_envelopes(raw) {
        if let Some(reply) = extract_reply(&inner) {
            let better = best.as_ref().is_none_or(|b| reply.text.len() > b.text.len());
            if better {
                best = Some(reply);
            }
        }
    }
    best.ok_or_else(|| GeminiError::Parse("StreamGenerate: no reply candidate in stream".into()))
}

/// Extract a [`ChatReply`] from one decoded `wrb.fr` inner payload, if it holds
/// a candidate with text.
fn extract_reply(inner: &Value) -> Option<ChatReply> {
    let candidates = inner.get(4).and_then(Value::as_array)?;
    let candidate_count = candidates.len();
    let first = candidates.first()?;
    let text = first
        .get(1)
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)?
        .to_string();

    let meta_arr = inner.get(1).and_then(Value::as_array);
    let conversation_id = meta_arr
        .and_then(|m| m.first())
        .and_then(Value::as_str)
        .map(str::to_string);
    let response_id = meta_arr
        .and_then(|m| m.get(1))
        .and_then(Value::as_str)
        .map(str::to_string);
    let choice_id = first.get(0).and_then(Value::as_str).map(str::to_string);

    let web_image_urls = first
        .get(12)
        .and_then(|v| v.get(1))
        .and_then(Value::as_array)
        .map(|imgs| {
            imgs.iter()
                .filter_map(|img| img.get(0).and_then(|u| u.get(0)).and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    // Generated images (Nano Banana / image model). The web app nests them under
    // candidate[12][7]; the exact leaf indices vary by build, so collect every
    // googleusercontent/lh3 URL found in that subtree.
    let generated_image_urls = first
        .get(12)
        .and_then(|v| v.get(7))
        .map(collect_image_urls)
        .unwrap_or_default();

    // Generated videos (Veo). Scan the whole candidate subtree for video URLs —
    // the leaf path varies and videos may be delivered as a late streamed chunk.
    let generated_video_urls = first.get(12).map(collect_video_urls).unwrap_or_default();

    Some(ChatReply {
        text,
        metadata: ConversationMetadata { conversation_id, response_id, choice_id },
        web_image_urls,
        generated_image_urls,
        generated_video_urls,
        candidate_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_payload_has_prompt_lang_and_null_metadata() {
        let p = build_send_payload("hello", "fr", &ConversationMetadata::default(), None);
        assert_eq!(p[0][0], "hello");
        assert_eq!(p[1], json!(["fr"]));
        assert_eq!(p[2], json!([null, null, null]));
    }

    #[test]
    fn threaded_payload_carries_ids() {
        let meta = ConversationMetadata {
            conversation_id: Some("c_1".into()),
            response_id: Some("r_1".into()),
            choice_id: Some("rc_1".into()),
        };
        let p = build_send_payload("again", "en", &meta, None);
        assert_eq!(p[2], json!(["c_1", "r_1", "rc_1"]));
    }

    #[test]
    fn payload_carries_attachments() {
        let atts = vec![UploadedAttachment {
            url: "https://lh3.googleusercontent.com/chat/abc".to_string(),
            name: "test.png".to_string(),
        }];
        let p = build_send_payload("describe", "en", &ConversationMetadata::default(), Some(&atts));
        assert_eq!(
            p[0][3],
            json!([
                [["https://lh3.googleusercontent.com/chat/abc", 1], "test.png"]
            ])
        );
    }

    #[test]
    fn parse_stream_extracts_text_and_metadata() {
        // One wrb.fr chunk; inner[1]=[cid,rid], inner[4]=[[rcid,[text]]].
        let raw = format!(
            "{}{}\n{}",
            ")]}'\n",
            "120",
            r#"[["wrb.fr","abc","[null,[\"c_42\",\"r_99\"],null,null,[[\"rc_7\",[\"the reply\"]]]]",null,null,null,"generic"]]"#,
        );
        let reply = parse_stream_response(&raw).unwrap();
        assert_eq!(reply.text, "the reply");
        assert_eq!(reply.metadata.conversation_id.as_deref(), Some("c_42"));
        assert_eq!(reply.metadata.response_id.as_deref(), Some("r_99"));
        assert_eq!(reply.metadata.choice_id.as_deref(), Some("rc_7"));
        assert_eq!(reply.candidate_count, 1);
    }

    #[test]
    fn parse_stream_picks_longest_text() {
        // Two progressive envelopes; the second is richer.
        let raw = format!(
            ")]}}'\n40\n{}\n80\n{}",
            r#"[["wrb.fr","a","[null,[\"c\",\"r\"],null,null,[[\"rc\",[\"par\"]]]]",null,null,null,"generic"]]"#,
            r#"[["wrb.fr","a","[null,[\"c\",\"r\"],null,null,[[\"rc\",[\"partial then full\"]]]]",null,null,null,"generic"]]"#,
        );
        let reply = parse_stream_response(&raw).unwrap();
        assert_eq!(reply.text, "partial then full");
    }

    #[test]
    fn parse_stream_extracts_generated_media() {
        // candidate[1]=text; candidate[12][7] holds the generated-media subtree
        // (image url + video url). collect_image_urls excludes .mp4; the video
        // collector scans all of candidate[12].
        let inner = json!([
            null,
            ["c", "r"],
            null,
            null,
            [[
                "rc",
                ["here"],
                null, null, null, null, null, null, null, null, null, null,
                // candidate[12]:
                [
                    null, null, null, null, null, null, null,
                    // candidate[12][7] = media list:
                    [
                        ["https://lh3.googleusercontent.com/img1"],
                        ["https://video.googleusercontent.com/clip.mp4"]
                    ]
                ]
            ]]
        ]);
        let raw = format!(
            "{}{}\n[[\"wrb.fr\",\"x\",{:?},null,null,null,\"generic\"]]",
            ")]}'\n",
            "400",
            inner.to_string(),
        );
        let reply = parse_stream_response(&raw).unwrap();
        assert!(reply.generated_image_urls.iter().any(|u| u.contains("img1")));
        assert!(reply.generated_video_urls.iter().any(|u| u.contains("clip.mp4")));
    }

    #[test]
    fn parse_stream_errors_without_candidates() {
        let raw = format!("{}{}\n{}", ")]}'\n", "40", r#"[["wrb.fr","a","[null,null]",null,null,null,"generic"]]"#);
        assert!(parse_stream_response(&raw).is_err());
    }
}
