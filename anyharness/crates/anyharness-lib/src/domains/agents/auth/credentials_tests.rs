//! Unit tests for local credential detection (split from credentials.rs to
//! keep the module under the repo line-count ceiling).

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

#[test]
fn cli_auth_state_absent_when_env_ready_but_no_auth_file() {
    let home = make_temp_home();
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::AnyRequiredSlot,
        slots: vec![AuthSlotSpec {
            id: "codex".into(),
            label: "Codex".into(),
            credential_provider_ids: vec!["openai".into()],
            required_for_readiness: true,
            env_vars: vec!["OPENAI_API_KEY".into()],
            login: Some(test_login_spec()),
            discovery: CredentialDiscoveryKind::Codex,
            materialization: Default::default(),
        }],
    };

    // With env var set, credential_state should be Ready
    let mut env = std::collections::BTreeMap::new();
    env.insert("OPENAI_API_KEY".to_string(), "sk-test".to_string());
    let (credential_state, _) = detect_auth_slots_with_env(&auth, &home, &env);
    assert_eq!(credential_state, CredentialState::Ready);

    // But CLI auth state should be Absent (no auth file)
    let cli_state = detect_cli_auth_state(&auth, &home);
    assert_eq!(cli_state, Some(CliAuthState::Absent));

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn cli_auth_state_authenticated_when_auth_file_present() {
    let home = make_temp_home();
    std::fs::write(
        home.join(".claude.json"),
        r#"{"oauthAccount":{"accountUuid":"14e13aa4-45cf-400d-a512-4722faa2320f"}}"#,
    )
    .expect("write claude.json");

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

    let cli_state = detect_cli_auth_state(&auth, &home);
    assert_eq!(cli_state, Some(CliAuthState::Authenticated));

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn cli_auth_state_expired_when_auth_file_expired() {
    let home = make_temp_home();
    std::fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    std::fs::write(
        home.join(".claude/.credentials.json"),
        r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":1000}}"#,
    )
    .expect("write expired creds");

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

    let cli_state = detect_cli_auth_state(&auth, &home);
    assert_eq!(cli_state, Some(CliAuthState::Expired));

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn cli_auth_state_unsupported_when_no_discovery() {
    let home = make_temp_home();
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![AuthSlotSpec {
            id: "custom".into(),
            label: "Custom".into(),
            credential_provider_ids: vec![],
            required_for_readiness: false,
            env_vars: vec![],
            login: None,
            discovery: CredentialDiscoveryKind::None,
            materialization: Default::default(),
        }],
    };

    let cli_state = detect_cli_auth_state(&auth, &home);
    assert_eq!(cli_state, Some(CliAuthState::Unsupported));

    let _ = std::fs::remove_dir_all(&home);
}
