//! OpenCode auth.json detection: one fact per provider key with usable
//! credential material (`opencode-auth-json/<provider>`), so a multi-slot
//! opencode descriptor can classify each provider slot independently.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::facts::fact_kinds;
use crate::util::resolve_process_override_path;

/// Providers are emitted only when the entry carries usable credential
/// material (mirrors the legacy opencode readiness rules): `type:"api"` with
/// a non-empty `key`, `type:"oauth"` with non-empty `access`, or
/// `type:"wellknown"` with non-empty `token`. Empty entries are absence.
pub(crate) fn discovery_fact_kinds(home_dir: &Path) -> Vec<String> {
    provider_fact_kinds(&auth_json_path(home_dir))
}

/// `XDG_DATA_HOME` is a path override (not a credential), honored only when
/// `home_dir` is the process home — mirroring `CODEX_HOME`.
fn auth_json_path(home_dir: &Path) -> PathBuf {
    let default_data_home = home_dir.join(".local").join("share");
    resolve_process_override_path("XDG_DATA_HOME", home_dir, default_data_home)
        .join("opencode")
        .join("auth.json")
}

pub(crate) fn provider_fact_kinds(path: &Path) -> Vec<String> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(data) = serde_json::from_str::<Value>(&contents) else {
        tracing::warn!(path = %path.display(), "OpenCode auth file was not valid JSON");
        return Vec::new();
    };
    let Some(providers) = data.as_object() else {
        return Vec::new();
    };

    providers
        .iter()
        .filter(|(_, value)| entry_has_usable_credential(value))
        .map(|(provider, _)| format!("{}{provider}", fact_kinds::OPENCODE_AUTH_JSON_PREFIX))
        .collect()
}

fn entry_has_usable_credential(value: &Value) -> bool {
    let Some(config) = value.as_object() else {
        return false;
    };
    let credential_field = match config.get("type").and_then(Value::as_str) {
        Some("api") => "key",
        Some("oauth") => "access",
        Some("wellknown") => "token",
        _ => return false,
    };
    config
        .get(credential_field)
        .and_then(Value::as_str)
        .is_some_and(|credential| !credential.is_empty())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn make_temp_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-opencode-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(path.join(".local/share/opencode")).expect("create opencode dir");
        path
    }

    #[test]
    fn emits_one_fact_per_usable_provider() {
        let home = make_temp_home();
        fs::write(
            home.join(".local/share/opencode/auth.json"),
            r#"{
              "anthropic": {"type":"oauth","access":"access-token","refresh":"r","expires":1},
              "openai": {"type":"api","key":"sk-test"},
              "https://example.com": {"type":"wellknown","key":"CUSTOM_TOKEN","token":"token"}
            }"#,
        )
        .expect("write auth json");

        let mut kinds = discovery_fact_kinds(&home);
        kinds.sort();
        assert_eq!(
            kinds,
            vec![
                "opencode-auth-json/anthropic",
                "opencode-auth-json/https://example.com",
                "opencode-auth-json/openai",
            ]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn skips_empty_or_unknown_entries() {
        let home = make_temp_home();
        fs::write(
            home.join(".local/share/opencode/auth.json"),
            r#"{
              "openai": {"type":"api","key":""},
              "github-copilot": {"type":"oauth","access":""},
              "custom": {"type":"wellknown","token":""},
              "weird": {"type":"mystery","key":"value"},
              "not-an-object": "nope"
            }"#,
        )
        .expect("write auth json");

        assert!(discovery_fact_kinds(&home).is_empty());

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn absent_when_file_missing_or_invalid() {
        let home = make_temp_home();
        assert!(discovery_fact_kinds(&home).is_empty());

        fs::write(home.join(".local/share/opencode/auth.json"), "not json")
            .expect("write auth json");
        assert!(discovery_fact_kinds(&home).is_empty());

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn parses_injected_path_directly() {
        let home = make_temp_home();
        let injected = home.join("custom-auth.json");
        fs::write(&injected, r#"{"openai":{"type":"api","key":"sk-test"}}"#)
            .expect("write auth json");

        assert_eq!(
            provider_fact_kinds(&injected),
            vec!["opencode-auth-json/openai"]
        );

        let _ = fs::remove_dir_all(home);
    }
}
