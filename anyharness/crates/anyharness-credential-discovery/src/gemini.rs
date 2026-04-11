use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

use serde_json::Value;
#[cfg(target_os = "macos")]
use serde_json::{Map, Number};

use crate::{
    util::{home_matches_process_home, resolve_process_override_dir},
    DiscoveryError, LocalAuthSource, LocalAuthState, PortableAuthExport, PortableAuthFile,
    PortableRelativePath,
};

const GEMINI_DIR_NAME: &str = ".gemini";
const GEMINI_OAUTH_FILE_PATH: &str = ".gemini/oauth_creds.json";
const GEMINI_SETTINGS_PATH: &str = ".gemini/settings.json";
const GEMINI_KEYCHAIN_SERVICE: &str = "gemini-cli-oauth";
const GEMINI_KEYCHAIN_ACCOUNT: &str = "main-account";
const GEMINI_AUTH_TYPE_LOGIN_WITH_GOOGLE: &str = "oauth-personal";

pub fn detect_local_auth_state(home_dir: &Path) -> Result<LocalAuthState, DiscoveryError> {
    let oauth_path = local_gemini_oauth_path(home_dir);
    tracing::debug!(path = %oauth_path.display(), "Detecting Gemini local auth state");

    if let Some(data) = read_json_file(&oauth_path)? {
        if has_google_oauth_credentials(&data) {
            tracing::debug!(path = %oauth_path.display(), "Gemini OAuth credential file detected");
            return Ok(LocalAuthState::Present(LocalAuthSource::File {
                path: oauth_path,
            }));
        }
    }

    if read_keychain_gemini_oauth(home_dir)?.is_some() {
        tracing::debug!("Gemini keychain auth detected");
        return Ok(LocalAuthState::Present(LocalAuthSource::MacOsKeychain {
            service: GEMINI_KEYCHAIN_SERVICE.to_string(),
            account: GEMINI_KEYCHAIN_ACCOUNT.to_string(),
        }));
    }

    tracing::debug!("Gemini local auth not detected");
    Ok(LocalAuthState::Absent)
}

pub fn export_portable_auth(home_dir: &Path) -> Result<Option<PortableAuthExport>, DiscoveryError> {
    let oauth_path = local_gemini_oauth_path(home_dir);
    tracing::debug!(path = %oauth_path.display(), "Exporting portable Gemini auth");

    if let Some(data) = read_json_file(&oauth_path)? {
        if has_google_oauth_credentials(&data) {
            tracing::debug!(
                path = %oauth_path.display(),
                "Portable Gemini auth will be exported from OAuth file"
            );
            return Ok(Some(portable_export(data)?));
        }
    }

    if let Some(data) = read_keychain_gemini_oauth(home_dir)? {
        tracing::debug!("Portable Gemini auth will be exported from keychain");
        return Ok(Some(portable_export(data)?));
    }

    tracing::debug!("No portable Gemini auth found");
    Ok(None)
}

fn portable_export(oauth_creds: Value) -> Result<PortableAuthExport, DiscoveryError> {
    Ok(PortableAuthExport {
        files: vec![
            PortableAuthFile {
                relative_path: portable_path(GEMINI_OAUTH_FILE_PATH),
                content: serde_json::to_vec(&oauth_creds)?,
            },
            PortableAuthFile {
                relative_path: portable_path(GEMINI_SETTINGS_PATH),
                content: serde_json::to_vec(&serde_json::json!({
                    "security": {
                        "auth": {
                            "selectedType": GEMINI_AUTH_TYPE_LOGIN_WITH_GOOGLE,
                        }
                    }
                }))?,
            },
        ],
    })
}

fn local_gemini_oauth_path(home_dir: &Path) -> PathBuf {
    resolve_gemini_home(home_dir).join("oauth_creds.json")
}

fn resolve_gemini_home(home_dir: &Path) -> PathBuf {
    let default_home = home_dir.join(GEMINI_DIR_NAME);
    resolve_process_override_dir("GEMINI_CLI_HOME", home_dir, default_home)
}

fn read_json_file(path: &Path) -> Result<Option<Value>, DiscoveryError> {
    let contents = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(DiscoveryError::Io(err)),
    };

    match serde_json::from_slice(&contents) {
        Ok(value) => Ok(Some(value)),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "Gemini auth file was not valid JSON");
            Ok(None)
        }
    }
}

fn has_google_oauth_credentials(data: &Value) -> bool {
    ["access_token", "refresh_token"]
        .iter()
        .filter_map(|field| data.get(*field).and_then(Value::as_str))
        .any(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn read_keychain_gemini_oauth(home_dir: &Path) -> Result<Option<Value>, DiscoveryError> {
    if !home_matches_process_home(home_dir) {
        tracing::debug!(
            home_dir = %home_dir.display(),
            "Skipping Gemini keychain lookup because home_dir does not match process home"
        );
        return Ok(None);
    }

    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            GEMINI_KEYCHAIN_SERVICE,
            "-a",
            GEMINI_KEYCHAIN_ACCOUNT,
            "-w",
        ])
        .output()
        .map_err(|err| DiscoveryError::Keychain(err.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::debug!(
            status = output.status.code(),
            stderr = stderr.trim(),
            "Gemini keychain entry not found via security CLI"
        );
        return Ok(None);
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(error = %err, "Gemini keychain entry was not valid JSON");
            return Ok(None);
        }
    };

    Ok(google_credentials_from_keychain_entry(&parsed))
}

#[cfg(not(target_os = "macos"))]
fn read_keychain_gemini_oauth(_home_dir: &Path) -> Result<Option<Value>, DiscoveryError> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn google_credentials_from_keychain_entry(entry: &Value) -> Option<Value> {
    // Gemini CLI stores OAuth state under entry.token.{accessToken,refreshToken,tokenType,scope,expiresAt}
    // in packages/core/src/code_assist/oauth-credential-storage.ts.
    let token = entry.get("token")?.as_object()?;
    let access_token = token.get("accessToken").and_then(Value::as_str);
    let refresh_token = token.get("refreshToken").and_then(Value::as_str);
    if access_token.is_none_or(str::is_empty) && refresh_token.is_none_or(str::is_empty) {
        return None;
    }

    let mut google_creds = Map::new();
    if let Some(value) = access_token.filter(|value| !value.is_empty()) {
        google_creds.insert("access_token".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = refresh_token.filter(|value| !value.is_empty()) {
        google_creds.insert(
            "refresh_token".to_string(),
            Value::String(value.to_string()),
        );
    }
    if let Some(value) = token
        .get("tokenType")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        google_creds.insert("token_type".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = token
        .get("scope")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        google_creds.insert("scope".to_string(), Value::String(value.to_string()));
    }
    if let Some(value) = token.get("expiresAt").and_then(Value::as_i64) {
        google_creds.insert(
            "expiry_date".to_string(),
            Value::Number(Number::from(value)),
        );
    }

    Some(Value::Object(google_creds))
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
            "anyharness-gemini-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(path.join(GEMINI_DIR_NAME)).expect("create gemini dir");
        path
    }

    #[test]
    fn detects_legacy_gemini_oauth_file() {
        let home = make_temp_home();
        fs::write(
            home.join(GEMINI_OAUTH_FILE_PATH),
            r#"{"refresh_token":"refresh-token"}"#,
        )
        .expect("write oauth creds");

        let state = detect_local_auth_state(&home).expect("detect");
        assert!(matches!(
            state,
            LocalAuthState::Present(LocalAuthSource::File { .. })
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn exports_legacy_gemini_oauth_file_with_settings() {
        let home = make_temp_home();
        fs::write(
            home.join(GEMINI_OAUTH_FILE_PATH),
            r#"{"access_token":"access","refresh_token":"refresh","token_type":"Bearer"}"#,
        )
        .expect("write oauth creds");

        let export = export_portable_auth(&home)
            .expect("export")
            .expect("portable auth");
        assert_eq!(export.files.len(), 2);
        assert_eq!(
            export.files[0].relative_path.as_str(),
            GEMINI_OAUTH_FILE_PATH
        );
        assert_eq!(export.files[1].relative_path.as_str(), GEMINI_SETTINGS_PATH);

        let settings = serde_json::from_slice::<Value>(&export.files[1].content).expect("settings");
        assert_eq!(
            settings,
            serde_json::json!({
                "security": {
                    "auth": {
                        "selectedType": GEMINI_AUTH_TYPE_LOGIN_WITH_GOOGLE,
                    }
                }
            })
        );

        let _ = fs::remove_dir_all(home);
    }
}
