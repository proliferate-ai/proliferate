use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

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

    match detect_local_auth(&slot.discovery, home_dir) {
        LocalAuthDetection::Present => return CredentialState::ReadyViaLocalAuth,
        LocalAuthDetection::Expired => return CredentialState::LoginRequired,
        LocalAuthDetection::Absent => {}
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

/// Local auth detection result: present, expired (credentials exist but past
/// expiry), or absent.
enum LocalAuthDetection {
    Present,
    Expired,
    Absent,
}

/// Dispatches to the right provider-specific detector based on the discovery kind.
fn detect_local_auth(kind: &CredentialDiscoveryKind, home_dir: &Path) -> LocalAuthDetection {
    match kind {
        CredentialDiscoveryKind::None => LocalAuthDetection::Absent,
        CredentialDiscoveryKind::Claude => detect_shared_local_auth(ProviderId::Claude, home_dir),
        CredentialDiscoveryKind::Codex => detect_shared_local_auth(ProviderId::Codex, home_dir),
        CredentialDiscoveryKind::OpenCode => detect_opencode_local_auth(home_dir),
        CredentialDiscoveryKind::Cursor => {
            if detect_cursor_local_auth(home_dir) {
                LocalAuthDetection::Present
            } else {
                LocalAuthDetection::Absent
            }
        }
        CredentialDiscoveryKind::Grok => detect_shared_local_auth(ProviderId::Xai, home_dir),
    }
}

fn detect_shared_local_auth(provider: ProviderId, home_dir: &Path) -> LocalAuthDetection {
    match discover_local_auth_state(provider, home_dir) {
        Ok(LocalAuthState::Present(_)) => LocalAuthDetection::Present,
        Ok(LocalAuthState::Expired(_)) => LocalAuthDetection::Expired,
        Ok(LocalAuthState::Absent) => LocalAuthDetection::Absent,
        Err(err) => {
            tracing::warn!(provider = ?provider, error = %err, "Shared credential discovery failed");
            LocalAuthDetection::Absent
        }
    }
}

/// Check OpenCode-specific local auth file for any provider credential.
///
/// Checks:
/// - `~/.local/share/opencode/auth.json` for provider entries with `type: "api"` + `key`
///   or `type: "oauth"` + `access`, or `type: "wellknown"` + `token`.
/// OAuth entries with an `expires` field (seconds epoch) in the past are treated as expired.
fn detect_opencode_local_auth(home_dir: &Path) -> LocalAuthDetection {
    let path = home_dir
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    let Some(data) = read_json_file(&path) else {
        return LocalAuthDetection::Absent;
    };
    let Some(obj) = data.as_object() else {
        return LocalAuthDetection::Absent;
    };

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut found_expired = false;

    for (_provider, value) in obj {
        let Some(config) = value.as_object() else {
            continue;
        };
        let auth_type = config.get("type").and_then(|v| v.as_str()).unwrap_or("");

        let has_credential = auth_type == "api" && non_empty_string(config, "key")
            || auth_type == "oauth" && non_empty_string(config, "access")
            || auth_type == "wellknown" && non_empty_string(config, "token");

        if !has_credential {
            continue;
        }

        // For oauth entries, check expiry if the `expires` field is present
        if auth_type == "oauth" {
            if let Some(expires_secs) = config.get("expires").and_then(|v| v.as_u64()) {
                if expires_secs <= now_secs {
                    found_expired = true;
                    continue;
                }
            }
        }

        // Found a valid, non-expired credential
        return LocalAuthDetection::Present;
    }

    if found_expired {
        LocalAuthDetection::Expired
    } else {
        LocalAuthDetection::Absent
    }
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

    use crate::domains::agents::model::{CommandSpec, LoginSpec};

    fn make_temp_home() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("anyharness-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp home");
        path
    }

    fn test_login_spec() -> LoginSpec {
        LoginSpec {
            label: "Log in".into(),
            command: CommandSpec {
                program: "test".into(),
                args: vec!["login".into()],
            },
            reuses_user_state: false,
            message: None,
        }
    }

    #[test]
    fn detects_claude_oauth_account() {
        let home = make_temp_home();
        std::fs::write(
            home.join(".claude.json"),
            r#"{"oauthAccount":{"accountUuid":"14e13aa4-45cf-400d-a512-4722faa2320f"}}"#,
        )
        .expect("write claude.json");

        assert!(matches!(
            detect_shared_local_auth(ProviderId::Claude, &home),
            LocalAuthDetection::Present
        ));

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

        assert!(matches!(
            detect_shared_local_auth(ProviderId::Claude, &home),
            LocalAuthDetection::Absent
        ));

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
            // expires far in the future
            r#"{"github-copilot":{"type":"oauth","access":"access-token","refresh":"refresh-token","expires":2840000000}}"#,
            r#"{"https://example.com":{"type":"wellknown","key":"CUSTOM_TOKEN","token":"token"}}"#,
        ] {
            let home = make_temp_home();
            let opencode_dir = home.join(".local").join("share").join("opencode");
            std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
            std::fs::write(opencode_dir.join("auth.json"), auth_json).expect("write auth json");

            assert!(
                matches!(detect_opencode_local_auth(&home), LocalAuthDetection::Present),
                "Expected Present for: {auth_json}"
            );

            let _ = std::fs::remove_dir_all(&home);
        }
    }

    #[test]
    fn expired_claude_oauth_yields_login_required() {
        let home = make_temp_home();
        std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
        // expiresAt in the past (epoch 1000ms = 1970)
        std::fs::write(
            home.join(".claude/.credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":1000}}"#,
        )
        .expect("write claude creds");

        let auth = AuthSpec {
            readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
            slots: vec![AuthSlotSpec {
                id: "claude".into(),
                label: "Claude".into(),
                credential_provider_ids: vec!["anthropic".into()],
                required_for_readiness: true,
                env_vars: vec![],
                login: Some(test_login_spec()),
                discovery: CredentialDiscoveryKind::Claude,
                materialization: Default::default(),
            }],
        };

        assert_eq!(
            detect_credentials(&auth, &home),
            CredentialState::LoginRequired
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn valid_claude_oauth_yields_ready_via_local_auth() {
        let home = make_temp_home();
        std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
        // expiresAt far in the future
        std::fs::write(
            home.join(".claude/.credentials.json"),
            r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":2840000000000}}"#,
        )
        .expect("write claude creds");

        let auth = AuthSpec {
            readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
            slots: vec![AuthSlotSpec {
                id: "claude".into(),
                label: "Claude".into(),
                credential_provider_ids: vec!["anthropic".into()],
                required_for_readiness: true,
                env_vars: vec![],
                login: Some(test_login_spec()),
                discovery: CredentialDiscoveryKind::Claude,
                materialization: Default::default(),
            }],
        };

        // AnyRequiredSlot with a single ready slot → aggregate Ready
        assert_eq!(detect_credentials(&auth, &home), CredentialState::Ready);
        // Slot-level should be ReadyViaLocalAuth
        let (_, slots) = detect_auth_slots(&auth, &home);
        assert_eq!(slots[0].credential_state, CredentialState::ReadyViaLocalAuth);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn expired_opencode_oauth_yields_login_required() {
        let home = make_temp_home();
        let opencode_dir = home.join(".local").join("share").join("opencode");
        std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
        // expires in the past (epoch 1 second = 1970)
        std::fs::write(
            opencode_dir.join("auth.json"),
            r#"{"anthropic":{"type":"oauth","access":"token","refresh":"r","expires":1}}"#,
        )
        .expect("write auth json");

        let auth = AuthSpec {
            readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
            slots: vec![AuthSlotSpec {
                id: "opencode".into(),
                label: "OpenCode".into(),
                credential_provider_ids: vec!["anthropic".into()],
                required_for_readiness: true,
                env_vars: vec![],
                login: Some(test_login_spec()),
                discovery: CredentialDiscoveryKind::OpenCode,
                materialization: Default::default(),
            }],
        };

        assert_eq!(
            detect_credentials(&auth, &home),
            CredentialState::LoginRequired
        );

        let _ = std::fs::remove_dir_all(&home);
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

        assert!(matches!(
            detect_opencode_local_auth(&home),
            LocalAuthDetection::Absent
        ));

        let _ = std::fs::remove_dir_all(&home);
    }
}
