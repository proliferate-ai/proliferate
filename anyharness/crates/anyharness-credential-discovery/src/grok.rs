use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{
    DiscoveryError, LocalAuthSource, LocalAuthState, PortableAuthExport, PortableAuthFile,
    PortableRelativePath,
};

const GROK_AUTH_PATH: &str = ".grok/auth.json";

pub fn detect_local_auth_state(home_dir: &Path) -> Result<LocalAuthState, DiscoveryError> {
    let path = local_grok_auth_path(home_dir);
    tracing::debug!(path = %path.display(), "Detecting Grok local auth state");

    let Some(data) = read_json_file(&path)? else {
        tracing::debug!(path = %path.display(), "Grok auth file not found");
        return Ok(LocalAuthState::Absent);
    };

    if has_grok_auth(&data) {
        tracing::debug!(path = %path.display(), "Grok auth file detected");
        return Ok(LocalAuthState::Present(LocalAuthSource::File { path }));
    }

    tracing::debug!(path = %path.display(), "Grok auth file present but empty");
    Ok(LocalAuthState::Absent)
}

pub fn export_portable_auth(home_dir: &Path) -> Result<Option<PortableAuthExport>, DiscoveryError> {
    let path = local_grok_auth_path(home_dir);
    tracing::debug!(path = %path.display(), "Exporting portable Grok auth");

    let Some(data) = read_json_file(&path)? else {
        return Ok(None);
    };

    if !has_grok_auth(&data) {
        tracing::debug!(path = %path.display(), "Grok auth file is not portable");
        return Ok(None);
    }

    tracing::debug!(path = %path.display(), "Portable Grok auth detected");
    Ok(Some(PortableAuthExport {
        files: vec![PortableAuthFile {
            relative_path: portable_path(GROK_AUTH_PATH),
            content: serde_json::to_vec(&data)?,
        }],
    }))
}

/// Kind-preserving fact detection: emits `grok-auth-json-oauth` when a usable
/// cached login token exists in `~/.grok/auth.json`. (`XAI_API_KEY` is an env
/// credential, not a file fact, so it is not surfaced here.)
pub(crate) fn discovery_fact_kinds(home_dir: &Path) -> Result<Vec<&'static str>, DiscoveryError> {
    let mut kinds = Vec::new();

    if let Some(data) = read_json_file(&local_grok_auth_path(home_dir))? {
        if has_grok_auth(&data) {
            kinds.push(crate::facts::fact_kinds::GROK_AUTH_JSON_OAUTH);
        }
    }

    Ok(kinds)
}

fn local_grok_auth_path(home_dir: &Path) -> PathBuf {
    home_dir.join(".grok").join("auth.json")
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
            tracing::warn!(path = %path.display(), error = %err, "Grok auth file was not valid JSON");
            Ok(None)
        }
    }
}

/// `~/.grok/auth.json` is Grok's cached login-token store (the ACP
/// `cached_token` auth method). The exact field layout is internal to the Grok
/// CLI, so any non-empty JSON object is treated as a usable login.
fn has_grok_auth(data: &Value) -> bool {
    data.as_object().map(|obj| !obj.is_empty()).unwrap_or(false)
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
            "anyharness-grok-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(path.join(".grok")).expect("create grok dir");
        path
    }

    #[test]
    fn detects_grok_auth_file() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), r#"{"access_token":"token"}"#)
            .expect("write grok auth");

        let state = detect_local_auth_state(&home).expect("detect");
        assert!(matches!(
            state,
            LocalAuthState::Present(LocalAuthSource::File { .. })
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn absent_when_auth_file_missing() {
        let home = make_temp_home();

        assert_eq!(
            detect_local_auth_state(&home).expect("detect"),
            LocalAuthState::Absent
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn absent_for_empty_object() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), r#"{}"#).expect("write grok auth");

        assert_eq!(
            detect_local_auth_state(&home).expect("detect"),
            LocalAuthState::Absent
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn fact_kinds_present_for_usable_auth() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), r#"{"access_token":"token"}"#)
            .expect("write grok auth");

        assert_eq!(
            discovery_fact_kinds(&home).expect("fact kinds"),
            vec!["grok-auth-json-oauth"]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn exports_grok_auth_file() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), r#"{"access_token":"token"}"#)
            .expect("write grok auth");

        let export = export_portable_auth(&home)
            .expect("export")
            .expect("portable auth");
        assert_eq!(export.files.len(), 1);
        assert_eq!(export.files[0].relative_path.as_str(), GROK_AUTH_PATH);

        let _ = fs::remove_dir_all(home);
    }
}
