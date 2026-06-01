// SPDX-License-Identifier: Apache-2.0
//! JSON5 configuration files (bird-compatible).
//!
//! Precedence (highest first): CLI flags > environment shortcuts > project
//! config (`./.aphrodyxrc.json5`) > global config
//! (`<config>/aphrody/x/config.json5`). CLI flag application is the caller's
//! responsibility; this module only resolves and merges the file + env layers.

use std::path::PathBuf;

use serde::Deserialize;

/// Resolved configuration values (all optional; callers supply defaults).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    /// Default request timeout in milliseconds.
    pub timeout_ms: Option<u64>,
    /// Default max quoted-tweet depth.
    pub quote_depth: Option<u32>,
    /// Default page size for reading commands.
    pub default_count: Option<u32>,
    /// Default output mode: "json" or "plain".
    pub output: Option<String>,
}

impl Config {
    /// Load and merge global + project config files plus env shortcuts.
    ///
    /// Never fails: unreadable or malformed files are skipped (best-effort),
    /// so a broken config can't brick the CLI.
    pub fn load() -> Self {
        let mut cfg = Config::default();

        if let Some(global) = global_config_path()
            && let Some(loaded) = read_json5(&global)
        {
            cfg.merge(loaded);
        }
        if let Some(loaded) = read_json5(&PathBuf::from(".aphrodyxrc.json5")) {
            cfg.merge(loaded);
        }
        cfg.apply_env();
        cfg
    }

    /// Overlay non-`None` fields from `other` onto `self`.
    fn merge(&mut self, other: Config) {
        if other.timeout_ms.is_some() {
            self.timeout_ms = other.timeout_ms;
        }
        if other.quote_depth.is_some() {
            self.quote_depth = other.quote_depth;
        }
        if other.default_count.is_some() {
            self.default_count = other.default_count;
        }
        if other.output.is_some() {
            self.output = other.output;
        }
    }

    fn apply_env(&mut self) {
        if let Ok(v) = std::env::var("APHRODY_X_TIMEOUT_MS")
            && let Ok(n) = v.parse()
        {
            self.timeout_ms = Some(n);
        }
        if let Ok(v) = std::env::var("APHRODY_X_QUOTE_DEPTH")
            && let Ok(n) = v.parse()
        {
            self.quote_depth = Some(n);
        }
    }
}

fn global_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("aphrody").join("x").join("config.json5"))
}

fn read_json5(path: &PathBuf) -> Option<Config> {
    let raw = std::fs::read_to_string(path).ok()?;
    json5::from_str(&raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_overlays_non_none() {
        let mut base = Config {
            timeout_ms: Some(1000),
            quote_depth: Some(1),
            default_count: Some(20),
            output: Some("json".into()),
        };
        base.merge(Config {
            quote_depth: Some(3),
            ..Default::default()
        });
        assert_eq!(base.timeout_ms, Some(1000));
        assert_eq!(base.quote_depth, Some(3));
        assert_eq!(base.default_count, Some(20));
    }

    #[test]
    fn parses_json5_with_comments() {
        let src = r#"{
            // a comment
            timeoutMs: 5000,
            quoteDepth: 2,
        }"#;
        let cfg: Config = json5::from_str(src).expect("json5 must parse");
        assert_eq!(cfg.timeout_ms, Some(5000));
        assert_eq!(cfg.quote_depth, Some(2));
    }
}
