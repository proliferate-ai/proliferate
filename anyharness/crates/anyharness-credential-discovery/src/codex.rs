use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

use serde_json::Value;
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};

use crate::{
    util::{home_matches_process_home, resolve_process_override_dir},
    DiscoveryError, LocalAuthSource, LocalAuthState, PortableAuthExport, PortableAuthFile,
    PortableRelativePath,
};

const CODEX_AUTH_PATH: &str = ".codex/auth.json";
const CODEX_KEYCHAIN_SERVICE: &str = "Codex Auth";

pub fn detect_local_auth_state(home_dir: &Path) -> Result<LocalAuthState, DiscoveryError> {
    let path = local_codex_auth_path(home_dir);
    tracing::debug!(path = %path.display(), "Detecting Codex local auth state");

    if let Some((account, _data)) = read_keychain_codex_auth(home_dir)? {
        tracing::debug!(account, "Codex keychain auth detected");
        return Ok(LocalAuthState::Present(LocalAuthSource::MacOsKeychain {
            service: CODEX_KEYCHAIN_SERVICE.to_string(),
            account,
        }));
    }

    let Some(data) = read_json_file(&path)? else {
        tracing::debug!(path = %path.display(), "Codex auth file not found");
        return Ok(LocalAuthState::Absent);
    };

    if has_codex_auth(&data) {
        tracing::debug!(path = %path.display(), "Codex auth file detected");
        return Ok(LocalAuthState::Present(LocalAuthSource::File { path }));
    }

    tracing::debug!(path = %path.display(), "Codex auth file present but missing usable auth");
    Ok(LocalAuthState::Absent)
}

pub fn export_portable_auth(home_dir: &Path) -> Result<Option<PortableAuthExport>, DiscoveryError> {
    let path = local_codex_auth_path(home_dir);
    tracing::debug!(path = %path.display(), "Exporting portable Codex auth");

    if let Some((account, data)) = read_keychain_codex_auth(home_dir)? {
        tracing::debug!(account, "Portable Codex auth detected in keychain");
        return Ok(Some(portable_export(&data)?));
    }

    let Some(data) = read_json_file(&path)? else {
        return Ok(None);
    };

    if !has_codex_auth(&data) {
        tracing::debug!(path = %path.display(), "Codex auth file is not portable");
        return Ok(None);
    }

    tracing::debug!(path = %path.display(), "Portable Codex auth detected");
    Ok(Some(portable_export(&data)?))
}

fn portable_export(data: &Value) -> Result<PortableAuthExport, DiscoveryError> {
    Ok(PortableAuthExport {
        files: vec![PortableAuthFile {
            relative_path: portable_path(CODEX_AUTH_PATH),
            content: serde_json::to_vec(data)?,
        }],
    })
}

fn local_codex_auth_path(home_dir: &Path) -> PathBuf {
    resolve_codex_home(home_dir).join("auth.json")
}

fn resolve_codex_home(home_dir: &Path) -> PathBuf {
    let default_home = home_dir.join(".codex");
    resolve_process_override_dir("CODEX_HOME", home_dir, default_home)
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
            tracing::warn!(path = %path.display(), error = %err, "Codex auth file was not valid JSON");
            Ok(None)
        }
    }
}

fn has_codex_auth(data: &Value) -> bool {
    data.get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
        || data
            .pointer("/tokens/access_token")
            .and_then(Value::as_str)
            .map(|value| !value.is_empty())
            .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn read_keychain_codex_auth(home_dir: &Path) -> Result<Option<(String, Value)>, DiscoveryError> {
    if !home_matches_process_home(home_dir) {
        tracing::debug!(
            home_dir = %home_dir.display(),
            "Skipping Codex keychain lookup because home_dir does not match process home"
        );
        return Ok(None);
    }

    let codex_home = resolve_codex_home(home_dir);
    let account = codex_keychain_account(&codex_home);
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            CODEX_KEYCHAIN_SERVICE,
            "-a",
            &account,
            "-w",
        ])
        .output()
        .map_err(|err| DiscoveryError::Keychain(err.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::debug!(
            account,
            status = output.status.code(),
            stderr = stderr.trim(),
            "Codex keychain entry not found via security CLI"
        );
        return Ok(None);
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(account, error = %err, "Codex keychain entry was not valid JSON");
            return Ok(None);
        }
    };

    if !has_codex_auth(&parsed) {
        tracing::debug!(account, "Codex keychain entry did not contain usable auth");
        return Ok(None);
    }

    Ok(Some((account, parsed)))
}

#[cfg(not(target_os = "macos"))]
fn read_keychain_codex_auth(
    _home_dir: &Path,
) -> Result<Option<(String, Value)>, DiscoveryError> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn codex_keychain_account(codex_home: &Path) -> String {
    let canonical = codex_home
        .canonicalize()
        .unwrap_or_else(|_| codex_home.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    let truncated = hex.get(..16).unwrap_or(&hex);
    format!("cli|{truncated}")
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
            "anyharness-codex-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(path.join(".codex")).expect("create codex dir");
        path
    }

    #[test]
    fn detects_codex_auth_file() {
        let home = make_temp_home();
        fs::write(
            home.join(CODEX_AUTH_PATH),
            r#"{"tokens":{"access_token":"token"}}"#,
        )
        .expect("write codex auth");

        let state = detect_local_auth_state(&home).expect("detect");
        assert!(matches!(
            state,
            LocalAuthState::Present(LocalAuthSource::File { .. })
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn exports_codex_auth_file() {
        let home = make_temp_home();
        fs::write(home.join(CODEX_AUTH_PATH), r#"{"OPENAI_API_KEY":"sk-test"}"#)
            .expect("write codex auth");

        let export = export_portable_auth(&home)
            .expect("export")
            .expect("portable auth");
        assert_eq!(export.files.len(), 1);
        assert_eq!(export.files[0].relative_path.as_str(), CODEX_AUTH_PATH);

        let _ = fs::remove_dir_all(home);
    }
}
