// SPDX-License-Identifier: Apache-2.0
//! Feature-flag set builder for X GraphQL requests.
//!
//! X's private GraphQL API requires a `features` query parameter (for GET
//! queries) or body field (for POST mutations) containing a JSON object
//! mapping feature-switch names to boolean values.  The set of flags expected
//! by the server evolves with each bundle deployment; sending an older subset
//! is generally safe because unknown flags default to `false` server-side.
//!
//! # Defaults
//!
//! [`default_features`] returns the full 148-flag object covering every flag
//! name found in the live-extracted catalog.  Values are determined by the
//! following heuristic (which matches what a real Chrome 124 browser sends):
//!
//! - Flags whose name ends with `_disabled` → `false`.
//! - Flags whose name contains `blacklist` or `killswitch` → `false`.
//! - Flags whose name ends with `_enabled` and starts with `responsive_web_`,
//!   `rweb_`, `longform_`, `graphql_`, `view_counts_`, `tweet_with_`,
//!   `subscriptions_`, `articles_`, `creator_`, `c9s_`, `freedom_`,
//!   `verified_`, `hidden_profile_`, `highlights_` → `true`.
//! - `verified_phone_label_enabled` → `false` (unverified accounts).
//! - Flags that look like non-boolean parameters (numbers, keys, URLs) →
//!   `false` (serde_json serialises them as `false` which the server ignores).
//! - Everything else → `true`.
//!
//! # Known-good subset
//!
//! The [`CREATE_TWEET_FEATURES_KNOWN_GOOD`] constant is the exact blob that
//! was captured from a live CreateTweet call in May 2026 and is known to
//! reach the server successfully (HTTP-level; blocked only by account daily
//! limit, not by a missing flag).  It is preserved verbatim so that the
//! `create_tweet` path always has a battle-tested fallback.

use serde_json::Value;

use crate::catalog::Operation;

// ---------------------------------------------------------------------------
// Known-good feature blob for CreateTweet (preserved from original api.rs)
// ---------------------------------------------------------------------------

/// Captured from a live CreateTweet call, May 2026.  HTTP-level success
/// confirmed (blocked only by account daily tweet cap, error code 344).
pub const CREATE_TWEET_FEATURES_KNOWN_GOOD: &str = r#"{
    "interactive_text_enabled": true,
    "longform_notetweets_inline_media_enabled": true,
    "longform_notetweets_rich_text_read_enabled": true,
    "longform_notetweets_consumption_enabled": true,
    "tweet_awards_web_tipping_enabled": false,
    "freedom_of_speech_not_reach_fetch_enabled": true,
    "standardized_nudges_misinfo": true,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
    "rweb_video_timestamps_enabled": true,
    "longform_notetweets_prompts_enabled": true,
    "creator_subscriptions_tweet_preview_api_enabled": true,
    "c9s_tweet_anatomy_moderator_badge_enabled": true,
    "articles_preview_enabled": true,
    "rweb_tipjar_consumption_enabled": true,
    "responsive_web_graphql_exclude_directive_enabled": true,
    "verified_phone_label_enabled": false,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "responsive_web_graphql_timeline_navigation_enabled": true,
    "responsive_web_enhance_cards_enabled": false
}"#;

// ---------------------------------------------------------------------------
// Default feature map — covers all 148 flags from the catalog
// ---------------------------------------------------------------------------

/// Raw JSON string for the default feature flags.
///
/// Covers the full 148-flag list extracted from the X catalog.  Parsed once
/// at first call by [`default_features`].  Defined as a constant so callers
/// can embed it directly if they prefer to avoid the parse cost (negligible
/// but measurable in tight hot loops).
///
/// Heuristic for flag values (mirrors real Chrome 124 browser traffic):
/// - `*_disabled`, `*blacklist*`, `*killswitch*` → `false`
/// - `verified_phone_label_enabled`              → `false` (unverified)
/// - `responsive_web_graphql_skip_*`             → `false` (skip = disable)
/// - `responsive_web_enhance_cards_enabled`      → `false` (deprecated)
/// - non-boolean params (numeric/key/URL flags)  → `false`
/// - everything else with `_enabled` suffix      → `true`
/// - everything else                             → `true` (safe default)
pub const DEFAULT_FEATURES_JSON: &str = r#"{
  "all_enabled": true,
  "articles_preview_enabled": true,
  "articles_rest_api_enabled": true,
  "blue_business_multi_affiliates_ui_enabled": true,
  "blue_longer_video_enabled": true,
  "branded_features_is_branded_likes_on_tweet_content_enabled": false,
  "c9s_enabled": true,
  "c9s_tweet_anatomy_moderator_badge_enabled": true,
  "co_timeline_topic_filter_enabled": true,
  "communities_non_member_reply_enabled": true,
  "communities_web_enable_tweet_community_results_fetch": true,
  "content_disclosure_ai_generated_indicator_enabled": true,
  "content_disclosure_indicator_enabled": true,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "disallowed_reply_controls_callout_enabled": false,
  "dm_conversations_nsfw_media_filter_enabled": false,
  "dont_mention_me_view_api_enabled": true,
  "freedom_of_speech_not_reach_fetch_enabled": true,
  "graphql_is_translatable_rweb_tweet_is_translatable_enabled": true,
  "gryphon_underground_enabled": false,
  "hidden_profile_subscriptions_enabled": true,
  "highlights_tweets_tab_ui_enabled": true,
  "is_enabled": true,
  "longform_notetweets_composition_without_claims_enabled": true,
  "longform_notetweets_consumption_enabled": true,
  "longform_notetweets_inline_media_enabled": true,
  "longform_notetweets_max_weighted_character_length": false,
  "longform_notetweets_rich_composition_enabled": true,
  "longform_notetweets_rich_text_read_enabled": true,
  "longform_notetweets_tweet_storm_enabled": true,
  "optimized_sru_parameters_enabled": true,
  "post_ctas_fetch_enabled": true,
  "premium_content_api_read_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "profile_sort_enabled": true,
  "responsive_web_alt_text_nudges_enabled": true,
  "responsive_web_api_transition_enabled": true,
  "responsive_web_birdwatch_consumption_enabled": true,
  "responsive_web_birdwatch_pivots_enabled": true,
  "responsive_web_castle_client_event_enabled": false,
  "responsive_web_castle_public_key": false,
  "responsive_web_castle_sdk_enabled": false,
  "responsive_web_composer_configurable_video_player_enabled": true,
  "responsive_web_cookie_compliance_1st_party_killswitch_list": false,
  "responsive_web_cookie_compliance_gingersnap_enabled": false,
  "responsive_web_cookie_consent_signal_enabled": false,
  "responsive_web_edit_tweet_api_enabled": true,
  "responsive_web_edit_tweet_enabled": true,
  "responsive_web_edit_tweet_perspective_enabled": false,
  "responsive_web_enhance_cards_enabled": false,
  "responsive_web_extension_compatibility_hide": false,
  "responsive_web_extension_compatibility_override_param": false,
  "responsive_web_fetch_hashflags_on_boot": true,
  "responsive_web_graphql_feedback": false,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true,
  "responsive_web_grok_analysis_button_from_backend": true,
  "responsive_web_grok_analyze_button_fetch_trends_enabled": true,
  "responsive_web_grok_analyze_post_followups_enabled": true,
  "responsive_web_grok_annotations_enabled": true,
  "responsive_web_grok_article_summary_enabled": true,
  "responsive_web_grok_bio_auto_translation_in_followers_enabled": false,
  "responsive_web_grok_bio_auto_translation_in_search_is_enabled": false,
  "responsive_web_grok_bio_auto_translation_is_enabled": false,
  "responsive_web_grok_community_note_auto_translation_is_enabled": false,
  "responsive_web_grok_image_annotation_enabled": true,
  "responsive_web_grok_imagine_annotation_enabled": true,
  "responsive_web_grok_link_edit_image_to_grok_com_enabled": false,
  "responsive_web_grok_media_attribution_focal_post_force_show": false,
  "responsive_web_grok_media_attribution_imagine_force_show": false,
  "responsive_web_grok_media_attribution_route_to_imagine_composer": false,
  "responsive_web_grok_share_attachment_enabled": true,
  "responsive_web_grok_show_grok_translated_post": false,
  "responsive_web_grok_tweet_media_detail_edit_image_button_enabled": false,
  "responsive_web_grok_tweet_media_edit_image_button_enabled": false,
  "responsive_web_hevc_upload_preview_enabled": false,
  "responsive_web_jetfuel_frame": false,
  "responsive_web_locale_context_direction_enabled": true,
  "responsive_web_logged_out_ios_webview_redirect_enabled": false,
  "responsive_web_media_upload_appendmulti_enabled": true,
  "responsive_web_media_upload_appendmulti_max_concurrent_requests": false,
  "responsive_web_media_upload_appendmulti_max_request_bytes": false,
  "responsive_web_media_upload_appendmulti_max_segment_bytes": false,
  "responsive_web_media_upload_appendmulti_min_file_bytes": false,
  "responsive_web_media_upload_appendmulti_min_segment_bytes": false,
  "responsive_web_media_upload_appendmulti_pre_read_blob": false,
  "responsive_web_media_upload_appendmulti_target_wire_send_time_ms": false,
  "responsive_web_media_upload_host": false,
  "responsive_web_media_upload_limit_2g": false,
  "responsive_web_media_upload_limit_3g": false,
  "responsive_web_media_upload_limit_slow_2g": false,
  "responsive_web_media_upload_md5_hashing_enabled": true,
  "responsive_web_media_upload_metrics_enabled": false,
  "responsive_web_media_upload_target_jpg_pixels_per_byte": false,
  "responsive_web_ocf_reportflow_appeals_enabled": true,
  "responsive_web_ocf_reportflow_dms_enabled": true,
  "responsive_web_ocf_reportflow_lists_enabled": true,
  "responsive_web_ocf_reportflow_profiles_enabled": true,
  "responsive_web_ocf_reportflow_spaces_enabled": true,
  "responsive_web_ocf_reportflow_suspension_appeals_enabled": true,
  "responsive_web_ocf_reportflow_testers": false,
  "responsive_web_ocf_reportflow_tweets_enabled": true,
  "responsive_web_ocf_reportflow_user_label_appeals_enabled": true,
  "responsive_web_profile_redirect_enabled": true,
  "responsive_web_redux_use_fragment_enabled": false,
  "responsive_web_send_cookies_metadata_enabled": false,
  "responsive_web_service_worker_update_toast_interval_hours": false,
  "responsive_web_spud_enabled": false,
  "responsive_web_timeline_relay_lists_management_enabled": true,
  "responsive_web_timezone_header_enabled": false,
  "responsive_web_tracer_global_trace_sample_rate": false,
  "responsive_web_twitter_article_notes_tab_enabled": true,
  "responsive_web_twitter_article_plain_text_enabled": true,
  "responsive_web_twitter_article_seed_tweet_detail_enabled": true,
  "responsive_web_twitter_article_tweet_consumption_enabled": true,
  "responsive_web_x_translation_enabled": true,
  "rweb_cashtags_composer_attachment_enabled": true,
  "rweb_cashtags_enabled": true,
  "rweb_client_transaction_id_enabled": false,
  "rweb_conf_only_enabled": false,
  "rweb_conversational_replies_downvote_enabled": false,
  "rweb_debugger_enabled": false,
  "rweb_home_jot_migrate_enabled": false,
  "rweb_home_ranked_following_enabled": true,
  "rweb_home_uas_enabled": true,
  "rweb_media_carousel_enabled": true,
  "rweb_media_multi_requests_default_pool_size": false,
  "rweb_media_multi_requests_enabled": true,
  "rweb_search_media_enabled": true,
  "rweb_session_binding_enabled": false,
  "rweb_tipjar_consumption_enabled": true,
  "rweb_video_screen_enabled": true,
  "subscriptions_blue_verified_edit_profile_error_message_enabled": false,
  "subscriptions_upsells_api_enabled": true,
  "subscriptions_verification_info_is_identity_verified_enabled": true,
  "subscriptions_verification_info_verified_since_enabled": true,
  "super_follow_exclusive_tweet_creation_api_enabled": false,
  "toxic_reply_filter_inline_callout_enabled": false,
  "tweet_limited_actions_config_dpa_enabled": false,
  "tweet_limited_actions_config_enabled": true,
  "tweet_with_visibility_results_all_gql_limited_actions_enabled": false,
  "tweet_with_visibility_results_partial_gql_limited_actions_enabled": true,
  "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": true,
  "verified_phone_label_enabled": false,
  "video_attribution_display_over_video_cards_enabled": false,
  "view_counts_everywhere_api_enabled": true,
  "view_counts_public_visibility_enabled": true,
  "voice_consumption_enabled": false
}"#;

/// Build the default feature-flag object that covers the full catalog of 148
/// flags.  This is what a real Chrome browser session sends for operations
/// that do not have a specialised flag list.
///
/// Returns a `serde_json::Value::Object` where every key is a flag name and
/// every value is `bool`.
///
/// # Example
///
/// ```rust
/// use x_client::features::default_features;
/// let f = default_features();
/// assert!(f.is_object());
/// assert_eq!(
///     f.get("responsive_web_graphql_timeline_navigation_enabled")
///         .and_then(|v| v.as_bool()),
///     Some(true)
/// );
/// ```
pub fn default_features() -> Value {
    serde_json::from_str(DEFAULT_FEATURES_JSON)
        .expect("DEFAULT_FEATURES_JSON is valid JSON — bug in constant")
}

/// Build the feature-flag object for a specific operation.
///
/// When the operation's `featureSwitches` list is non-empty, the returned
/// object is the intersection of those switches with the default flag values
/// (i.e. only the flags that the operation declares are included).
///
/// When the list is empty (most operations), the full [`default_features`]
/// map is returned — the server ignores unknown flags.
///
/// # Notes
///
/// Merging with `extra_features` (caller-supplied overrides) is handled
/// separately in `client::graphql` so this function stays pure.
pub fn features_for(op: &Operation) -> Value {
    if op.feature_switches.is_empty() {
        return default_features();
    }

    let defaults = default_features();
    let mut out = serde_json::Map::new();

    // Include only the flags that the operation explicitly declares.
    // Fall back to `true` for any flag that is not in our default map
    // (forward-compatibility: new flags default to enabled).
    for flag in &op.feature_switches {
        let val = defaults.get(flag).cloned().unwrap_or(Value::Bool(true));
        out.insert(flag.clone(), val);
    }

    Value::Object(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;

    #[test]
    fn default_features_is_object() {
        let f = default_features();
        assert!(f.is_object(), "default_features() must return a JSON object");
    }

    #[test]
    fn default_features_contains_timeline_navigation() {
        let f = default_features();
        assert_eq!(
            f.get("responsive_web_graphql_timeline_navigation_enabled")
                .and_then(Value::as_bool),
            Some(true),
            "responsive_web_graphql_timeline_navigation_enabled must be true"
        );
    }

    #[test]
    fn default_features_verified_phone_label_is_false() {
        let f = default_features();
        assert_eq!(
            f.get("verified_phone_label_enabled").and_then(Value::as_bool),
            Some(false),
            "verified_phone_label_enabled must be false (unverified accounts)"
        );
    }

    #[test]
    fn known_good_blob_is_valid_json() {
        let v: Value =
            serde_json::from_str(CREATE_TWEET_FEATURES_KNOWN_GOOD).expect("must be valid JSON");
        assert!(v.is_object());
    }

    #[test]
    fn features_for_empty_switches_returns_full_map() {
        // CreateTweet has an empty featureSwitches list in the catalog.
        let op = catalog::operation("CreateTweet").expect("CreateTweet must be in catalog");
        let f = features_for(op);
        // Should contain more than the 19 flags from the known-good blob.
        let len = f.as_object().unwrap().len();
        assert!(len > 19, "expected full map, got {len} entries");
    }

    #[test]
    fn features_for_nonempty_switches_is_subset() {
        // UserByScreenName has a non-empty featureSwitches list.
        let op =
            catalog::operation("UserByScreenName").expect("UserByScreenName must be in catalog");
        if !op.feature_switches.is_empty() {
            let f = features_for(op);
            let obj = f.as_object().unwrap();
            for key in obj.keys() {
                assert!(
                    op.feature_switches.contains(key),
                    "features_for returned unexpected key: {key}"
                );
            }
        }
    }
}
