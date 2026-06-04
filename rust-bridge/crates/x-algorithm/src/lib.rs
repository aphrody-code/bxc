// SPDX-License-Identifier: Apache-2.0
//! x-algorithm — native Rust port of core X For You feed algorithm concepts.
//!
//! Adapted from https://github.com/xai-org/x-algorithm (Apache-2.0).
//! Commit snapshot: 0bfc2795d308f90032544322747caacd535f75ae (May 2026 release).
//!
//! We implement:
//! - The Candidate Pipeline idea (sources / filters / scorers / selector)
//! - Common pre-scoring filters (age, self, duplicates, blocked, muted keywords, ...)
//! - Weighted multi-action scorer (using available signals as P(engage) proxy)
//! - Author diversity attenuation
//! - In-network vs out-of-network handling
//!
//! The original Phoenix (Grok transformer retrieval + ranking with candidate isolation)
//! is not included (it requires the ~3 GB model + Python inference stack).
//! This crate gives a fast, portable, zero-dependency (beyond serde) local ranker
//! that can be applied to any list of posts fetched via the X client.
//!
//! FFI symbols are provided so the cdylib (bxc-rust-bridge) can expose
//! `bxc_x_algorithm_rank` for native consumers (MCP, external agents, etc).
//!
//! TS side (@aphrody/x) has a parallel pure-JS implementation for the high-level client.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Error type for the algorithm crate.
#[derive(Debug, Error)]
pub enum AlgoError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}
pub type Result<T> = std::result::Result<T, AlgoError>;

/// Minimal post candidate for ranking (enriched subset of what X client surfaces).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PostCandidate {
    pub id: String,
    pub author_id: String,
    pub author_handle: Option<String>,
    pub text: String,
    /// Unix seconds
    pub created_at: i64,
    pub like_count: u64,
    pub reply_count: u64,
    pub repost_count: u64,
    pub quote_count: u64,
    pub is_reply: bool,
    pub is_repost: bool,
    pub has_media: bool,
    /// If we know it came from followed accounts (Thunder / in-network)
    pub in_network: bool,
}

/// User / query context needed by the ranker (hydrated "query" in X algo terms).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RankingContext {
    /// The viewer (authenticated user)
    pub viewer_id: Option<String>,
    /// Authors the viewer follows (for in-network boost / social graph filters)
    pub followed_author_ids: Vec<String>,
    /// Recent authors from viewer's engagement history (likes, replies, reposts)
    pub recent_engagement_author_ids: Vec<String>,
    pub muted_keywords: Vec<String>,
    pub blocked_author_ids: Vec<String>,
    /// Current time for age filtering (unix seconds). If 0, uses now.
    pub now_unix: i64,
    /// Max age in seconds for AgeFilter (default 7 days)
    pub max_age_secs: Option<i64>,
}

/// Output of ranking: the post + final score + debug reasons.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredPost {
    pub post: PostCandidate,
    pub score: f64,
    /// Human-readable reasons why this score (for explainability / debugging)
    pub reasons: Vec<String>,
}

/// Run the simplified For You ranking pipeline over candidates.
///
/// Steps (inspired by home-mixer + candidate-pipeline):
/// 1. Hydrate defaults (now, etc.)
/// 2. Apply pre-scoring filters (kept only)
/// 3. Score with weighted + diversity
/// 4. Select top-K
pub fn rank_posts(
    mut candidates: Vec<PostCandidate>,
    context: &RankingContext,
    top_k: usize,
) -> Vec<ScoredPost> {
    if candidates.is_empty() {
        return vec![];
    }

    let ctx = hydrate_context(context);
    let k = if top_k == 0 { 20 } else { top_k };

    // 1. Filters (sequential, like the real pipeline)
    candidates = apply_filters(&ctx, candidates);

    // 2. Score
    let mut scored: Vec<ScoredPost> = candidates
        .into_iter()
        .map(|p| compute_score(&p, &ctx))
        .collect();

    // 3. Diversity pass (author attenuation, similar to Author Diversity Scorer)
    apply_author_diversity(&mut scored, &ctx);

    // 4. Sort desc by score, take top
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    scored
}

fn hydrate_context(ctx: &RankingContext) -> RankingContext {
    let mut c = ctx.clone();
    if c.now_unix <= 0 {
        c.now_unix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
    }
    if c.max_age_secs.is_none() {
        c.max_age_secs = Some(7 * 24 * 3600); // 7 days like many For You retentions
    }
    // de-dupe lists
    c.followed_author_ids.sort();
    c.followed_author_ids.dedup();
    c.recent_engagement_author_ids.sort();
    c.recent_engagement_author_ids.dedup();
    c.blocked_author_ids.sort();
    c.blocked_author_ids.dedup();
    c
}

fn apply_filters(ctx: &RankingContext, input: Vec<PostCandidate>) -> Vec<PostCandidate> {
    let mut kept = input;

    // DropDuplicatesFilter (by id)
    {
        let mut seen = std::collections::HashSet::new();
        kept.retain(|p| seen.insert(p.id.clone()));
    }

    // SelfpostFilter
    if let Some(vid) = &ctx.viewer_id {
        kept.retain(|p| &p.author_id != vid);
    }

    // AuthorSocialgraphFilter (blocked)
    {
        let blocked: std::collections::HashSet<_> = ctx.blocked_author_ids.iter().cloned().collect();
        kept.retain(|p| !blocked.contains(&p.author_id));
    }

    // MutedKeywordFilter (very simple contains)
    if !ctx.muted_keywords.is_empty() {
        let mutes = &ctx.muted_keywords;
        kept.retain(|p| {
            let t = p.text.to_lowercase();
            !mutes.iter().any(|kw| t.contains(&kw.to_lowercase()))
        });
    }

    // AgeFilter
    if let Some(max_age) = ctx.max_age_secs {
        kept.retain(|p| (ctx.now_unix - p.created_at).abs() <= max_age);
    }

    // Core "ineligible" heuristics (too low signal, very old already covered)
    // RepostDeduplication etc can be added later if we carry quote_of etc.

    kept
}

fn compute_score(post: &PostCandidate, ctx: &RankingContext) -> ScoredPost {
    let mut score = 0.0;
    let mut reasons = vec![];

    // Base engagement proxy (the real system predicts these via transformer;
    // we use observed counts as a transparent proxy + small priors)
    let like_w = 1.0;
    let reply_w = 3.0;
    let repost_w = 4.0;
    let quote_w = 2.5;

    let eng_score = (post.like_count as f64 * like_w)
        + (post.reply_count as f64 * reply_w)
        + (post.repost_count as f64 * repost_w)
        + (post.quote_count as f64 * quote_w);

    if eng_score > 0.0 {
        score += eng_score;
        reasons.push(format!("engagement:{:.1}", eng_score));
    }

    // In-network boost (Thunder source) — real system heavily weights followed accounts
    if post.in_network {
        score += 120.0;
        reasons.push("in_network:+120".into());
    } else if ctx
        .followed_author_ids
        .iter()
        .any(|id| id == &post.author_id)
    {
        score += 80.0;
        reasons.push("followed:+80".into());
    }

    // History affinity (user recently engaged with this author)
    if ctx
        .recent_engagement_author_ids
        .iter()
        .any(|id| id == &post.author_id)
    {
        score += 45.0;
        reasons.push("history_affinity:+45".into());
    }

    // Small freshness prior (recency within the window)
    let age_h = ((ctx.now_unix - post.created_at) as f64 / 3600.0).max(0.0);
    let freshness = (48.0 - age_h.min(48.0)) / 2.0; // up to +24 for <2h old
    if freshness > 0.5 {
        score += freshness;
        reasons.push(format!("freshness:{:.1}", freshness));
    }

    // Media / reply priors (real system learns these)
    if post.has_media {
        score += 8.0;
        reasons.push("media:+8".into());
    }
    if post.is_reply {
        score -= 5.0; // slight penalty vs original in many For You tunings
        reasons.push("reply:-5".into());
    }

    // Small length prior (avoid pure spam short posts unless high eng)
    if post.text.len() > 40 {
        score += 3.0;
    }

    ScoredPost {
        post: post.clone(),
        score: score.max(0.0),
        reasons,
    }
}

/// Attenuate repeated authors (Author Diversity Scorer).
/// After initial scoring we penalize additional posts from the same author.
fn apply_author_diversity(scored: &mut [ScoredPost], _ctx: &RankingContext) {
    use std::collections::HashMap;
    let mut author_count: HashMap<String, usize> = HashMap::new();

    for sp in scored.iter_mut() {
        let cnt = author_count.entry(sp.post.author_id.clone()).or_insert(0);
        if *cnt > 0 {
            // Progressive penalty (real system uses more sophisticated attenuation)
            let penalty = 35.0 * (*cnt as f64);
            sp.score = (sp.score - penalty).max(0.0);
            sp.reasons.push(format!("diversity_penalty:-{:.0}", penalty));
        }
        *cnt += 1;
    }
}

/// Convenience: rank from JSON strings (used by FFI).
pub fn rank_posts_json(
    candidates_json: &str,
    context_json: &str,
    top_k: u32,
) -> Result<String> {
    let cands: Vec<PostCandidate> = serde_json::from_str(candidates_json)?;
    let ctx: RankingContext = if context_json.trim().is_empty() {
        RankingContext::default()
    } else {
        serde_json::from_str(context_json)?
    };
    let out = rank_posts(cands, &ctx, top_k as usize);
    Ok(serde_json::to_string(&out)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_rank_filters_and_scores() {
        let now = 1_700_000_000i64;
        let posts = vec![
            PostCandidate {
                id: "1".into(),
                author_id: "a1".into(),
                author_handle: Some("elon".into()),
                text: "hello world this is a post with media".into(),
                created_at: now - 3600,
                like_count: 1200,
                reply_count: 80,
                repost_count: 300,
                quote_count: 40,
                is_reply: false,
                is_repost: false,
                has_media: true,
                in_network: true,
            },
            PostCandidate {
                id: "2".into(),
                author_id: "a2".into(),
                author_handle: None,
                text: "short".into(),
                created_at: now - 100000,
                like_count: 5,
                reply_count: 0,
                repost_count: 0,
                quote_count: 0,
                is_reply: false,
                is_repost: false,
                has_media: false,
                in_network: false,
            },
        ];
        let ctx = RankingContext {
            viewer_id: Some("viewer".into()),
            followed_author_ids: vec!["a1".into()],
            now_unix: now,
            ..Default::default()
        };
        let ranked = rank_posts(posts, &ctx, 10);
        assert_eq!(ranked.len(), 2);
        assert!(ranked[0].score > ranked[1].score);
        assert!(ranked[0].reasons.iter().any(|r| r.contains("in_network")));
    }
}
