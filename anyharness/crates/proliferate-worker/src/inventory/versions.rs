use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionReport {
    pub worker_version: String,
    pub node_version: Option<String>,
    pub npm_version: Option<String>,
    pub pnpm_version: Option<String>,
    pub python_version: Option<String>,
    pub uv_version: Option<String>,
    pub git_version: Option<String>,
    pub docker_version: Option<String>,
}

pub async fn probe_versions() -> VersionReport {
    VersionReport {
        worker_version: env!("CARGO_PKG_VERSION").to_string(),
        node_version: run_version("node", &["--version"]).await,
        npm_version: run_version("npm", &["--version"]).await,
        pnpm_version: run_version("pnpm", &["--version"]).await,
        python_version: run_version("python3", &["--version"]).await,
        uv_version: run_version("uv", &["--version"]).await,
        git_version: run_version("git", &["--version"]).await,
        docker_version: run_version("docker", &["--version"]).await,
    }
}

pub async fn command_available(command: &str) -> bool {
    run_version(command, &["--version"]).await.is_some()
}

pub async fn run_version(command: &str, args: &[&str]) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        Command::new(command)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .ok()?
    .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    Some(text.trim().lines().next().unwrap_or_default().to_string())
}
