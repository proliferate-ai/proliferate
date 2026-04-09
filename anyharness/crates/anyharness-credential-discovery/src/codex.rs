use std::path::Path;

use serde_json::Value;

use crate::{
    DiscoveryError, LocalAuthSource, LocalAuthState, PortableAuthExport, PortableAuthFile,
    PortableRelativePath,
};

const CODEX_AUTH_PATH: &str = ".codex/auth.json";

pub fn detect_local_auth_state(home_dir: &Path) -> Result<LocalAuthState, DiscoveryError> {
    let path = home_dir.join(CODEX_AUTH_PATH);
    tracing::debug!(path = %path.display(), "Detecting Codex local auth state");
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
    let path = home_dir.join(CODEX_AUTH_PATH);
    tracing::debug!(path = %path.display(), "Exporting portable Codex auth");
    let Some(data) = read_json_file(&path)? else {
        return Ok(None);
    };

    if !has_codex_auth(&data) {
        tracing::debug!(path = %path.display(), "Codex auth file is not portable");
        return Ok(None);
    }

    tracing::debug!(path = %path.display(), "Portable Codex auth detected");
    Ok(Some(PortableAuthExport {
        files: vec![PortableAuthFile {
            relative_path: portable_path(CODEX_AUTH_PATH),
            content: serde_json::to_vec(&data)?,
        }],
    }))
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
        fs::write(
            home.join(CODEX_AUTH_PATH),
            r#"{"OPENAI_API_KEY":"sk-test"}"#,
        )
        .expect("write codex auth");

        let export = export_portable_auth(&home)
            .expect("export")
            .expect("portable auth");
        assert_eq!(export.files.len(), 1);
        assert_eq!(export.files[0].relative_path.as_str(), CODEX_AUTH_PATH);

        let _ = fs::remove_dir_all(home);
    }
}
