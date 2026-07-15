//! Unit tests for Claude credential discovery (split from claude.rs to keep
//! the module under the repo line-count ceiling).

use std::fs;

use super::*;

fn make_temp_home() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "anyharness-credential-discovery-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&path).expect("create temp home");
    path
}

#[test]
fn detects_oauth_account_marker_for_local_readiness() {
    let home = make_temp_home();
    fs::write(
        home.join(CLAUDE_CONFIG_PATH),
        r#"{"oauthAccount":{"accountUuid":"acct-123"}}"#,
    )
    .expect("write claude config");

    let state = detect_local_auth_state(&home).expect("detect local auth");

    assert!(matches!(
        state,
        LocalAuthState::Present(LocalAuthSource::ConfigMarker {
            marker: ConfigMarkerKind::ClaudeOauthAccount,
            ..
        })
    ));

    let _ = fs::remove_dir_all(home);
}

#[test]
fn fact_kinds_preserve_every_present_credential_kind() {
    let home = make_temp_home();
    fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    fs::write(
        home.join(CLAUDE_CREDENTIALS_PATH),
        r#"{"claudeAiOauth":{"accessToken":"token"}}"#,
    )
    .expect("write oauth creds");
    fs::write(
        home.join(CLAUDE_CONFIG_PATH),
        r#"{"primaryApiKey":"sk-ant-123","oauthAccount":{"accountUuid":"acct-123"}}"#,
    )
    .expect("write claude config");

    let kinds = discovery_fact_kinds(&home).expect("fact kinds");
    assert_eq!(
        kinds,
        vec![
            "claude-config-api-key",
            "claude-oauth-creds",
            "claude-oauth-account"
        ]
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn fact_kinds_empty_when_nothing_present() {
    let home = make_temp_home();
    fs::write(
        home.join(CLAUDE_CONFIG_PATH),
        r#"{"hasCompletedOnboarding":true}"#,
    )
    .expect("write claude config");

    assert!(discovery_fact_kinds(&home).expect("fact kinds").is_empty());

    let _ = fs::remove_dir_all(home);
}

#[test]
fn oauth_account_marker_is_not_portable() {
    let home = make_temp_home();
    fs::write(
        home.join(CLAUDE_CONFIG_PATH),
        r#"{"oauthAccount":{"accountUuid":"acct-123"}}"#,
    )
    .expect("write claude config");

    let export = export_portable_auth(&home).expect("export auth");
    assert!(export.is_none());

    let _ = fs::remove_dir_all(home);
}

#[test]
fn normalizes_legacy_oauth_file_to_canonical_path() {
    let home = make_temp_home();
    fs::write(
        home.join(CLAUDE_OAUTH_CREDENTIALS_PATH),
        r#"{"claudeAiOauth":{"accessToken":"token","refreshToken":"refresh"}}"#,
    )
    .expect("write legacy oauth file");

    let export = export_portable_auth(&home)
        .expect("export auth")
        .expect("portable auth");

    assert_eq!(export.files.len(), 1);
    assert_eq!(
        export.files[0].relative_path.as_str(),
        CLAUDE_CREDENTIALS_PATH
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn exports_api_key_config_as_minimal_portable_file() {
    let home = make_temp_home();
    let contents =
        r#"{"primaryApiKey":"sk-ant-123","oauthAccount":{"accountUuid":"acct-123"}}"#;
    fs::write(home.join(CLAUDE_CONFIG_PATH), contents).expect("write claude config");

    let export = export_portable_auth(&home)
        .expect("export auth")
        .expect("portable auth");

    assert_eq!(export.files.len(), 1);
    assert_eq!(export.files[0].relative_path.as_str(), CLAUDE_CONFIG_PATH);
    assert_eq!(
        serde_json::from_slice::<Value>(&export.files[0].content).expect("parse export"),
        serde_json::json!({"primaryApiKey":"sk-ant-123"})
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn detects_expired_oauth_credential() {
    let home = make_temp_home();
    fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    // expiresAt in the past (epoch 1000ms = 1970)
    fs::write(
        home.join(CLAUDE_CREDENTIALS_PATH),
        r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":1000}}"#,
    )
    .expect("write oauth creds");

    let state = detect_local_auth_state(&home).expect("detect local auth");
    assert!(
        matches!(state, LocalAuthState::Expired(LocalAuthSource::File { .. })),
        "Expected Expired, got {:?}",
        state
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn detects_valid_oauth_credential_with_future_expiry() {
    let home = make_temp_home();
    fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    // expiresAt far in the future (year ~2060)
    fs::write(
        home.join(CLAUDE_CREDENTIALS_PATH),
        r#"{"claudeAiOauth":{"accessToken":"token","expiresAt":2840000000000}}"#,
    )
    .expect("write oauth creds");

    let state = detect_local_auth_state(&home).expect("detect local auth");
    assert!(
        matches!(state, LocalAuthState::Present(LocalAuthSource::File { .. })),
        "Expected Present, got {:?}",
        state
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn missing_expires_at_treated_as_present() {
    let home = make_temp_home();
    fs::create_dir_all(home.join(".claude")).expect("create claude dir");
    // No expiresAt field → conservative: Present
    fs::write(
        home.join(CLAUDE_CREDENTIALS_PATH),
        r#"{"claudeAiOauth":{"accessToken":"token"}}"#,
    )
    .expect("write oauth creds");

    let state = detect_local_auth_state(&home).expect("detect local auth");
    assert!(
        matches!(state, LocalAuthState::Present(LocalAuthSource::File { .. })),
        "Expected Present, got {:?}",
        state
    );

    let _ = fs::remove_dir_all(home);
}

#[test]
fn exports_api_key_sidecar_config_to_canonical_portable_path() {
    let home = make_temp_home();
    fs::write(
        home.join(CLAUDE_API_CONFIG_PATH),
        r#"{"anthropicApiKey":"sk-ant-123"}"#,
    )
    .expect("write claude api config");

    let export = export_portable_auth(&home)
        .expect("export auth")
        .expect("portable auth");

    assert_eq!(export.files.len(), 1);
    assert_eq!(export.files[0].relative_path.as_str(), CLAUDE_CONFIG_PATH);
    assert_eq!(
        serde_json::from_slice::<Value>(&export.files[0].content).expect("parse export"),
        serde_json::json!({"anthropicApiKey":"sk-ant-123"})
    );

    let _ = fs::remove_dir_all(home);
}
