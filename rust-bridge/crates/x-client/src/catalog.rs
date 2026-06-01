// SPDX-License-Identifier: Apache-2.0
//! Embedded GraphQL operation catalog extracted from X's main JS bundle.
//!
//! The catalog is parsed once at first access via [`OnceLock`] and then
//! remains resident for the lifetime of the process.  All accessors return
//! `&'static` references so callers never pay an allocation cost.
//!
//! # Catalog source
//!
//! The JSON file `data/x-graphql-catalog.json` was extracted live from X's
//! `main.<hash>.js` bundle.  It contains the current `queryId` for each of
//! the 158 known GraphQL operations.  Re-run the extraction script when X
//! deploys a new bundle and `queryId` values start returning HTTP 404.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

/// The raw catalog JSON, embedded at compile time.
///
/// Embedding avoids runtime file-system lookups and ensures the binary is
/// fully self-contained.
pub static CATALOG_JSON: &str = include_str!("../data/x-graphql-catalog.json");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Whether the operation reads or writes server state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OpType {
    /// A read-only GraphQL query (HTTP GET with query-string parameters).
    Query,
    /// A state-changing GraphQL mutation (HTTP POST with JSON body).
    Mutation,
    /// A long-lived GraphQL subscription (not currently used by the web client
    /// for most operations, included for completeness).
    Subscription,
}

impl OpType {
    /// Returns `true` for [`OpType::Query`].
    pub fn is_query(self) -> bool {
        matches!(self, Self::Query)
    }

    /// Returns `true` for [`OpType::Mutation`].
    pub fn is_mutation(self) -> bool {
        matches!(self, Self::Mutation)
    }
}

/// A single operation from the X GraphQL catalog.
#[derive(Debug, Clone)]
pub struct Operation {
    /// Operation name as it appears in the X bundle (e.g. `"CreateTweet"`).
    pub name: String,
    /// The `queryId` path segment used in the GraphQL URL.
    pub query_id: String,
    /// Whether this is a query, mutation, or subscription.
    pub op_type: OpType,
    /// Feature-switch names that X's server checks for this operation.
    pub feature_switches: Vec<String>,
}

// ---------------------------------------------------------------------------
// Internal serde shapes (mirrors the JSON structure exactly)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogJson {
    operations: HashMap<String, OperationJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationJson {
    query_id: String,
    operation_type: String,
    #[serde(default)]
    feature_switches: Vec<String>,
}

// ---------------------------------------------------------------------------
// Parse-once global
// ---------------------------------------------------------------------------

static CATALOG: OnceLock<HashMap<String, Operation>> = OnceLock::new();

/// Return a reference to the global parsed catalog, initialising it on first
/// call.
///
/// Parsing is O(n) in the number of operations (158) and happens at most once
/// per process.
fn catalog() -> &'static HashMap<String, Operation> {
    CATALOG.get_or_init(|| {
        let raw: CatalogJson =
            serde_json::from_str(CATALOG_JSON).expect("x-graphql-catalog.json is valid JSON");

        raw.operations
            .into_iter()
            .map(|(name, op)| {
                let op_type = match op.operation_type.to_lowercase().as_str() {
                    "mutation" => OpType::Mutation,
                    "subscription" => OpType::Subscription,
                    _ => OpType::Query,
                };
                let operation = Operation {
                    name: name.clone(),
                    query_id: op.query_id,
                    op_type,
                    feature_switches: op.feature_switches,
                };
                (name, operation)
            })
            .collect()
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Look up a single operation by its exact name (case-sensitive).
///
/// Returns `None` when the name is not present in the catalog.
///
/// # Example
///
/// ```rust
/// use x_client::catalog::{operation, OpType};
///
/// let op = operation("CreateTweet").expect("CreateTweet must be in catalog");
/// assert_eq!(op.query_id, "H-t2v_HvFR07ZBP9aOeKoA");
/// assert!(op.op_type.is_mutation());
/// ```
pub fn operation(name: &str) -> Option<&'static Operation> {
    catalog().get(name)
}

/// Return all operations in the catalog (order is unspecified).
///
/// # Example
///
/// ```rust
/// use x_client::catalog::all;
/// assert_eq!(all().len(), 158);
/// ```
pub fn all() -> Vec<&'static Operation> {
    catalog().values().collect()
}

/// Return only mutation operations.
pub fn mutations() -> Vec<&'static Operation> {
    catalog()
        .values()
        .filter(|op| op.op_type.is_mutation())
        .collect()
}

/// Return only query operations.
pub fn queries() -> Vec<&'static Operation> {
    catalog()
        .values()
        .filter(|op| op.op_type.is_query())
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_parses_and_count_is_158() {
        assert_eq!(all().len(), 158, "catalog must contain exactly 158 operations");
    }

    #[test]
    fn create_tweet_query_id_and_type() {
        let op = operation("CreateTweet").expect("CreateTweet must be in catalog");
        assert_eq!(
            op.query_id, "H-t2v_HvFR07ZBP9aOeKoA",
            "CreateTweet queryId must match live-extracted value"
        );
        assert_eq!(
            op.op_type,
            OpType::Mutation,
            "CreateTweet must be a Mutation"
        );
    }

    #[test]
    fn user_by_screen_name_is_query() {
        let op = operation("UserByScreenName").expect("UserByScreenName must be in catalog");
        assert_eq!(op.op_type, OpType::Query);
    }

    #[test]
    fn mutations_filter_excludes_queries() {
        for op in mutations() {
            assert!(op.op_type.is_mutation(), "{} must be mutation", op.name);
        }
    }

    #[test]
    fn queries_filter_excludes_mutations() {
        for op in queries() {
            assert!(op.op_type.is_query(), "{} must be query", op.name);
        }
    }

    #[test]
    fn operation_returns_none_for_unknown() {
        assert!(operation("__NonExistentOperation__").is_none());
    }

    #[test]
    fn all_operations_have_non_empty_query_ids() {
        for op in all() {
            assert!(!op.query_id.is_empty(), "{} has empty queryId", op.name);
        }
    }

    #[test]
    fn create_tweet_feature_switches_accessible() {
        let op = operation("CreateTweet").expect("CreateTweet must be in catalog");
        // CreateTweet may have an empty featureSwitches list — we just verify
        // the field is accessible (Vec, possibly empty).
        let _ = &op.feature_switches;
    }

    #[test]
    fn known_ops_have_correct_query_ids() {
        let cases = [
            ("DeleteTweet", "nxpZCY2K-I6QoFHAHeojFQ"),
            ("FavoriteTweet", "lI07N6Otwv1PhnEgXILM7A"),
            ("UnfavoriteTweet", "ZYKSe-w7KEslx3JhSIk5LA"),
            ("CreateRetweet", "mbRO74GrOvSfRcJnlMapnQ"),
            ("DeleteRetweet", "ZyZigVsNiFO6v1dEks1eWg"),
            ("UserByScreenName", "IGgvgiOx4QZndDHuD3x9TQ"),
            ("HomeTimeline", "Ly0idwoXvMotg0ArhGnnow"),
            ("CreateBookmark", "aoDbu3RHznuiSkQ9aNM67Q"),
            ("DeleteBookmark", "Wlmlj2-xzyS1GN3a6cj-mQ"),
            ("PinTweet", "VIHsNu89pK-kW35JpHq7Xw"),
            ("UnpinTweet", "BhKei844ypCyLYCg0nwigw"),
            ("CreateNoteTweet", "yeInFtqpUoABoBE_YWPYgA"),
        ];
        for (name, expected_qid) in cases {
            let op = operation(name).unwrap_or_else(|| panic!("{name} must be in catalog"));
            assert_eq!(
                op.query_id, expected_qid,
                "{name}: queryId mismatch (catalog updated?)"
            );
        }
    }
}
