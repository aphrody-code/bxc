// SPDX-License-Identifier: Apache-2.0
//! News & trending topics from X's Explore tabs.
//!
//! Each Explore tab (For You / News / Sports / Entertainment / Trending) is a
//! `GenericTimelineById` query keyed by a fixed base64 timeline id. This module
//! fetches the requested tabs, parses trend/news items out of the timeline
//! tree, deduplicates headlines across tabs, and optionally keeps only
//! AI-curated news (full-sentence headlines with a News social-context).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{Result, XClient};

/// Fixed Explore-tab timeline ids (base64, stable across builds).
const TAB_FOR_YOU: &str = "VGltZWxpbmU6DAC2CwABAAAAB2Zvcl95b3UAAA==";
const TAB_TRENDING: &str = "VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=";
const TAB_NEWS: &str = "VGltZWxpbmU6DAC2CwABAAAABG5ld3MAAA==";
const TAB_SPORTS: &str = "VGltZWxpbmU6DAC2CwABAAAABnNwb3J0cwAA";
const TAB_ENTERTAINMENT: &str = "VGltZWxpbmU6DAC2CwABAAAADWVudGVydGFpbm1lbnQAAA==";

/// Resolve a tab name to its timeline id.
fn tab_timeline_id(tab: &str) -> Option<&'static str> {
    match tab {
        "forYou" | "for-you" | "for_you" => Some(TAB_FOR_YOU),
        "trending" => Some(TAB_TRENDING),
        "news" => Some(TAB_NEWS),
        "sports" => Some(TAB_SPORTS),
        "entertainment" => Some(TAB_ENTERTAINMENT),
        _ => None,
    }
}

/// Options for [`XClient::get_news`].
#[derive(Debug, Clone)]
pub struct NewsOptions {
    /// Tab names to fetch (default: forYou, news, sports, entertainment).
    pub tabs: Vec<String>,
    /// Keep only AI-curated news items.
    pub ai_only: bool,
}

impl Default for NewsOptions {
    fn default() -> Self {
        Self {
            tabs: ["forYou", "news", "sports", "entertainment"]
                .iter()
                .map(|s| (*s).to_owned())
                .collect(),
            ai_only: false,
        }
    }
}

/// A single news / trend item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsItem {
    /// Stable identifier (trend url or derived from entry + headline).
    pub id: String,
    /// Headline or trend title.
    pub headline: String,
    /// Category label (e.g. "AI · Technology", "Trending").
    pub category: String,
    /// Relative time (e.g. "2h ago").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_ago: Option<String>,
    /// Number of posts, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_count: Option<u64>,
    /// Item description, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// URL to the trend / article, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Parse a `K`/`M`/`B`-suffixed post count like "12.3K posts".
fn parse_post_count(s: &str) -> Option<u64> {
    let lower = s.to_lowercase();
    let idx = lower.find("post")?;
    let head = &s[..idx];
    let num_str: String = head
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || c.is_whitespace() || matches!(c, 'k' | 'K' | 'm' | 'M' | 'b' | 'B'))
        .collect();
    let token = num_str.split_whitespace().next_back()?;
    let (digits, mult): (&str, f64) = if let Some(d) = token.strip_suffix(['k', 'K']) {
        (d, 1_000.0)
    } else if let Some(d) = token.strip_suffix(['m', 'M']) {
        (d, 1_000_000.0)
    } else if let Some(d) = token.strip_suffix(['b', 'B']) {
        (d, 1_000_000_000.0)
    } else {
        (token, 1.0)
    };
    let value: f64 = digits.parse().ok()?;
    Some((value * mult).round() as u64)
}

/// Parse one `itemContent` node into a [`NewsItem`], applying the AI filter.
fn parse_news_item(item_content: &Value, entry_id: &str, source: &str, ai_only: bool) -> Option<NewsItem> {
    let headline = item_content
        .get("name")
        .or_else(|| item_content.get("title"))
        .and_then(Value::as_str)?
        .to_owned();
    if headline.is_empty() {
        return None;
    }

    let trend_metadata = item_content.get("trend_metadata");
    let trend_url = item_content
        .pointer("/trend_url/url")
        .and_then(Value::as_str)
        .or_else(|| trend_metadata.and_then(|m| m.pointer("/url/url")).and_then(Value::as_str))
        .map(ToOwned::to_owned);

    let social_context = item_content
        .pointer("/social_context/text")
        .and_then(Value::as_str)
        .unwrap_or("");
    let has_news_category =
        social_context.contains("News") || social_context.contains("hours ago");
    let is_full_sentence = headline.split_whitespace().count() >= 5;
    let is_explicit_ai = item_content
        .get("is_ai_trend")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let is_ai_news = is_explicit_ai || (is_full_sentence && has_news_category);

    if ai_only && !is_ai_news {
        return None;
    }

    let mut category = "Trending".to_owned();
    let mut time_ago = None;
    let mut post_count = None;

    if !social_context.is_empty() {
        for part in social_context.split('·').map(str::trim) {
            if part.contains("ago") {
                time_ago = Some(part.to_owned());
            } else if part.to_lowercase().contains("post") {
                post_count = parse_post_count(part);
            } else if !part.is_empty() {
                category = part.to_owned();
            }
        }
    }

    if let Some(meta) = trend_metadata.and_then(|m| m.get("meta_description")).and_then(Value::as_str)
        && let Some(pc) = parse_post_count(meta)
    {
        post_count = Some(pc);
    }
    if let Some(domain) = trend_metadata.and_then(|m| m.get("domain_context")).and_then(Value::as_str)
        && (category == "Trending" || category == "News")
    {
        category = domain.to_owned();
    }

    let id = trend_url
        .clone()
        .unwrap_or_else(|| format!("{entry_id}-{headline}").replace(' ', "_"));
    let category = if is_ai_news {
        format!("AI · {category}")
    } else {
        category
    };
    let _ = source;

    Some(NewsItem {
        id,
        headline,
        category,
        time_ago,
        post_count,
        description: item_content
            .get("description")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        url: trend_url,
    })
}

impl XClient {
    /// Fetch news / trending items from the requested Explore tabs.
    ///
    /// Returns up to `count` deduplicated items in tab order.
    pub async fn get_news(&self, count: usize, options: &NewsOptions) -> Result<Vec<NewsItem>> {
        let mut items: Vec<NewsItem> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        for tab in &options.tabs {
            let Some(timeline_id) = tab_timeline_id(tab) else {
                continue;
            };
            let variables = json!({
                "timelineId": timeline_id,
                "count": (count * 2) as u64,
                "includePromotedContent": false
            });
            let json = match self.graphql("GenericTimelineById", variables, None).await {
                Ok(v) => v,
                Err(e) => {
                    if std::env::var("APHRODY_X_DEBUG").is_ok() {
                        eprintln!("[news] tab {tab} graphql error: {e}");
                    }
                    continue; // a failing tab must not abort the rest
                }
            };

            let parsed = parse_tab_items(&json, tab, count, options.ai_only);
            if std::env::var("APHRODY_X_DEBUG").is_ok() {
                eprintln!("[news] tab {tab}: parsed {} items", parsed.len());
            }
            for it in parsed {
                if seen.insert(it.headline.clone()) {
                    items.push(it);
                }
            }
            if items.len() >= count {
                break;
            }
        }

        items.truncate(count);
        if std::env::var("APHRODY_X_DEBUG").is_ok() {
            eprintln!("[news] returning {} items", items.len());
        }
        Ok(items)
    }
}

/// Parse all news items from a `GenericTimelineById` response.
fn parse_tab_items(data: &Value, source: &str, max_count: usize, ai_only: bool) -> Vec<NewsItem> {
    let mut items = Vec::new();
    let Some(instructions) = data
        .pointer("/data/timeline/timeline/instructions")
        .and_then(Value::as_array)
    else {
        return items;
    };

    for instruction in instructions {
        let entries: Vec<&Value> = if let Some(arr) = instruction.get("entries").and_then(Value::as_array) {
            arr.iter().collect()
        } else if let Some(entry) = instruction.get("entry") {
            vec![entry]
        } else {
            continue;
        };

        for entry in entries {
            if items.len() >= max_count {
                return items;
            }
            let entry_id = entry.get("entryId").and_then(Value::as_str).unwrap_or("");
            let Some(content) = entry.get("content") else {
                continue;
            };

            // Single trend item.
            if let Some(ic) = content.get("itemContent")
                && let Some(item) = parse_news_item(ic, entry_id, source, ai_only)
            {
                items.push(item);
            }

            // Module of items.
            if let Some(arr) = content.get("items").and_then(Value::as_array) {
                for data in arr {
                    if items.len() >= max_count {
                        return items;
                    }
                    let ic = data
                        .get("itemContent")
                        .or_else(|| data.pointer("/item/itemContent"));
                    if let Some(ic) = ic
                        && let Some(item) = parse_news_item(ic, entry_id, source, ai_only)
                    {
                        items.push(item);
                    }
                }
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_post_counts() {
        assert_eq!(parse_post_count("12.3K posts"), Some(12_300));
        assert_eq!(parse_post_count("5M posts"), Some(5_000_000));
        assert_eq!(parse_post_count("42 posts"), Some(42));
        assert_eq!(parse_post_count("no number here"), None);
    }

    #[test]
    fn tab_ids_resolve() {
        assert!(tab_timeline_id("news").is_some());
        assert!(tab_timeline_id("forYou").is_some());
        assert!(tab_timeline_id("nonsense").is_none());
    }

    #[test]
    fn parses_trend_item_with_social_context() {
        let ic = json!({
            "name": "Gemini Omni",
            "social_context": { "text": "Technology · 45.2K posts" },
            "trend_url": { "url": "https://x.com/search?q=Gemini" }
        });
        let item = parse_news_item(&ic, "trend-1", "news", false).expect("must parse");
        assert_eq!(item.headline, "Gemini Omni");
        assert_eq!(item.category, "Technology");
        assert_eq!(item.post_count, Some(45_200));
        assert_eq!(item.url.as_deref(), Some("https://x.com/search?q=Gemini"));
    }

    #[test]
    fn ai_only_filters_non_ai() {
        let plain = json!({ "name": "Lakers" });
        assert!(parse_news_item(&plain, "e", "sports", true).is_none());

        let ai = json!({
            "name": "OpenAI announces a major new reasoning model today",
            "social_context": { "text": "News · 2 hours ago" }
        });
        let item = parse_news_item(&ai, "e", "news", true).expect("ai item kept");
        assert!(item.category.starts_with("AI ·"));
    }
}
