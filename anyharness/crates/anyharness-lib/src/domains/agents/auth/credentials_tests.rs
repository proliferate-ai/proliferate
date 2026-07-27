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
fn provider_managed_with_no_slot_credentials_is_missing_env_not_ready() {
    // A9 fix (was: unconditionally Ready, same as `None`). ProviderManaged
    // means the harness resolves provider auth itself, not "credential-less"
    // — opencode's real auth state is its selection set (agent-auth.md,
    // "Readiness interplay"), and a fresh opencode with no env vars and no
    // local auth.json has genuinely NO usable credential.
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
            discovery_kinds: Vec::new(),
            materialization: Default::default(),
        }],
    };

    assert_eq!(
        detect_credentials(&auth, &home),
        CredentialState::MissingEnv
    );

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn provider_managed_is_ready_when_any_slot_has_a_selected_credential() {
    // The other half of the A9 fix: ProviderManaged still resolves to Ready
    // the moment ANY slot's ladder is satisfied (opencode is multi-provider —
    // one selected provider is enough), same shape as AnyRequiredSlot but
    // without requiring `required_for_readiness` on the slot.
    let home = make_temp_home();
    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![
            AuthSlotSpec {
                id: "openai".into(),
                label: "OpenAI".into(),
                credential_provider_ids: vec!["openai".into()],
                required_for_readiness: false,
                env_vars: vec!["OPENAI_API_KEY".into()],
                login: None,
                discovery: CredentialDiscoveryKind::OpenCode,
                discovery_kinds: Vec::new(),
                materialization: Default::default(),
            },
            AuthSlotSpec {
                id: "anthropic".into(),
                label: "Anthropic".into(),
                credential_provider_ids: vec!["anthropic".into()],
                required_for_readiness: false,
                env_vars: vec![],
                login: None,
                discovery: CredentialDiscoveryKind::OpenCode,
                discovery_kinds: Vec::new(),
                materialization: Default::default(),
            },
        ],
    };
    let env: std::collections::BTreeMap<String, String> =
        [("OPENAI_API_KEY".to_string(), "sk-test".to_string())]
            .into_iter()
            .collect();

    assert_eq!(
        detect_credentials_with_env(&auth, &home, &env),
        CredentialState::Ready
    );

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
            matches!(
                detect_opencode_slot_auth(&home, &[]),
                LocalAuthDetection::Present
            ),
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
            discovery_kinds: Vec::new(),
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
            discovery_kinds: Vec::new(),
            materialization: Default::default(),
        }],
    };

    // AnyRequiredSlot with a single ready slot → aggregate Ready
    assert_eq!(detect_credentials(&auth, &home), CredentialState::Ready);
    // Slot-level should be ReadyViaLocalAuth
    let (_, slots) = detect_auth_slots(&auth, &home);
    assert_eq!(
        slots[0].credential_state,
        CredentialState::ReadyViaLocalAuth
    );

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
            discovery_kinds: Vec::new(),
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

    assert!(detect_opencode_provider_auth(&home).is_empty());
    assert!(matches!(
        detect_opencode_slot_auth(&home, &[]),
        LocalAuthDetection::Absent
    ));

    let _ = std::fs::remove_dir_all(&home);
}

/// The per-slot fixture: one provider with a usable api key, one with an
/// EXPIRED oauth entry, one slot with no entry at all. The old whole-file
/// detector collapsed all three into a single verdict, so opencode's gemini
/// slot read the same state as its anthropic slot.
fn write_mixed_opencode_auth(home: &std::path::Path) {
    let opencode_dir = home.join(".local").join("share").join("opencode");
    std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
    std::fs::write(
        opencode_dir.join("auth.json"),
        r#"{
          "openai": {"type":"api","key":"sk-openai"},
          "anthropic": {"type":"oauth","access":"token","refresh":"r","expires":1}
        }"#,
    )
    .expect("write auth json");
}

fn opencode_slot(id: &str, discovery_kinds: &[&str], env_vars: &[&str]) -> AuthSlotSpec {
    AuthSlotSpec {
        id: id.into(),
        label: id.into(),
        credential_provider_ids: vec![],
        required_for_readiness: false,
        env_vars: env_vars.iter().map(|var| (*var).to_string()).collect(),
        login: None,
        discovery: CredentialDiscoveryKind::OpenCode,
        discovery_kinds: discovery_kinds
            .iter()
            .map(|kind| (*kind).to_string())
            .collect(),
        materialization: Default::default(),
    }
}

#[test]
fn opencode_provider_auth_keeps_one_verdict_per_provider_key() {
    let home = make_temp_home();
    write_mixed_opencode_auth(&home);

    let providers = detect_opencode_provider_auth(&home);
    let mut verdicts = providers
        .iter()
        .map(|provider| (provider.fact_kind.as_str(), provider.detection))
        .collect::<Vec<_>>();
    verdicts.sort_by_key(|(kind, _)| *kind);
    assert_eq!(
        verdicts,
        vec![
            ("opencode-auth-json/anthropic", LocalAuthDetection::Expired),
            ("opencode-auth-json/openai", LocalAuthDetection::Present),
        ]
    );

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn opencode_slots_read_only_their_own_declared_provider_keys() {
    let home = make_temp_home();
    write_mixed_opencode_auth(&home);

    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![
            opencode_slot("openai", &["opencode-auth-json/openai"], &[]),
            opencode_slot("anthropic", &["opencode-auth-json/anthropic"], &[]),
            opencode_slot(
                "gemini",
                &["opencode-auth-json/google", "opencode-auth-json/gemini"],
                &[],
            ),
        ],
    };

    let (aggregate, slots) = detect_auth_slots_with_env(&auth, &home, &Default::default());

    assert_eq!(
        slots[0].credential_state,
        CredentialState::ReadyViaLocalAuth,
        "openai's api key is its own"
    );
    assert_eq!(
        slots[1].credential_state,
        CredentialState::LoginRequired,
        "anthropic's oauth entry is expired"
    );
    assert_eq!(
        slots[2].credential_state,
        CredentialState::MissingEnv,
        "gemini has no entry in the file at all"
    );
    // Aggregate is best-of, so a routed/whole-agent caller sees the same
    // Ready it saw before the per-slot split.
    assert_eq!(aggregate, CredentialState::Ready);
    assert_eq!(
        detect_cli_auth_state(&auth, &home),
        Some(CliAuthState::Authenticated)
    );

    let _ = std::fs::remove_dir_all(&home);
}

#[test]
fn opencode_aggregate_is_expired_when_every_matching_provider_is_expired() {
    let home = make_temp_home();
    let opencode_dir = home.join(".local").join("share").join("opencode");
    std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
    std::fs::write(
        opencode_dir.join("auth.json"),
        r#"{"anthropic":{"type":"oauth","access":"token","expires":1}}"#,
    )
    .expect("write auth json");

    let auth = AuthSpec {
        readiness_policy: AuthReadinessPolicy::ProviderManaged,
        slots: vec![
            opencode_slot("anthropic", &["opencode-auth-json/anthropic"], &[]),
            opencode_slot("openai", &["opencode-auth-json/openai"], &[]),
        ],
    };

    let (aggregate, slots) = detect_auth_slots_with_env(&auth, &home, &Default::default());
    assert_eq!(slots[0].credential_state, CredentialState::LoginRequired);
    assert_eq!(slots[1].credential_state, CredentialState::MissingEnv);
    assert_eq!(aggregate, CredentialState::LoginRequired);
    assert_eq!(
        detect_cli_auth_state(&auth, &home),
        Some(CliAuthState::Expired)
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// Declaring no kinds keeps the old whole-file reading, so a slot the registry
/// has not yet addressed does not silently lose its credential.
#[test]
fn opencode_slot_without_declared_kinds_reads_the_whole_file() {
    let home = make_temp_home();
    write_mixed_opencode_auth(&home);

    assert!(matches!(
        detect_opencode_slot_auth(&home, &[]),
        LocalAuthDetection::Present
    ));
    assert!(matches!(
        detect_opencode_slot_auth(&home, &["opencode-auth-json/opencode".to_string()]),
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
            discovery_kinds: Vec::new(),
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
            discovery_kinds: Vec::new(),
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
            discovery_kinds: Vec::new(),
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
            discovery_kinds: Vec::new(),
            materialization: Default::default(),
        }],
    };

    let cli_state = detect_cli_auth_state(&auth, &home);
    assert_eq!(cli_state, Some(CliAuthState::Unsupported));

    let _ = std::fs::remove_dir_all(&home);
}

#[path = "credential_ladder_tests.rs"]
mod credential_ladder;
