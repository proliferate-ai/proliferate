use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::WorkerError;

use super::{
    default_materialization_root,
    files::{expand_home, materialization_error, write_file},
    git::validate_git_config_value,
};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureGitIdentityPayload {
    pub target_git_identity_id: String,
    pub config_version: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetGitIdentityMaterializationPlan {
    pub target_git_identity_id: String,
    pub target_id: String,
    pub config_version: i64,
    pub provider: String,
    pub access_token: String,
    pub username: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetGitIdentityOutcome {
    pub target_git_identity_id: String,
    pub target_id: String,
    pub config_version: i64,
    pub provider: String,
    pub username_present: bool,
    pub email_present: bool,
}

#[derive(Debug, Clone)]
pub struct TargetGitPaths {
    pub credentials: PathBuf,
    pub config: PathBuf,
}

pub fn parse_configure_git_identity_payload(
    payload: &serde_json::Value,
) -> Result<ConfigureGitIdentityPayload, WorkerError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        materialization_error(format!("invalid configure_git_identity payload: {error}"))
    })
}

pub fn write_target_git_identity(
    allowed_root: Option<&Path>,
    expected_config_version: i64,
    plan: &TargetGitIdentityMaterializationPlan,
) -> Result<TargetGitIdentityOutcome, WorkerError> {
    if plan.config_version != expected_config_version {
        return Err(materialization_error(format!(
            "target git identity version mismatch: expected {expected_config_version}, got {}",
            plan.config_version
        )));
    }
    if plan.provider != "github" {
        return Err(materialization_error(format!(
            "unsupported target git identity provider: {}",
            plan.provider
        )));
    }
    validate_git_config_value("accessToken", &plan.access_token)?;
    let paths = target_git_paths(allowed_root)?;
    let credentials = format!("https://x-access-token:{}@github.com\n", plan.access_token);
    write_file(&paths.credentials, credentials.as_bytes(), true)?;
    let mut config = String::new();
    if let Some(username) = plan.username.as_deref().filter(|value| !value.is_empty()) {
        validate_git_config_value("username", username)?;
        config.push_str("[user]\n");
        config.push_str("\tname = ");
        config.push_str(username);
        config.push('\n');
    }
    if let Some(email) = plan.email.as_deref().filter(|value| !value.is_empty()) {
        validate_git_config_value("email", email)?;
        if !config.contains("[user]") {
            config.push_str("[user]\n");
        }
        config.push_str("\temail = ");
        config.push_str(email);
        config.push('\n');
    }
    config.push_str("[credential]\n");
    config.push_str("\thelper = store --file=");
    config.push_str(&paths.credentials.to_string_lossy());
    config.push('\n');
    write_file(&paths.config, config.as_bytes(), true)?;
    Ok(TargetGitIdentityOutcome {
        target_git_identity_id: plan.target_git_identity_id.clone(),
        target_id: plan.target_id.clone(),
        config_version: plan.config_version,
        provider: plan.provider.clone(),
        username_present: plan
            .username
            .as_deref()
            .is_some_and(|value| !value.is_empty()),
        email_present: plan.email.as_deref().is_some_and(|value| !value.is_empty()),
    })
}

pub fn target_git_paths(allowed_root: Option<&Path>) -> Result<TargetGitPaths, WorkerError> {
    let root = allowed_root
        .map(Path::to_path_buf)
        .unwrap_or_else(default_materialization_root);
    let root = root
        .to_str()
        .map(expand_home)
        .unwrap_or_else(|| root.to_path_buf());
    std::fs::create_dir_all(&root).map_err(|source| WorkerError::CreateParent {
        path: root.clone(),
        source,
    })?;
    let root = root
        .canonicalize()
        .map_err(|source| WorkerError::CreateParent {
            path: root.clone(),
            source,
        })?;
    let git_root = root.join(".proliferate").join("target-git");
    Ok(TargetGitPaths {
        credentials: git_root.join("credentials"),
        config: git_root.join("gitconfig"),
    })
}
