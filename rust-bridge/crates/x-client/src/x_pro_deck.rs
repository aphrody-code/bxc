// SPDX-License-Identifier: Apache-2.0
//! X Pro (Gryphon) deck GraphQL — ViewerAccountSync, CreateDeck, columns.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::XClient;
use crate::Result;

pub use crate::surface::{GRYPHON_GRAPHQL_OPS, X_PRO_RECON_URLS};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct XProDeckConfig {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub is_pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct XProDeckColumn {
    pub rest_id: String,
    pub pathname: String,
    #[serde(default)]
    pub width: Option<String>,
    #[serde(default)]
    pub media_preview: Option<String>,
    #[serde(default)]
    pub latest: Option<bool>,
    #[serde(default)]
    pub hide_header: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct XProDeck {
    pub rest_id: String,
    #[serde(default)]
    pub config: Option<XProDeckConfig>,
    #[serde(default)]
    pub deck_columns_v2: Vec<XProDeckColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct XProAccountSyncConfig {
    #[serde(default)]
    pub active_deck_id: Option<String>,
    #[serde(default)]
    pub composer_expanded: Option<bool>,
    #[serde(default)]
    pub default_column_width: Option<String>,
    #[serde(default)]
    pub default_media_preview: Option<String>,
    #[serde(default)]
    pub navbar_expanded: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewerAccountSyncResult {
    pub decks: Vec<XProDeck>,
    #[serde(default)]
    pub accountsync_client_config: Option<XProAccountSyncConfig>,
    #[serde(default)]
    pub accountsync_onboarding_state: Option<Value>,
    pub raw: Value,
}

fn dig<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

pub fn parse_viewer_account_sync(json: &Value) -> ViewerAccountSyncResult {
    let viewer = dig(json, &["data", "viewer_v2"]);
    let decks: Vec<XProDeck> = viewer
        .and_then(|v| v.get("decks"))
        .and_then(|d| serde_json::from_value(d.clone()).ok())
        .unwrap_or_default();
    let accountsync_client_config = viewer
        .and_then(|v| v.get("accountsync_client_config"))
        .and_then(|c| serde_json::from_value(c.clone()).ok());
    let accountsync_onboarding_state =
        dig(json, &["data", "accountsync_onboarding_state"]).cloned();
    ViewerAccountSyncResult {
        decks,
        accountsync_client_config,
        accountsync_onboarding_state,
        raw: json.clone(),
    }
}

impl XClient {
    /// `ViewerAccountSync` — list decks + client config (X Pro).
    pub async fn viewer_account_sync(&self) -> Result<ViewerAccountSyncResult> {
        let json = self.graphql("ViewerAccountSync", serde_json::json!({}), None).await?;
        Ok(parse_viewer_account_sync(&json))
    }

    pub async fn xpro_get_deck(&self, deck_id: &str) -> Result<Option<XProDeck>> {
        let sync = self.viewer_account_sync().await?;
        Ok(sync.decks.into_iter().find(|d| d.rest_id == deck_id))
    }

    pub async fn xpro_create_deck(
        &self,
        name: &str,
        columns: Value,
    ) -> Result<Option<String>> {
        let json = self
            .graphql(
                "CreateDeck",
                serde_json::json!({ "name": name, "columns": columns }),
                None,
            )
            .await?;
        Ok(dig(&json, &["data", "deck_insert", "rest_id"])
            .and_then(|v| v.as_str())
            .map(str::to_owned))
    }

    pub async fn xpro_remove_deck(&self, deck_id: &str) -> Result<Value> {
        self.graphql("RemoveDeck", serde_json::json!({ "deckId": deck_id }), None)
            .await
    }

    pub async fn xpro_update_deck(
        &self,
        deck_id: &str,
        config: &XProDeckConfig,
    ) -> Result<Value> {
        self.graphql(
            "UpdateDeck",
            serde_json::json!({ "deckId": deck_id, "config": config }),
            None,
        )
        .await
    }

    pub async fn probe_xpro_access(&self) -> Result<(bool, usize, Option<String>)> {
        match self.viewer_account_sync().await {
            Ok(sync) => Ok((
                true,
                sync.decks.len(),
                sync.accountsync_client_config
                    .and_then(|c| c.active_deck_id),
            )),
            Err(e) => Err(e),
        }
    }
}