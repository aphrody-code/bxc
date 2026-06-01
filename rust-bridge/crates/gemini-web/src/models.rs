// SPDX-License-Identifier: Apache-2.0
//! Gemini web model selection.
//!
//! A model is chosen by the `x-goog-ext-525001261-jspb` request header on the
//! `StreamGenerate` POST (NOT the `f.req` body). The header is a fixed-shape
//! JSON array carrying the model token + a stable per-client UUID. Values
//! captured live 2026-05-21 (build `boq_assistant-bard-web-server_20260520.03`):
//!
//! ```text
//! [1,null,null,null,"<token>",null,null,0,[4,5,6,8],null,null,3,null,null,<n>,1,"<client-uuid>"]
//! ```
//!
//! | Model            | token              | n  | verified |
//! |------------------|--------------------|----|----------|
//! | 3.1 Flash-Lite   | `1d44b34bcaa1c04d` | 6  | yes      |
//! | 3.5 Flash        | `56fdd199312815e2` | 1  | yes      |
//! | 3.1 Pro          | `e6fa609c3fa255c0` | 3  | inferred |
//!
//! The trailing UUID is a *stable* client/session id (identical across sends in
//! the captured traffic) — generate once per client and reuse it.

use serde_json::{json, Value};

/// A stable default client UUID. Callers may override per session via
/// [`GeminiModel::header_with_uuid`]; the web app reuses one UUID across a
/// session rather than randomising per request.
pub const DEFAULT_CLIENT_UUID: &str = "00000000-0000-4000-8000-000000000001";

/// The Gemini web models exposed in the app's model picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeminiModel {
    /// 3.1 Flash-Lite — fastest replies (verified token).
    FlashLite,
    /// 3.5 Flash — general-purpose (verified token). The aphrody-chat default.
    Flash,
    /// 3.1 Pro — advanced code/math (token inferred from the page config).
    Pro,
}

impl GeminiModel {
    /// The 16-hex model selector token (header index 4).
    #[must_use]
    pub const fn token(self) -> &'static str {
        match self {
            Self::FlashLite => "1d44b34bcaa1c04d",
            Self::Flash => "56fdd199312815e2",
            Self::Pro => "e6fa609c3fa255c0",
        }
    }

    /// The per-model discriminant at header index 14.
    #[must_use]
    pub const fn variant_index(self) -> u64 {
        match self {
            Self::FlashLite => 6,
            Self::Flash => 1,
            Self::Pro => 3,
        }
    }

    /// Human label as shown in the picker.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::FlashLite => "3.1 Flash-Lite",
            Self::Flash => "3.5 Flash",
            Self::Pro => "3.1 Pro",
        }
    }

    /// Stable lowercase id for CLI/config selection (`flash-lite`, `flash`, `pro`).
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::FlashLite => "flash-lite",
            Self::Flash => "flash",
            Self::Pro => "pro",
        }
    }

    /// Parse a [`GeminiModel`] from its [`Self::id`] (case-insensitive).
    /// Accepts `flash-lite`/`flashlite`, `flash`, `pro`.
    #[must_use]
    pub fn from_id(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "flash-lite" | "flashlite" | "flash_lite" | "3.1-flash-lite" => Some(Self::FlashLite),
            "flash" | "3.5-flash" | "flash-3.5" | "gemini-3.5-flash" | "gemini-flash" => {
                Some(Self::Flash)
            },
            "pro" | "3.1-pro" | "pro-3.1" => Some(Self::Pro),
            _ => None,
        }
    }

    /// Build the `x-goog-ext-525001261-jspb` header value with a custom client
    /// UUID.
    #[must_use]
    pub fn header_with_uuid(self, client_uuid: &str) -> String {
        let arr: Value = json!([
            1, Value::Null, Value::Null, Value::Null,
            self.token(),
            Value::Null, Value::Null, 0,
            [4, 5, 6, 8],
            Value::Null, Value::Null, 3, Value::Null, Value::Null,
            self.variant_index(), 1,
            client_uuid,
        ]);
        arr.to_string()
    }

    /// Build the model header with the [`DEFAULT_CLIENT_UUID`].
    #[must_use]
    pub fn header(self) -> String {
        self.header_with_uuid(DEFAULT_CLIENT_UUID)
    }
}

/// Reasoning depth — the "Niveau de réflexion" picker. `Extended` is the
/// "Deep Think" mode for complex problems.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReasoningLevel {
    /// Standard reasoning (the default).
    #[default]
    Standard,
    /// Extended reasoning — "Deep Think".
    Extended,
}

impl ReasoningLevel {
    /// Stable lowercase id (`standard`, `extended`).
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Extended => "extended",
        }
    }

    /// Parse from id (accepts `deep-think` as an alias for `extended`).
    #[must_use]
    pub fn from_id(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "standard" => Some(Self::Standard),
            "extended" | "deep-think" | "deepthink" | "deep_think" => Some(Self::Extended),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn flash_header_matches_captured_shape() {
        let h = GeminiModel::Flash.header_with_uuid("45EF317F-8C3C-4008-B5BB-9B541B24C99B");
        let v: Value = serde_json::from_str(&h).unwrap();
        assert_eq!(v[0], 1);
        assert_eq!(v[4], "56fdd199312815e2");
        assert_eq!(v[8], json!([4, 5, 6, 8]));
        assert_eq!(v[14], 1); // Flash variant index
        assert_eq!(v[15], 1);
        assert_eq!(v[16], "45EF317F-8C3C-4008-B5BB-9B541B24C99B");
    }

    #[test]
    fn flash_lite_variant_index_is_six() {
        let v: Value = serde_json::from_str(&GeminiModel::FlashLite.header()).unwrap();
        assert_eq!(v[4], "1d44b34bcaa1c04d");
        assert_eq!(v[14], 6);
    }

    #[test]
    fn round_trip_ids() {
        for m in [GeminiModel::FlashLite, GeminiModel::Flash, GeminiModel::Pro] {
            assert_eq!(GeminiModel::from_id(m.id()), Some(m));
        }
        assert_eq!(GeminiModel::from_id("FLASH"), Some(GeminiModel::Flash));
        assert_eq!(GeminiModel::from_id("nope"), None);
    }

    #[test]
    fn deep_think_alias() {
        assert_eq!(ReasoningLevel::from_id("deep-think"), Some(ReasoningLevel::Extended));
        assert_eq!(ReasoningLevel::from_id("standard"), Some(ReasoningLevel::Standard));
    }
}
