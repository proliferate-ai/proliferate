//! Resolve catalog-declared per-harness settings into launch-time deltas
//! (extra CLI args and env vars). Reads the persisted settings map from the
//! agent-auth state file and the setting declarations from the bundled catalog.
//!
//! Application rule (v1):
//! - `cli_flag` + value `true` → append the `flag` to argv
//! - `env` + any value → set the env var to the JSON string form of the value
//! - A setting absent from the persisted map (or with a `false`/null value for
//!   cli_flag) produces no delta.

use std::collections::BTreeMap;

use super::schema::{AgentCatalogSetting, AgentCatalogSettingMapping};

/// Resolved settings deltas to apply at harness spawn.
#[derive(Debug, Clone, Default)]
pub struct ResolvedSettingsDeltas {
    /// Extra CLI args to append after the base spawn args.
    pub extra_args: Vec<String>,
    /// Extra env vars to set in the spawn environment.
    pub extra_env: BTreeMap<String, String>,
}

/// Resolve the settings for a harness kind from the catalog declarations and
/// persisted values. `surface` filters settings to those relevant for the
/// delivery surface (e.g. `"local"` for desktop launches).
pub fn resolve_settings_deltas(
    catalog_settings: &[AgentCatalogSetting],
    persisted: Option<&serde_json::Map<String, serde_json::Value>>,
    surface: &str,
) -> ResolvedSettingsDeltas {
    let mut deltas = ResolvedSettingsDeltas::default();
    let empty_map = serde_json::Map::new();
    let values = persisted.unwrap_or(&empty_map);

    for setting in catalog_settings {
        // Skip settings not relevant to this surface.
        if !setting.surfaces.iter().any(|s| s == surface) {
            continue;
        }

        let value = values.get(&setting.key);
        apply_setting_mapping(&setting.mapping, value, &mut deltas);
    }

    deltas
}

fn apply_setting_mapping(
    mapping: &AgentCatalogSettingMapping,
    value: Option<&serde_json::Value>,
    deltas: &mut ResolvedSettingsDeltas,
) {
    match mapping.kind.as_str() {
        "cli_flag" => {
            // Append the flag only when the value is explicitly `true`.
            if value == Some(&serde_json::Value::Bool(true)) {
                if let Some(flag) = &mapping.flag {
                    deltas.extra_args.push(flag.clone());
                }
            }
        }
        "env" => {
            // Set the env var to the string representation of the value.
            if let (Some(env_name), Some(val)) = (&mapping.env, value) {
                let str_val = match val {
                    serde_json::Value::Bool(b) => b.to_string(),
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    other => other.to_string(),
                };
                deltas.extra_env.insert(env_name.clone(), str_val);
            }
        }
        _ => {} // Unknown mapping kinds are silently ignored (forward compat).
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{AgentCatalogSetting, AgentCatalogSettingMapping};

    fn chrome_setting() -> AgentCatalogSetting {
        AgentCatalogSetting {
            key: "chrome".to_string(),
            setting_type: "boolean".to_string(),
            label: "Use Claude Code with Chrome".to_string(),
            description: Some(
                "Allow Claude Code to control your Chrome browser.".to_string(),
            ),
            default: serde_json::Value::Bool(false),
            surfaces: vec!["local".to_string()],
            mapping: AgentCatalogSettingMapping {
                kind: "cli_flag".to_string(),
                flag: Some("--chrome".to_string()),
                env: None,
            },
        }
    }

    fn env_setting() -> AgentCatalogSetting {
        AgentCatalogSetting {
            key: "debug".to_string(),
            setting_type: "boolean".to_string(),
            label: "Debug mode".to_string(),
            description: None,
            default: serde_json::Value::Bool(false),
            surfaces: vec!["local".to_string(), "cloud".to_string()],
            mapping: AgentCatalogSettingMapping {
                kind: "env".to_string(),
                flag: None,
                env: Some("CLAUDE_DEBUG".to_string()),
            },
        }
    }

    #[test]
    fn chrome_true_appends_flag() {
        let settings = vec![chrome_setting()];
        let mut persisted = serde_json::Map::new();
        persisted.insert("chrome".to_string(), serde_json::Value::Bool(true));

        let deltas = resolve_settings_deltas(&settings, Some(&persisted), "local");
        assert_eq!(deltas.extra_args, vec!["--chrome"]);
        assert!(deltas.extra_env.is_empty());
    }

    #[test]
    fn chrome_false_does_not_append_flag() {
        let settings = vec![chrome_setting()];
        let mut persisted = serde_json::Map::new();
        persisted.insert("chrome".to_string(), serde_json::Value::Bool(false));

        let deltas = resolve_settings_deltas(&settings, Some(&persisted), "local");
        assert!(deltas.extra_args.is_empty());
    }

    #[test]
    fn chrome_absent_does_not_append_flag() {
        let settings = vec![chrome_setting()];
        let deltas = resolve_settings_deltas(&settings, None, "local");
        assert!(deltas.extra_args.is_empty());
    }

    #[test]
    fn env_setting_sets_env_var() {
        let settings = vec![env_setting()];
        let mut persisted = serde_json::Map::new();
        persisted.insert("debug".to_string(), serde_json::Value::Bool(true));

        let deltas = resolve_settings_deltas(&settings, Some(&persisted), "local");
        assert!(deltas.extra_args.is_empty());
        assert_eq!(
            deltas.extra_env.get("CLAUDE_DEBUG").map(String::as_str),
            Some("true")
        );
    }

    #[test]
    fn surface_filtering_works() {
        let settings = vec![chrome_setting()]; // surfaces: ["local"]
        let mut persisted = serde_json::Map::new();
        persisted.insert("chrome".to_string(), serde_json::Value::Bool(true));

        // cloud surface: chrome setting is filtered out
        let deltas = resolve_settings_deltas(&settings, Some(&persisted), "cloud");
        assert!(deltas.extra_args.is_empty());
    }
}
