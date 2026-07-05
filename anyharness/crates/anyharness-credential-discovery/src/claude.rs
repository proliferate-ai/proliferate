use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::{
    ConfigMarkerKind, DiscoveryError, LocalAuthSource, LocalAuthState, PortableAuthExport,
    PortableAuthFile, PortableRelativePath,
};

const CLAUDE_CREDENTIALS_PATH: &str = ".claude/.credentials.json";
const CLAUDE_CONFIG_PATH: &str = ".claude.json";
const CLAUDE_API_CONFIG_PATH: &str = ".claude.json.api";
const CLAUDE_OAUTH_CREDENTIALS_PATH: &str = ".claude-oauth-credentials.json";
#[cfg(target_os = "macos")]
const CLAUDE_KEYCHAIN_SERVICES: &[&str] = &["Claude Code-credentials", "Claude Code"];
const CLAUDE_KEYCHAIN_ROOT_KEY: &str = "claudeAiOauth";

pub fn detect_local_auth_state(home_dir: &Path) -> Result<LocalAuthState, DiscoveryError> {
    tracing::debug!(home_dir = %home_dir.display(), "Detecting Claude local auth state");
    let api_config_paths = [
        home_dir.join(CLAUDE_API_CONFIG_PATH),
        home_dir.join(CLAUDE_CONFIG_PATH),
    ];
    for path in api_config_paths {
        tracing::debug!(path = %path.display(), "Checking Claude API config file");
        if let Some(data) = read_json_file(&path)? {
            if has_claude_api_key(&data) {
                tracing::debug!(path = %path.display(), "Claude API key config detected");
                return Ok(LocalAuthState::Present(LocalAuthSource::File { path }));
            }
        }
    }

    let oauth_paths = [
        home_dir.join(CLAUDE_CREDENTIALS_PATH),
        home_dir.join(CLAUDE_OAUTH_CREDENTIALS_PATH),
    ];
    for path in oauth_paths {
        tracing::debug!(path = %path.display(), "Checking Claude OAuth credential file");
        if let Some(data) = read_json_file(&path)? {
            if has_claude_oauth_payload(&data) {
                let source = LocalAuthSource::File { path };
                if is_oauth_expired(&data) {
                    tracing::debug!("Claude OAuth credential expired");
                    return Ok(LocalAuthState::Expired(source));
                }
                tracing::debug!("Claude OAuth credential file detected");
                return Ok(LocalAuthState::Present(source));
            }
        }
    }

    if let Some((service, account, oauth)) = read_keychain_claude_oauth(home_dir)? {
        tracing::debug!(service, account, "Claude keychain auth detected");
        let source = LocalAuthSource::MacOsKeychain { service, account };
        if is_oauth_expired(&serde_json::json!({ CLAUDE_KEYCHAIN_ROOT_KEY: oauth })) {
            tracing::debug!("Claude keychain OAuth credential expired");
            return Ok(LocalAuthState::Expired(source));
        }
        return Ok(LocalAuthState::Present(source));
    }

    let config_path = home_dir.join(CLAUDE_CONFIG_PATH);
    if let Some(data) = read_json_file(&config_path)? {
        if has_oauth_account_marker(&data) {
            tracing::debug!(
                path = %config_path.display(),
                "Claude oauthAccount marker detected for local readiness"
            );
            return Ok(LocalAuthState::Present(LocalAuthSource::ConfigMarker {
                path: config_path,
                marker: ConfigMarkerKind::ClaudeOauthAccount,
            }));
        }
    }

    tracing::debug!("Claude local auth not detected");
    Ok(LocalAuthState::Absent)
}

/// Kind-preserving fact detection: emits EVERY present claude credential
/// kind (facts, never verdicts — unlike `detect_local_auth_state`, which is
/// first-match). The kinds reuse exactly the checks above:
/// `has_claude_api_key` → `claude-config-api-key`, `has_claude_oauth_payload`
/// → `claude-oauth-creds`, the keychain lookup → `claude-keychain`, and
/// `has_oauth_account_marker` → `claude-oauth-account`.
pub(crate) fn discovery_fact_kinds(home_dir: &Path) -> Result<Vec<&'static str>, DiscoveryError> {
    let mut kinds = Vec::new();

    let api_config_paths = [
        home_dir.join(CLAUDE_API_CONFIG_PATH),
        home_dir.join(CLAUDE_CONFIG_PATH),
    ];
    for path in api_config_paths {
        if let Some(data) = read_json_file(&path)? {
            if has_claude_api_key(&data) {
                kinds.push(crate::facts::fact_kinds::CLAUDE_CONFIG_API_KEY);
                break;
            }
        }
    }

    let oauth_paths = [
        home_dir.join(CLAUDE_CREDENTIALS_PATH),
        home_dir.join(CLAUDE_OAUTH_CREDENTIALS_PATH),
    ];
    for path in oauth_paths {
        if let Some(data) = read_json_file(&path)? {
            if has_claude_oauth_payload(&data) {
                kinds.push(crate::facts::fact_kinds::CLAUDE_OAUTH_CREDS);
                break;
            }
        }
    }

    if read_keychain_claude_oauth(home_dir)?.is_some() {
        kinds.push(crate::facts::fact_kinds::CLAUDE_KEYCHAIN);
    }

    if let Some(data) = read_json_file(&home_dir.join(CLAUDE_CONFIG_PATH))? {
        if has_oauth_account_marker(&data) {
            kinds.push(crate::facts::fact_kinds::CLAUDE_OAUTH_ACCOUNT);
        }
    }

    Ok(kinds)
}

pub fn export_portable_auth(home_dir: &Path) -> Result<Option<PortableAuthExport>, DiscoveryError> {
    tracing::debug!(home_dir = %home_dir.display(), "Exporting portable Claude auth");
    let oauth_paths = [
        home_dir.join(CLAUDE_CREDENTIALS_PATH),
        home_dir.join(CLAUDE_OAUTH_CREDENTIALS_PATH),
    ];
    for path in oauth_paths {
        tracing::debug!(path = %path.display(), "Checking Claude OAuth file for portable export");
        if let Some(data) = read_json_file(&path)? {
            if let Some(oauth) = extract_oauth_payload(&data) {
                tracing::debug!(
                    path = %path.display(),
                    "Portable Claude auth will be exported from OAuth file"
                );
                return Ok(Some(PortableAuthExport {
                    files: vec![PortableAuthFile {
                        relative_path: portable_path(CLAUDE_CREDENTIALS_PATH),
                        content: serde_json::to_vec(&serde_json::json!({
                            CLAUDE_KEYCHAIN_ROOT_KEY: oauth
                        }))?,
                    }],
                }));
            }
        }
    }

    if let Some((service, account, oauth)) = read_keychain_claude_oauth(home_dir)? {
        tracing::debug!(
            service,
            account,
            "Portable Claude auth will be exported from keychain"
        );
        return Ok(Some(PortableAuthExport {
            files: vec![PortableAuthFile {
                relative_path: portable_path(CLAUDE_CREDENTIALS_PATH),
                content: serde_json::to_vec(&serde_json::json!({
                    CLAUDE_KEYCHAIN_ROOT_KEY: oauth
                }))?,
            }],
        }));
    }

    let api_config_paths = [
        home_dir.join(CLAUDE_API_CONFIG_PATH),
        home_dir.join(CLAUDE_CONFIG_PATH),
    ];
    for path in api_config_paths {
        tracing::debug!(path = %path.display(), "Checking Claude API config for portable export");
        if let Some(data) = read_json_file(&path)? {
            if let Some(export_data) = extract_portable_api_key_config(&data) {
                tracing::debug!(
                    path = %path.display(),
                    "Portable Claude auth will be exported from API key config"
                );
                return Ok(Some(PortableAuthExport {
                    files: vec![PortableAuthFile {
                        relative_path: portable_path(CLAUDE_CONFIG_PATH),
                        content: serde_json::to_vec(&export_data)?,
                    }],
                }));
            }
        }
    }

    tracing::debug!("No portable Claude auth found");
    Ok(None)
}

fn read_json_file(path: &Path) -> Result<Option<Value>, DiscoveryError> {
    let contents = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            tracing::debug!(path = %path.display(), "Credential file not found");
            return Ok(None);
        }
        Err(err) => return Err(DiscoveryError::Io(err)),
    };

    match serde_json::from_slice(&contents) {
        Ok(value) => Ok(Some(value)),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Credential file was not valid JSON");
            Ok(None)
        }
    }
}

fn has_claude_api_key(data: &Value) -> bool {
    ["primaryApiKey", "apiKey", "anthropicApiKey", "customApiKey"]
        .iter()
        .filter_map(|field| data.get(*field).and_then(Value::as_str))
        .any(|value| value.starts_with("sk-ant-"))
}

fn extract_portable_api_key_config(data: &Value) -> Option<Value> {
    let mut portable = serde_json::Map::new();
    for field in ["primaryApiKey", "apiKey", "anthropicApiKey", "customApiKey"] {
        let Some(value) = data.get(field).and_then(Value::as_str) else {
            continue;
        };
        if value.starts_with("sk-ant-") {
            portable.insert(field.to_string(), Value::String(value.to_string()));
        }
    }

    if portable.is_empty() {
        return None;
    }

    Some(Value::Object(portable))
}

fn has_oauth_account_marker(data: &Value) -> bool {
    data.pointer("/oauthAccount/accountUuid")
        .and_then(Value::as_str)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn has_claude_oauth_payload(data: &Value) -> bool {
    extract_oauth_payload(data)
        .and_then(|oauth| oauth.get("accessToken"))
        .and_then(Value::as_str)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn extract_oauth_payload(data: &Value) -> Option<&Value> {
    data.get(CLAUDE_KEYCHAIN_ROOT_KEY)
        .filter(|oauth| oauth.is_object())
}

/// Returns true if the OAuth payload has an `expiresAt` field (ms epoch) that
/// is in the past. Missing or non-numeric `expiresAt` → not expired (conservative).
fn is_oauth_expired(data: &Value) -> bool {
    let Some(oauth) = extract_oauth_payload(data) else {
        return false;
    };
    let Some(expires_at_ms) = oauth.get("expiresAt").and_then(Value::as_u64) else {
        return false;
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    expires_at_ms <= now_ms
}

#[cfg(target_os = "macos")]
fn read_keychain_claude_oauth(
    home_dir: &Path,
) -> Result<Option<(String, String, Value)>, DiscoveryError> {
    if !home_matches_process_home(home_dir) {
        tracing::debug!(
            home_dir = %home_dir.display(),
            "Skipping Claude keychain lookup because home_dir does not match process home"
        );
        return Ok(None);
    }

    let accounts = username_candidates(home_dir);
    tracing::debug!(accounts = ?accounts, "Checking Claude keychain account candidates");
    for service in CLAUDE_KEYCHAIN_SERVICES {
        for account in &accounts {
            tracing::debug!(service, account, "Checking Claude keychain entry");
            let output = Command::new("security")
                .args(["find-generic-password", "-s", service, "-a", account, "-w"])
                .output()
                .map_err(|err| DiscoveryError::Keychain(err.to_string()))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::debug!(
                    service,
                    account,
                    status = output.status.code(),
                    stderr = stderr.trim(),
                    "Claude keychain entry not found via security CLI"
                );
                continue;
            }
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parsed: Value = match serde_json::from_str(&raw) {
                Ok(value) => value,
                Err(err) => {
                    tracing::warn!(service, account, error = %err, "Claude keychain entry was not valid JSON");
                    continue;
                }
            };
            if let Some(oauth) = extract_oauth_payload(&parsed) {
                return Ok(Some((
                    (*service).to_string(),
                    account.clone(),
                    oauth.clone(),
                )));
            }
            tracing::debug!(
                service,
                account,
                "Claude keychain entry did not contain claudeAiOauth"
            );
        }
    }

    Ok(None)
}

#[cfg(not(target_os = "macos"))]
fn read_keychain_claude_oauth(
    _home_dir: &Path,
) -> Result<Option<(String, String, Value)>, DiscoveryError> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn username_candidates(home_dir: &Path) -> Vec<String> {
    let mut values = Vec::new();
    for key in ["USER", "LOGNAME", "USERNAME"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() && !values.contains(&value) {
                values.push(value);
            }
        }
    }
    if let Some(home_name) = home_dir.file_name().and_then(|name| name.to_str()) {
        let home_name = home_name.to_string();
        if !home_name.is_empty() && !values.contains(&home_name) {
            values.push(home_name);
        }
    }
    values
}

#[cfg(target_os = "macos")]
fn home_matches_process_home(home_dir: &Path) -> bool {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            if Path::new(&value) == home_dir {
                return true;
            }
        }
    }
    false
}

fn portable_path(value: &str) -> PortableRelativePath {
    PortableRelativePath::new(value.to_string()).expect("portable auth paths are static")
}

#[cfg(test)]
mod tests {
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
}
