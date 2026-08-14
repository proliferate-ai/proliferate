use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::AppStateInitError;
use crate::api::auth::AuthManager;
use crate::domains::agent_operations::model::RuntimeIdentity;

pub(super) fn runtime_identity(auth_manager: &AuthManager, runtime_home: &Path) -> RuntimeIdentity {
    if let Some(target_id) = auth_manager.runtime_target_id() {
        return RuntimeIdentity::new(target_id);
    }
    // Direct local runtimes have no managed target id. Hash the canonical
    // runtime-home identity so the fallback is stable without exposing a host
    // filesystem path through Workspace MCP responses.
    let stable_home = std::fs::canonicalize(runtime_home)
        .unwrap_or_else(|_| runtime_home.to_path_buf())
        .to_string_lossy()
        .into_owned();
    RuntimeIdentity::new(format!(
        "local:{:x}",
        Sha256::digest(stable_home.as_bytes())
    ))
}

pub(super) fn load_runtime_target_id() -> Option<String> {
    std::env::var("ANYHARNESS_RUNTIME_TARGET_ID")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(super) fn load_bearer_token(
    require_bearer_auth: bool,
) -> Result<Option<String>, AppStateInitError> {
    let bearer_token = std::env::var("ANYHARNESS_BEARER_TOKEN")
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| !token.is_empty());

    if require_bearer_auth && bearer_token.is_none() {
        tracing::error!(
            "Bearer authentication required, but ANYHARNESS_BEARER_TOKEN is missing or empty"
        );
        return Err(AppStateInitError::MissingBearerToken);
    }

    match bearer_token.as_ref() {
        Some(_) => tracing::info!("Bearer authentication enabled"),
        None => tracing::warn!(
            "Bearer authentication disabled because ANYHARNESS_BEARER_TOKEN is not configured"
        ),
    }

    Ok(bearer_token)
}

pub fn default_runtime_home() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    let dir = proliferate_home_dir_name(cfg!(debug_assertions));
    PathBuf::from(home).join(dir).join("anyharness")
}

pub(super) fn proliferate_home_dir_name(debug_build: bool) -> &'static str {
    if std::env::var_os("PROLIFERATE_DEV").is_some() || debug_build {
        ".proliferate-local"
    } else {
        ".proliferate"
    }
}

pub fn ensure_runtime_home(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    std::fs::create_dir_all(path.join("agents"))?;
    std::fs::create_dir_all(path.join("logs"))?;
    std::fs::create_dir_all(path.join("secrets"))?;
    std::fs::create_dir_all(path.join("tmp"))?;
    Ok(())
}
