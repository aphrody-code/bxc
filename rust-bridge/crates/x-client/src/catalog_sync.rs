// SPDX-License-Identifier: Apache-2.0
//! Merge live bundle queryIds into `data/x-graphql-catalog.json`.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::runtime_query_ids::{discover_bundles_public, discovery_client, fetch_and_extract_all};
use crate::Result;

#[derive(Debug, Serialize)]
pub struct SyncReport {
    pub catalog_path: String,
    pub live_ops: usize,
    pub catalog_ops: usize,
    pub query_ids_updated: usize,
    pub stale_ops: Vec<String>,
    pub missing_in_live_bundle: Vec<String>,
}

/// Scrape all operations from bundles and update queryIds in catalog JSON.
pub async fn sync_catalog_file(path: &Path) -> Result<SyncReport> {
    let client = discovery_client()?;
    let bundles = discover_bundles_public(&client).await?;
    let live = fetch_and_extract_all(&client, &bundles).await;

    let raw = std::fs::read_to_string(path)?;
    let mut root: Value = serde_json::from_str(&raw)?;
    let ops = root
        .get_mut("operations")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| crate::XError::Auth("catalog JSON missing operations".into()))?;

    let mut updated = 0usize;
    let mut stale = Vec::new();
    let mut missing = Vec::new();

    for (name, op_val) in ops.iter_mut() {
        let Some(live_qid) = live.get(name) else {
            missing.push(name.clone());
            continue;
        };
        let Some(obj) = op_val.as_object_mut() else {
            continue;
        };
        let current = obj
            .get("queryId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if current != live_qid.as_str() {
            stale.push(name.clone());
            obj.insert("queryId".to_owned(), Value::String(live_qid.clone()));
            updated += 1;
        }
    }

    let catalog_ops = ops.len();
    if let Some(obj) = root.as_object_mut() {
        let main = bundles
            .iter()
            .find(|u| u.contains("/main."))
            .and_then(|u| u.rsplit('/').next())
            .unwrap_or("live-bundle");
        obj.insert(
            "extracted_from".to_owned(),
            Value::String(format!("sync:{main}")),
        );
        obj.insert(
            "operation_count".to_owned(),
            Value::Number(catalog_ops.into()),
        );
    }

    let json = serde_json::to_string_pretty(&root)?;
    std::fs::write(path, format!("{json}\n"))?;

    Ok(SyncReport {
        catalog_path: path.display().to_string(),
        live_ops: live.len(),
        catalog_ops,
        query_ids_updated: updated,
        stale_ops: stale,
        missing_in_live_bundle: missing,
    })
}

/// Serialize catalog for coverage inspection (ops count by type).
pub fn catalog_stats(path: &Path) -> Result<Value> {
    let raw = std::fs::read_to_string(path)?;
    let root: Value = serde_json::from_str(&raw)?;
    let ops = root.get("operations").and_then(|v| v.as_object());
    let (total, queries, mutations) = match ops {
        Some(m) => {
            let total = m.len();
            let queries = m
                .values()
                .filter(|o| o.get("operationType").and_then(|v| v.as_str()) == Some("query"))
                .count();
            let mutations = m
                .values()
                .filter(|o| o.get("operationType").and_then(|v| v.as_str()) == Some("mutation"))
                .count();
            (total, queries, mutations)
        }
        None => (0, 0, 0),
    };
    Ok(serde_json::json!({
        "total": total,
        "queries": queries,
        "mutations": mutations,
    }))
}