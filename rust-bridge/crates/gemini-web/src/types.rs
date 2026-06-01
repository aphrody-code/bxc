// SPDX-License-Identifier: Apache-2.0
//! Strongly-typed data model for the Gemini web surface.

use serde::{Deserialize, Serialize};

/// Opaque conversation-threading ids returned by a send and fed back into the
/// next send to continue the same thread.
///
/// All three are `None` for the very first turn of a fresh conversation; the
/// server populates them in the response (`inner[1]` + the selected candidate).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversationMetadata {
    /// Conversation / thread id (`c_…`).
    pub conversation_id: Option<String>,
    /// Response id (`r_…`).
    pub response_id: Option<String>,
    /// Chosen reply-candidate id (`rc_…`).
    pub choice_id: Option<String>,
}

impl ConversationMetadata {
    /// True when this is a brand-new conversation (no ids yet).
    #[must_use]
    pub fn is_fresh(&self) -> bool {
        self.conversation_id.is_none() && self.response_id.is_none() && self.choice_id.is_none()
    }
}

/// One model reply parsed from a [`crate::rpc_ids::SEND_MESSAGE`] response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatReply {
    /// The concatenated reply text of the selected candidate.
    pub text: String,
    /// Threading ids to continue this conversation on the next send.
    pub metadata: ConversationMetadata,
    /// Web image URLs cited by the reply (may be empty).
    #[serde(default)]
    pub web_image_urls: Vec<String>,
    /// Generated-image URLs (Nano Banana / image model output; may be empty).
    #[serde(default)]
    pub generated_image_urls: Vec<String>,
    /// Generated-video URLs (Veo / video model output; may be empty).
    #[serde(default)]
    pub generated_video_urls: Vec<String>,
    /// Number of reply candidates the server returned.
    pub candidate_count: usize,
}

/// Represents a successfully uploaded file to Google's Scotty server, ready to attach to a prompt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UploadedAttachment {
    pub url: String,
    pub name: String,
}

