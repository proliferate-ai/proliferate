use std::path::Path;

use anyharness_credential_discovery::{
    detect_local_auth_state as discover_local_auth_state, LocalAuthState, ProviderId,
};

use super::model::{AuthSpec, CredentialDiscoveryKind, CredentialState};

/// Determine the credential state for an agent by checking env vars first,
/// then running provider-specific local discovery, then falling back to
/// login-required or missing-env as appropriate.
pub fn detect_credentials(auth: &AuthSpec, home_dir: &Path) -> CredentialState {
    if auth.env_vars.is_empty() && auth.discovery == CredentialDiscoveryKind::None {
        return CredentialState::Ready;
    }

    if auth.env_vars.iter().any(|var| std::env::var(var).is_ok()) {
        return CredentialState::Ready;
    }

    if detect_local_auth(&auth.discovery, home_dir) {
        return CredentialState::ReadyViaLocalAuth;
    }

    if auth.login.is_some() {
        return CredentialState::LoginRequired;
    }

    CredentialState::MissingEnv
}

/// Dispatches to the right provider-specific detector based on the discovery kind.
fn detect_local_auth(kind: &CredentialDiscoveryKind, home_dir: &Path) -> bool {
    match kind {
        CredentialDiscoveryKind::None => false,
        CredentialDiscoveryKind::Claude => detect_shared_local_auth(ProviderId::Claude, home_dir),
        CredentialDiscoveryKind::Codex => detect_shared_local_auth(ProviderId::Codex, home_dir),
        CredentialDiscoveryKind::Gemini => detect_shared_local_auth(ProviderId::Gemini, home_dir),
        CredentialDiscoveryKind::OpenCode => detect_opencode_local_auth(home_dir),
        CredentialDiscoveryKind::Cursor => detect_cursor_local_auth(home_dir),
        CredentialDiscoveryKind::Amp => detect_amp_local_auth(home_dir),
    }
}

fn detect_shared_local_auth(provider: ProviderId, home_dir: &Path) -> bool {
    match discover_local_auth_state(provider, home_dir) {
        Ok(LocalAuthState::Present(_)) => true,
        Ok(LocalAuthState::Absent) => false,
        Err(err) => {
            tracing::warn!(provider = ?provider, error = %err, "Shared credential discovery failed");
            false
        }
    }
}

/// Check OpenCode-specific local auth file for any provider credential.
///
/// Checks:
/// - `~/.local/share/opencode/auth.json` for provider entries with `type: "api"` + `key`
///   or `type: "oauth"` + `access`
fn detect_opencode_local_auth(home_dir: &Path) -> bool {
    let path = home_dir
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    let Some(data) = read_json_file(&path) else {
        return false;
    };
    let Some(obj) = data.as_object() else {
        return false;
    };

    for (_provider, value) in obj {
        let Some(config) = value.as_object() else {
            continue;
        };
        let auth_type = config.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if auth_type == "api" {
            if let Some(key) = config.get("key").and_then(|v| v.as_str()) {
                if !key.is_empty() {
                    return true;
                }
            }
        } else if auth_type == "oauth" {
            if config.get("access").and_then(|v| v.as_str()).is_some() {
                return true;
            }
        }
    }

    false
}

/// Check Cursor-specific local login state.
///
/// Checks:
/// - `~/.cursor/cli-config.json` for `authInfo.userId` (set by `cursor-agent login`)
fn detect_cursor_local_auth(home_dir: &Path) -> bool {
    let path = home_dir.join(".cursor").join("cli-config.json");
    let Some(data) = read_json_file(&path) else {
        return false;
    };

    if let Some(user_id) = read_nested_string(&data, &["authInfo", "email"]) {
        if !user_id.is_empty() {
            return true;
        }
    }

    false
}

/// Check Amp-specific local config for an API key.
///
/// Checks:
/// - `~/.amp/config.json` for various API key field names
fn detect_amp_local_auth(home_dir: &Path) -> bool {
    let path = home_dir.join(".amp").join("config.json");
    let Some(data) = read_json_file(&path) else {
        return false;
    };

    let key_paths: &[&[&str]] = &[
        &["anthropicApiKey"],
        &["anthropic_api_key"],
        &["apiKey"],
        &["api_key"],
        &["accessToken"],
        &["access_token"],
        &["token"],
        &["auth", "anthropicApiKey"],
        &["auth", "apiKey"],
        &["auth", "token"],
        &["anthropic", "apiKey"],
        &["anthropic", "token"],
    ];

    for key_path in key_paths {
        if let Some(val) = read_nested_string(&data, key_path) {
            if !val.is_empty() {
                return true;
            }
        }
    }

    false
}

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn read_nested_string<'a>(value: &'a serde_json::Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp_home() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("anyharness-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp home");
        path
    }

    #[test]
    fn detects_gemini_oauth_tokens() {
        let home = make_temp_home();
        let gemini_dir = home.join(".gemini");
        std::fs::create_dir_all(&gemini_dir).expect("create gemini dir");
        std::fs::write(
            gemini_dir.join("oauth_creds.json"),
            r#"{"refresh_token":"refresh-token"}"#,
        )
        .expect("write oauth creds");

        assert!(detect_shared_local_auth(ProviderId::Gemini, &home));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn detects_claude_oauth_account() {
        let home = make_temp_home();
        std::fs::write(
            home.join(".claude.json"),
            r#"{"oauthAccount":{"accountUuid":"14e13aa4-45cf-400d-a512-4722faa2320f"}}"#,
        )
        .expect("write claude.json");

        assert!(detect_shared_local_auth(ProviderId::Claude, &home));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn ignores_claude_json_without_credentials() {
        let home = make_temp_home();
        std::fs::write(
            home.join(".claude.json"),
            r#"{"hasCompletedOnboarding":true}"#,
        )
        .expect("write claude.json");

        assert!(!detect_shared_local_auth(ProviderId::Claude, &home));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn ignores_missing_gemini_oauth_tokens() {
        let home = make_temp_home();
        let gemini_dir = home.join(".gemini");
        std::fs::create_dir_all(&gemini_dir).expect("create gemini dir");
        std::fs::write(gemini_dir.join("oauth_creds.json"), r#"{}"#).expect("write oauth creds");

        assert!(!detect_shared_local_auth(ProviderId::Gemini, &home));

        let _ = std::fs::remove_dir_all(&home);
    }
}
