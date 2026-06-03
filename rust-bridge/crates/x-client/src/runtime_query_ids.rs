// SPDX-License-Identifier: Apache-2.0
//! Runtime GraphQL `queryId` discovery and on-disk cache.
//!
//! X rotates the `queryId` path segment of every GraphQL operation whenever it
//! ships a new web client bundle. The embedded [`crate::catalog`] is a snapshot
//! that goes stale; this module keeps the client working across rotations by
//! scraping the *live* `queryId` values straight out of X's public web bundles
//! and caching them on disk.
//!
//! Pipeline (mirrors the reference `@steipete/bird` implementation, extended to
//! be cross-platform):
//!
//! 1. Fetch a handful of public discovery pages (`x.com/?lang=en`, `/explore`,
//!    …) and regex out every `abs.twimg.com/responsive-web/client-web/*.js`
//!    bundle URL referenced in the HTML.
//! 2. Fetch those bundles concurrently and run a set of regex patterns to pull
//!    `{ operationName, queryId }` pairs.
//! 3. Persist the resolved ids to a JSON snapshot under the user config dir
//!    (`~/.config/aphrody/x/query-ids-cache.json` on Linux, the platform
//!    equivalent elsewhere) with a 24h freshness TTL. A stale snapshot is still
//!    used (it just is not "fresh"); only a successful refresh overwrites it.
//!
//! Resolution order at call sites: runtime cache → embedded catalog. So a
//! `queryId` rotation needs only a cache refresh, never a recompile.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::task::JoinSet;

use crate::{Result, XError};

/// Public discovery pages that reference the client-web bundles.
pub const DISCOVERY_PAGES: &[&str] = crate::surface::DISCOVERY_PAGES;

/// Default freshness window: 24 hours.
const DEFAULT_TTL_SECS: u64 = 24 * 60 * 60;

/// Concurrency for bundle fetches.
const FETCH_CONCURRENCY: usize = 6;

/// Browser-like headers for public bundle/HTML fetches (no auth needed).
const DISCOVERY_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/// On-disk snapshot of resolved query ids.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    /// Unix epoch second at which this snapshot was written.
    pub fetched_at: i64,
    /// Freshness window in seconds.
    pub ttl_secs: u64,
    /// `operationName -> queryId`.
    pub ids: HashMap<String, String>,
    /// Bundle file names the ids were sourced from (diagnostics only).
    #[serde(default)]
    pub bundles: Vec<String>,
}

impl Snapshot {
    /// Age in seconds relative to now (saturating at 0).
    pub fn age_secs(&self) -> i64 {
        now_epoch().saturating_sub(self.fetched_at).max(0)
    }

    /// Whether the snapshot is within its freshness window.
    pub fn is_fresh(&self) -> bool {
        (self.age_secs() as u64) <= self.ttl_secs
    }
}

/// Lazily-loaded, disk-backed query-id store.
#[derive(Debug)]
pub struct QueryIdStore {
    cache_path: PathBuf,
    ttl_secs: u64,
    mem: Mutex<Option<Snapshot>>,
    loaded: Mutex<bool>,
}

impl Default for QueryIdStore {
    fn default() -> Self {
        Self::new(default_cache_path(), DEFAULT_TTL_SECS)
    }
}

impl QueryIdStore {
    /// Construct a store with an explicit cache path and TTL.
    pub fn new(cache_path: PathBuf, ttl_secs: u64) -> Self {
        Self {
            cache_path,
            ttl_secs,
            mem: Mutex::new(None),
            loaded: Mutex::new(false),
        }
    }

    /// The resolved cache file path.
    pub fn cache_path(&self) -> &PathBuf {
        &self.cache_path
    }

    /// Load the snapshot from disk into memory once.
    fn ensure_loaded(&self) {
        let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
        if *loaded {
            return;
        }
        *loaded = true;
        if let Ok(raw) = std::fs::read_to_string(&self.cache_path)
            && let Ok(snap) = serde_json::from_str::<Snapshot>(&raw)
        {
            *self.mem.lock().unwrap_or_else(|e| e.into_inner()) = Some(snap);
        }
    }

    /// Return the current in-memory snapshot (loading from disk on first call).
    pub fn snapshot(&self) -> Option<Snapshot> {
        self.ensure_loaded();
        self.mem.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Resolve a single `queryId` from the cache, or `None` if unknown/missing.
    pub fn get(&self, operation: &str) -> Option<String> {
        self.snapshot()
            .and_then(|s| s.ids.get(operation).cloned())
    }

    /// Refresh the cache for the given target operations.
    ///
    /// When `force` is false and the existing snapshot is still fresh, this is
    /// a no-op. Network/parse failures are surfaced as [`XError`]; a partial
    /// result (some ids found) is still persisted and considered success.
    ///
    /// Discovery uses a dedicated unauthenticated, browser-like HTTP client:
    /// the bundle URLs only appear in the logged-out HTML shell, so sending the
    /// authenticated client's bearer/cookie/`application/json` headers makes
    /// x.com return a different document with no `<script>` bundle references.
    pub async fn refresh(&self, targets: &[&str], force: bool) -> Result<Snapshot> {
        if !force
            && let Some(snap) = self.snapshot()
            && snap.is_fresh()
        {
            return Ok(snap);
        }

        let client = discovery_client()?;
        let target_set: HashSet<String> = targets.iter().map(|s| (*s).to_owned()).collect();
        let bundle_urls = discover_bundles(&client).await?;
        let discovered = fetch_and_extract(&client, &bundle_urls, &target_set).await;

        if discovered.is_empty() {
            // Keep the old snapshot rather than clobbering it with nothing.
            if let Some(snap) = self.snapshot() {
                return Ok(snap);
            }
            return Err(XError::Auth(
                "queryId refresh found no operations; x.com layout may have changed".into(),
            ));
        }

        let mut ids = HashMap::new();
        for name in targets {
            if let Some(qid) = discovered.get(*name) {
                ids.insert((*name).to_owned(), qid.clone());
            }
        }

        let snapshot = Snapshot {
            fetched_at: now_epoch(),
            ttl_secs: self.ttl_secs,
            ids,
            bundles: bundle_urls
                .iter()
                .map(|u| u.rsplit('/').next().unwrap_or(u).to_owned())
                .collect(),
        };

        self.write_to_disk(&snapshot)?;
        *self.mem.lock().unwrap_or_else(|e| e.into_inner()) = Some(snapshot.clone());
        Ok(snapshot)
    }

    fn write_to_disk(&self, snapshot: &Snapshot) -> Result<()> {
        if let Some(parent) = self.cache_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(snapshot)?;
        std::fs::write(&self.cache_path, format!("{json}\n"))?;
        Ok(())
    }

    /// Drop the in-memory snapshot so the next access re-reads from disk.
    pub fn clear_memory(&self) {
        *self.mem.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.loaded.lock().unwrap_or_else(|e| e.into_inner()) = false;
    }
}

/// Default cross-platform cache path: `<config>/aphrody/x/query-ids-cache.json`.
///
/// Honors the `APHRODY_X_QUERY_IDS_CACHE` env override.
pub fn default_cache_path() -> PathBuf {
    if let Ok(p) = std::env::var("APHRODY_X_QUERY_IDS_CACHE") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("aphrody").join("x").join("query-ids-cache.json")
}

/// Build a clean, unauthenticated HTTP client for bundle discovery.
///
/// Deliberately carries no auth/cookie/json headers — only a browser UA — so
/// x.com serves the logged-out HTML shell that references the JS bundles.
pub fn discovery_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(DISCOVERY_UA)
        .build()
        .map_err(XError::Http)
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String> {
    let resp = client
        .get(url)
        .header("user-agent", DISCOVERY_UA)
        .header("accept", "text/html,application/json;q=0.9,*/*;q=0.8")
        .header("accept-language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(20))
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(XError::Api {
            code: resp.status().as_u16().into(),
            message: format!("HTTP {} fetching {url}", resp.status()),
        });
    }
    Ok(resp.text().await?)
}

/// Public wrapper for catalog sync and diagnostics.
pub async fn discover_bundles_public(client: &reqwest::Client) -> Result<Vec<String>> {
    discover_bundles(client).await
}

/// Extract every operation/queryId pair from bundles (full catalog sync).
pub async fn fetch_and_extract_all(
    client: &reqwest::Client,
    bundle_urls: &[String],
) -> HashMap<String, String> {
    let patterns = operation_patterns();
    let mut discovered: HashMap<String, String> = HashMap::new();

    for chunk in bundle_urls.chunks(FETCH_CONCURRENCY) {
        let mut set: JoinSet<Option<String>> = JoinSet::new();
        for url in chunk {
            let client = client.clone();
            let url = url.clone();
            set.spawn(async move { fetch_text(&client, &url).await.ok() });
        }
        while let Some(joined) = set.join_next().await {
            if let Ok(Some(js)) = joined {
                for (re, op_group, qid_group) in &patterns {
                    for caps in re.captures_iter(&js) {
                        let (Some(op), Some(qid)) = (caps.get(*op_group), caps.get(*qid_group))
                        else {
                            continue;
                        };
                        let op = op.as_str();
                        let qid = qid.as_str();
                        if !valid_query_id(qid) || discovered.contains_key(op) {
                            continue;
                        }
                        discovered.insert(op.to_owned(), qid.to_owned());
                    }
                }
            }
        }
    }
    discovered
}

/// Scrape every client-web bundle URL referenced by the discovery pages.
async fn discover_bundles(client: &reqwest::Client) -> Result<Vec<String>> {
    let bundle_re =
        Regex::new(r"https://abs\.twimg\.com/responsive-web/client-web(?:-legacy)?/[A-Za-z0-9.\-]+\.js")
            .expect("static bundle regex is valid");

    let mut bundles: HashSet<String> = HashSet::new();
    for page in DISCOVERY_PAGES {
        if let Ok(html) = fetch_text(client, page).await {
            for m in bundle_re.find_iter(&html) {
                bundles.insert(m.as_str().to_owned());
            }
        }
    }

    if bundles.is_empty() {
        return Err(XError::Auth(
            "no client bundles discovered; x.com layout may have changed".into(),
        ));
    }
    Ok(bundles.into_iter().collect())
}

/// The operation/queryId regex patterns, tried in order. Mirrors bird's set.
fn operation_patterns() -> Vec<(Regex, usize, usize)> {
    // (regex, operation_capture_group, query_id_capture_group)
    vec![
        (
            Regex::new(
                r#"(?s)\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']"#,
            )
            .unwrap(),
            2,
            1,
        ),
        (
            Regex::new(
                r#"(?s)\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']"#,
            )
            .unwrap(),
            1,
            2,
        ),
        (
            Regex::new(
                r#"(?s)operationName\s*[:=]\s*["']([^"']+)["'].{0,4000}?queryId\s*[:=]\s*["']([^"']+)["']"#,
            )
            .unwrap(),
            1,
            2,
        ),
        (
            Regex::new(
                r#"(?s)queryId\s*[:=]\s*["']([^"']+)["'].{0,4000}?operationName\s*[:=]\s*["']([^"']+)["']"#,
            )
            .unwrap(),
            2,
            1,
        ),
    ]
}

fn valid_query_id(qid: &str) -> bool {
    !qid.is_empty()
        && qid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Extract `{operationName: queryId}` for the requested targets from one bundle.
fn extract_operations(
    bundle: &str,
    targets: &HashSet<String>,
    out: &mut HashMap<String, String>,
    patterns: &[(Regex, usize, usize)],
) {
    for (re, op_group, qid_group) in patterns {
        for caps in re.captures_iter(bundle) {
            let (Some(op), Some(qid)) = (caps.get(*op_group), caps.get(*qid_group)) else {
                continue;
            };
            let op = op.as_str();
            let qid = qid.as_str();
            if !targets.contains(op) || out.contains_key(op) || !valid_query_id(qid) {
                continue;
            }
            out.insert(op.to_owned(), qid.to_owned());
            if out.len() == targets.len() {
                return;
            }
        }
    }
}

/// Fetch bundles concurrently and accumulate discovered ids until all targets
/// are found or the bundle list is exhausted.
async fn fetch_and_extract(
    client: &reqwest::Client,
    bundle_urls: &[String],
    targets: &HashSet<String>,
) -> HashMap<String, String> {
    let patterns = operation_patterns();
    let mut discovered: HashMap<String, String> = HashMap::new();

    for chunk in bundle_urls.chunks(FETCH_CONCURRENCY) {
        if discovered.len() == targets.len() {
            break;
        }
        let mut set: JoinSet<Option<String>> = JoinSet::new();
        for url in chunk {
            let client = client.clone();
            let url = url.clone();
            set.spawn(async move { fetch_text(&client, &url).await.ok() });
        }
        while let Some(joined) = set.join_next().await {
            if let Ok(Some(js)) = joined {
                extract_operations(&js, targets, &mut discovered, &patterns);
            }
        }
    }
    discovered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_query_id_accepts_typical_ids() {
        assert!(valid_query_id("H-t2v_HvFR07ZBP9aOeKoA"));
        assert!(valid_query_id("nxpZCY2K-I6QoFHAHeojFQ"));
    }

    #[test]
    fn valid_query_id_rejects_bad_chars() {
        assert!(!valid_query_id(""));
        assert!(!valid_query_id("has space"));
        assert!(!valid_query_id("has/slash"));
        assert!(!valid_query_id("has\"quote"));
    }

    #[test]
    fn extract_operations_pulls_pairs() {
        // Mimic the consolidated descriptor shape in X's bundles.
        let bundle = r#"
            x.exports={queryId:"AAA111",operationName:"CreateTweet"};
            y.exports={operationName:"DeleteTweet",queryId:"BBB222"};
            something operationName:"FavoriteTweet" filler queryId:"CCC333";
        "#;
        let targets: HashSet<String> = ["CreateTweet", "DeleteTweet", "FavoriteTweet"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let mut out = HashMap::new();
        extract_operations(bundle, &targets, &mut out, &operation_patterns());
        assert_eq!(out.get("CreateTweet").map(String::as_str), Some("AAA111"));
        assert_eq!(out.get("DeleteTweet").map(String::as_str), Some("BBB222"));
        assert_eq!(out.get("FavoriteTweet").map(String::as_str), Some("CCC333"));
    }

    #[test]
    fn snapshot_freshness() {
        let mut s = Snapshot {
            fetched_at: now_epoch(),
            ttl_secs: 100,
            ids: HashMap::new(),
            bundles: vec![],
        };
        assert!(s.is_fresh());
        s.fetched_at = now_epoch() - 200;
        assert!(!s.is_fresh());
    }

    #[test]
    fn store_roundtrips_disk() {
        let dir = std::env::temp_dir().join(format!("aphx-qid-{}", uuid::Uuid::new_v4()));
        let path = dir.join("cache.json");
        let store = QueryIdStore::new(path.clone(), 3600);
        let snap = Snapshot {
            fetched_at: now_epoch(),
            ttl_secs: 3600,
            ids: HashMap::from([("CreateTweet".to_string(), "ZZZ".to_string())]),
            bundles: vec!["main.abc.js".into()],
        };
        store.write_to_disk(&snap).unwrap();
        store.clear_memory();
        assert_eq!(store.get("CreateTweet").as_deref(), Some("ZZZ"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_cache_path_has_expected_suffix() {
        let p = default_cache_path();
        assert!(p.ends_with("query-ids-cache.json"));
    }
}
