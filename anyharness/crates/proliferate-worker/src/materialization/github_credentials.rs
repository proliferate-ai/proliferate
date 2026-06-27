use std::{fs, path::PathBuf, process::Command};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    cloud_client::github_credentials::{
        GitHubCredentialLeaseRequest, GitHubCredentialLeaseResponse,
    },
    error::WorkerError,
};

use super::files::{materialization_error, write_file};

const REFRESH_SKEW_MINUTES: i64 = 10;
const PROVIDER: &str = "github";
const TOKEN_KIND: &str = "github_app_user_to_server";

#[derive(Debug, Clone)]
pub struct GitHubCredentialPaths {
    pub root: PathBuf,
    pub token: PathBuf,
    pub meta: PathBuf,
    pub helper: PathBuf,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCredentialMeta {
    pub provider: String,
    pub token_kind: String,
    pub actor_login: Option<String>,
    pub actor_id: Option<String>,
    pub lease_id: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub refresh_after: DateTime<Utc>,
}

pub fn credential_paths() -> GitHubCredentialPaths {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let proliferate_root = home.join(".proliferate");
    GitHubCredentialPaths {
        root: proliferate_root.join("git").join("github.com"),
        token: proliferate_root
            .join("git")
            .join("github.com")
            .join("token"),
        meta: proliferate_root
            .join("git")
            .join("github.com")
            .join("meta.json"),
        helper: proliferate_root
            .join("bin")
            .join("proliferate-git-credential-helper"),
    }
}

pub fn current_lease_request() -> Result<GitHubCredentialLeaseRequest, WorkerError> {
    let meta = read_meta().unwrap_or(None);
    Ok(GitHubCredentialLeaseRequest {
        current_lease_id: meta.as_ref().map(|value| value.lease_id.clone()),
        current_expires_at: meta.as_ref().map(|value| value.expires_at),
    })
}

pub fn lease_is_fresh() -> Result<bool, WorkerError> {
    let Some(meta) = read_meta().unwrap_or(None) else {
        return Ok(false);
    };
    if meta.provider != PROVIDER || meta.token_kind != TOKEN_KIND {
        return Ok(false);
    }
    let paths = credential_paths();
    let Ok(token) = fs::read_to_string(&paths.token) else {
        return Ok(false);
    };
    if token.trim().is_empty() {
        return Ok(false);
    }
    let now = Utc::now();
    Ok(now < meta.refresh_after && now + Duration::minutes(REFRESH_SKEW_MINUTES) < meta.expires_at)
}

pub fn read_meta() -> Result<Option<GitHubCredentialMeta>, WorkerError> {
    let paths = credential_paths();
    match fs::read(&paths.meta) {
        Ok(contents) => serde_json::from_slice(&contents)
            .map(Some)
            .map_err(WorkerError::Json),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(WorkerError::ReadConfig {
            path: paths.meta,
            source,
        }),
    }
}

pub fn write_lease(lease: &GitHubCredentialLeaseResponse) -> Result<(), WorkerError> {
    if lease.provider != PROVIDER {
        return Err(materialization_error(format!(
            "unsupported git credential provider: {}",
            lease.provider
        )));
    }
    if lease.token_kind != TOKEN_KIND {
        return Err(materialization_error(format!(
            "unsupported git credential token kind: {}",
            lease.token_kind
        )));
    }
    validate_secret("accessToken", &lease.access_token)?;
    let paths = credential_paths();
    std::fs::create_dir_all(&paths.root).map_err(|source| WorkerError::CreateParent {
        path: paths.root.clone(),
        source,
    })?;
    write_file(
        &paths.token,
        format!("{}\n", lease.access_token).as_bytes(),
        true,
    )?;
    let meta = GitHubCredentialMeta {
        provider: lease.provider.clone(),
        token_kind: lease.token_kind.clone(),
        actor_login: lease.actor_login.clone(),
        actor_id: lease.actor_id.clone(),
        lease_id: lease.lease_id.clone(),
        issued_at: lease.issued_at,
        expires_at: lease.expires_at,
        refresh_after: lease.refresh_after,
    };
    write_file(&paths.meta, &serde_json::to_vec_pretty(&meta)?, true)
}

pub fn ensure_global_git_config() -> Result<(), WorkerError> {
    let paths = credential_paths();
    if !paths.helper.is_file() {
        return Err(materialization_error(format!(
            "git credential helper is missing: {}",
            paths.helper.display()
        )));
    }
    run_git_config(&[
        "--global",
        "--replace-all",
        "credential.https://github.com.helper",
        &format!("!{}", paths.helper.to_string_lossy()),
    ])?;
    ensure_git_config_value("url.https://github.com/.insteadOf", "git@github.com:")?;
    ensure_git_config_value("url.https://github.com/.insteadOf", "ssh://git@github.com/")
}

fn ensure_git_config_value(key: &str, value: &str) -> Result<(), WorkerError> {
    let values = git_config_values(key)?;
    if values.iter().any(|existing| existing == value) {
        return Ok(());
    }
    run_git_config(&["--global", "--add", key, value])
}

fn git_config_values(key: &str) -> Result<Vec<String>, WorkerError> {
    let output = Command::new("git")
        .args(["config", "--global", "--get-all", key])
        .output()
        .map_err(|source| {
            materialization_error(format!("failed to execute git config for {key}: {source}"))
        })?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn run_git_config(args: &[&str]) -> Result<(), WorkerError> {
    let status = Command::new("git")
        .arg("config")
        .args(args)
        .status()
        .map_err(|source| {
            materialization_error(format!("failed to execute git config: {source}"))
        })?;
    if status.success() {
        return Ok(());
    }
    Err(materialization_error(format!(
        "git config failed with status {status}"
    )))
}

fn validate_secret(field: &str, value: &str) -> Result<(), WorkerError> {
    if value.trim().is_empty() || value.chars().any(|ch| ch.is_control()) {
        return Err(materialization_error(format!(
            "git credential {field} is invalid"
        )));
    }
    Ok(())
}
