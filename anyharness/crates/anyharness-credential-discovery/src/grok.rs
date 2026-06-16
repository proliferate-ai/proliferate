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

/// `~/.grok/auth.json` is Grok's cached OAuth login store. The token lives in a
/// record keyed by a dynamic `"<issuer>::<principal>"` string, under `key`
/// (alongside `refresh_token`/`expires_at`); a flat/legacy layout may instead
/// use `access_token`/`token`. Treat the file as usable only when some record
/// carries a non-empty token — NOT merely a non-empty object, which would
/// false-positive on a config/marker-only file and report a spurious "ready".
fn has_grok_auth(data: &Value) -> bool {
    let Some(obj) = data.as_object() else {
        return false;
    };
    obj.values().any(record_has_token) || record_has_token(data)
}

fn record_has_token(value: &Value) -> bool {
    let Some(record) = value.as_object() else {
        return false;
    };
    ["key", "access_token", "token"]
        .iter()
        .filter_map(|field| record.get(*field).and_then(Value::as_str))
        .any(|token| !token.is_empty())
        || record
            .get("tokens")
            .and_then(|tokens| tokens.get("access_token"))
            .and_then(Value::as_str)
            .is_some_and(|token| !token.is_empty())
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

    // Real ~/.grok/auth.json shape: a record keyed by "<issuer>::<principal>"
    // whose access token lives under `key`.
    const GROK_AUTH_JSON: &str =
        r#"{"https://auth.x.ai::p1":{"key":"tok","refresh_token":"r","expires_at":"2030"}}"#;

    #[test]
    fn detects_issuer_keyed_token() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), GROK_AUTH_JSON).expect("write grok auth");

        assert!(matches!(
            detect_local_auth_state(&home).expect("detect"),
            LocalAuthState::Present(LocalAuthSource::File { .. })
        ));

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn detects_flat_token_fallback() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), r#"{"access_token":"token"}"#)
            .expect("write grok auth");

        assert!(matches!(
            detect_local_auth_state(&home).expect("detect"),
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
    fn absent_for_config_only_object() {
        // Non-empty file with no usable token must NOT report ready — this was
        // the false-positive under the old "any non-empty object" heuristic.
        let home = make_temp_home();
        fs::write(
            home.join(GROK_AUTH_PATH),
            r#"{"hasCompletedOnboarding":true,"https://auth.x.ai::p1":{"key":"","email":"x@y.z"}}"#,
        )
        .expect("write grok auth");

        assert_eq!(
            detect_local_auth_state(&home).expect("detect"),
            LocalAuthState::Absent
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn fact_kinds_present_for_usable_auth() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), GROK_AUTH_JSON).expect("write grok auth");

        assert_eq!(
            discovery_fact_kinds(&home).expect("fact kinds"),
            vec!["grok-auth-json-oauth"]
        );

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn exports_grok_auth_file() {
        let home = make_temp_home();
        fs::write(home.join(GROK_AUTH_PATH), GROK_AUTH_JSON).expect("write grok auth");

        let export = export_portable_auth(&home)
            .expect("export")
            .expect("portable auth");
        assert_eq!(export.files.len(), 1);
        assert_eq!(export.files[0].relative_path.as_str(), GROK_AUTH_PATH);

        let _ = fs::remove_dir_all(home);
    }
}
