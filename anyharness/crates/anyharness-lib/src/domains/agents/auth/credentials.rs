use std::collections::BTreeMap;
use std::path::Path;

use anyharness_credential_discovery::{
    detect_local_auth_state as discover_local_auth_state, LocalAuthState, ProviderId,
};

use crate::domains::agents::model::{
    AuthReadinessPolicy, AuthSlotSpec, AuthSpec, CredentialDiscoveryKind, CredentialState,
    ResolvedAuthSlot,
};

/// Determine the credential state for an agent by checking env vars first,
/// then running provider-specific local discovery, then falling back to
/// login-required or missing-env as appropriate.
pub fn detect_credentials(auth: &AuthSpec, home_dir: &Path) -> CredentialState {
    detect_auth_slots(auth, home_dir).0
}

pub fn detect_credentials_with_env(
    auth: &AuthSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> CredentialState {
    detect_auth_slots_with_env(auth, home_dir, additional_env).0
}

pub fn detect_auth_slots(
    auth: &AuthSpec,
    home_dir: &Path,
) -> (CredentialState, Vec<ResolvedAuthSlot>) {
    detect_auth_slots_with_env(auth, home_dir, &BTreeMap::new())
}

pub fn detect_auth_slots_with_env(
    auth: &AuthSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> (CredentialState, Vec<ResolvedAuthSlot>) {
    let slots = auth
        .slots
        .iter()
        .map(|slot| ResolvedAuthSlot {
            spec: slot.clone(),
            credential_state: detect_slot_credentials(slot, home_dir, additional_env),
        })
        .collect::<Vec<_>>();

    (aggregate_credential_state(auth, &slots), slots)
}

fn detect_slot_credentials(
    slot: &AuthSlotSpec,
    home_dir: &Path,
    additional_env: &BTreeMap<String, String>,
) -> CredentialState {
    if slot.env_vars.is_empty() && slot.discovery == CredentialDiscoveryKind::None {
        return CredentialState::MissingEnv;
    }

    if slot
        .env_vars
        .iter()
        .any(|var| additional_env.contains_key(var) || std::env::var(var).is_ok())
    {
        return CredentialState::Ready;
    }

    if detect_local_auth(&slot.discovery, home_dir) {
        return CredentialState::ReadyViaLocalAuth;
    }

    if slot.login.is_some() {
        return CredentialState::LoginRequired;
    }

    CredentialState::MissingEnv
}

fn aggregate_credential_state(auth: &AuthSpec, slots: &[ResolvedAuthSlot]) -> CredentialState {
    match auth.readiness_policy {
        AuthReadinessPolicy::None | AuthReadinessPolicy::ProviderManaged => CredentialState::Ready,
        AuthReadinessPolicy::AnyRequiredSlot => {
            let required = required_slots(slots);
            if required.is_empty() {
                return CredentialState::Ready;
            }
            if required.iter().any(slot_is_ready) {
                return CredentialState::Ready;
            }
            preferred_missing_state(required)
        }
        AuthReadinessPolicy::AllRequiredSlots => {
            let required = required_slots(slots);
            if required.is_empty() || required.iter().all(|slot| slot_is_ready(slot)) {
                return CredentialState::Ready;
            }
            preferred_missing_state(required)
        }
    }
}

fn required_slots(slots: &[ResolvedAuthSlot]) -> Vec<&ResolvedAuthSlot> {
    slots
        .iter()
        .filter(|slot| slot.spec.required_for_readiness)
        .collect()
}

fn slot_is_ready(slot: &&ResolvedAuthSlot) -> bool {
    matches!(
        slot.credential_state,
        CredentialState::Ready | CredentialState::ReadyViaLocalAuth
    )
}

fn preferred_missing_state(slots: Vec<&ResolvedAuthSlot>) -> CredentialState {
    if slots
        .iter()
        .any(|slot| slot.credential_state == CredentialState::LoginRequired)
    {
        CredentialState::LoginRequired
    } else {
        CredentialState::MissingEnv
    }
}

/// Dispatches to the right provider-specific detector based on the discovery kind.
fn detect_local_auth(kind: &CredentialDiscoveryKind, home_dir: &Path) -> bool {
    match kind {
        CredentialDiscoveryKind::None => false,
        CredentialDiscoveryKind::Claude => detect_shared_local_auth(ProviderId::Claude, home_dir),
        CredentialDiscoveryKind::Codex => detect_shared_local_auth(ProviderId::Codex, home_dir),
        CredentialDiscoveryKind::OpenCode => detect_opencode_local_auth(home_dir),
        CredentialDiscoveryKind::Cursor => detect_cursor_local_auth(home_dir),
        CredentialDiscoveryKind::Grok => detect_shared_local_auth(ProviderId::Xai, home_dir),
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
///   or `type: "oauth"` + `access`, or `type: "wellknown"` + `token`.
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

        if auth_type == "api" && non_empty_string(config, "key")
            || auth_type == "oauth" && non_empty_string(config, "access")
            || auth_type == "wellknown" && non_empty_string(config, "token")
        {
            return true;
        }
    }

    false
}

fn non_empty_string(config: &serde_json::Map<String, serde_json::Value>, key: &str) -> bool {
    config
        .get(key)
        .and_then(|v| v.as_str())
        .is_some_and(|value| !value.is_empty())
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
    fn treats_opencode_auth_as_provider_managed_when_no_env_or_auth_exists() {
        let home = make_temp_home();
        let auth = AuthSpec {
            readiness_policy: AuthReadinessPolicy::ProviderManaged,
            slots: vec![AuthSlotSpec {
                id: "openai".into(),
                label: "OpenAI".into(),
                credential_provider_ids: vec!["openai".into()],
                required_for_readiness: false,
                env_vars: vec![],
                login: None,
                discovery: CredentialDiscoveryKind::OpenCode,
                materialization: Default::default(),
            }],
        };

        assert_eq!(detect_credentials(&auth, &home), CredentialState::Ready);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn detects_opencode_api_oauth_and_wellknown_auth() {
        for auth_json in [
            r#"{"openai":{"type":"api","key":"sk-test"}}"#,
            r#"{"github-copilot":{"type":"oauth","access":"access-token","refresh":"refresh-token","expires":1}}"#,
            r#"{"https://example.com":{"type":"wellknown","key":"CUSTOM_TOKEN","token":"token"}}"#,
        ] {
            let home = make_temp_home();
            let opencode_dir = home.join(".local").join("share").join("opencode");
            std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
            std::fs::write(opencode_dir.join("auth.json"), auth_json).expect("write auth json");

            assert!(detect_opencode_local_auth(&home));

            let _ = std::fs::remove_dir_all(&home);
        }
    }

    #[test]
    fn ignores_empty_opencode_auth_entries() {
        let home = make_temp_home();
        let opencode_dir = home.join(".local").join("share").join("opencode");
        std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
        std::fs::write(
            opencode_dir.join("auth.json"),
            r#"{
              "openai": {"type":"api","key":""},
              "github-copilot": {"type":"oauth","access":""},
              "custom": {"type":"wellknown","token":""}
            }"#,
        )
        .expect("write auth json");

        assert!(!detect_opencode_local_auth(&home));

        let _ = std::fs::remove_dir_all(&home);
    }
}
