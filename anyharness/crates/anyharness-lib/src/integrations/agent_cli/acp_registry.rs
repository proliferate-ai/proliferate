use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;

mod archive;
pub use archive::install_binary_archive;

const DEFAULT_ACP_REGISTRY_URL: &str =
    "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

pub(super) const CURL_CONNECT_TIMEOUT: &str = "10";
const CURL_MAX_TIME: &str = "30";

#[derive(Debug, Deserialize)]
pub struct RegistryDocument {
    pub agents: Vec<RegistryAgent>,
}

#[derive(Debug, Deserialize)]
pub struct RegistryAgent {
    pub id: String,
    pub version: Option<String>,
    pub distribution: RegistryDistribution,
}

#[derive(Debug, Deserialize)]
pub struct RegistryDistribution {
    #[serde(default)]
    pub npx: Option<RegistryNpx>,
    #[serde(default)]
    pub binary: Option<HashMap<String, RegistryBinaryTarget>>,
}

#[derive(Debug, Deserialize)]
pub struct RegistryNpx {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct RegistryBinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug)]
pub enum RegistryError {
    FetchFailed(String),
    ParseFailed(String),
    AgentNotFound(String),
    NoPlatformDistribution,
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FetchFailed(msg) => write!(f, "registry fetch failed: {msg}"),
            Self::ParseFailed(msg) => write!(f, "registry parse failed: {msg}"),
            Self::AgentNotFound(id) => write!(f, "agent '{id}' not found in registry"),
            Self::NoPlatformDistribution => {
                write!(f, "no compatible distribution for this platform")
            }
        }
    }
}

/// Resolved distribution info from the ACP registry for a single agent.
pub enum ResolvedRegistryDistribution {
    Npx {
        package: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        version: Option<String>,
    },
    Binary {
        archive_url: String,
        cmd: String,
        args: Vec<String>,
        env: HashMap<String, String>,
        version: Option<String>,
    },
}

fn registry_url() -> String {
    std::env::var("ANYHARNESS_ACP_REGISTRY_URL").unwrap_or_else(|_| DEFAULT_ACP_REGISTRY_URL.into())
}

fn current_platform_registry_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("macos", "aarch64") => Some("darwin-aarch64"),
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        ("windows", "aarch64") => Some("windows-aarch64"),
        _ => None,
    }
}

pub fn fetch_registry() -> Result<RegistryDocument, RegistryError> {
    let url = registry_url();
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            CURL_CONNECT_TIMEOUT,
            "--max-time",
            CURL_MAX_TIME,
            &url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| RegistryError::FetchFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(RegistryError::FetchFailed(if stderr.is_empty() {
            format!("curl exited with {}", output.status)
        } else {
            stderr
        }));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| RegistryError::ParseFailed(e.to_string()))
}

/// Look up an agent in the registry and resolve a compatible distribution.
pub fn resolve_from_registry(
    registry_id: &str,
    version_override: Option<&str>,
) -> Result<ResolvedRegistryDistribution, RegistryError> {
    let doc = fetch_registry()?;

    let entry = doc
        .agents
        .into_iter()
        .find(|a| a.id == registry_id)
        .ok_or_else(|| RegistryError::AgentNotFound(registry_id.into()))?;

    if let Some(npx) = entry.distribution.npx {
        let package = match version_override {
            Some(v) => apply_version_override(&npx.package, v),
            None => npx.package,
        };
        let version = version_override
            .map(String::from)
            .or(entry.version)
            .or_else(|| extract_package_version(&package));

        return Ok(ResolvedRegistryDistribution::Npx {
            package,
            args: npx.args,
            env: npx.env,
            version,
        });
    }

    if let Some(binary_map) = entry.distribution.binary {
        let key = current_platform_registry_key().ok_or(RegistryError::NoPlatformDistribution)?;
        if let Some(target) = binary_map.get(key) {
            return Ok(ResolvedRegistryDistribution::Binary {
                archive_url: target.archive.clone(),
                cmd: target.cmd.clone(),
                args: target.args.clone(),
                env: target.env.clone(),
                version: version_override.map(String::from).or(entry.version),
            });
        }
    }

    Err(RegistryError::NoPlatformDistribution)
}

/// Install an npm package into a managed directory.
pub fn install_npm_package(root: &Path, package: &str) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;

    let output = Command::new("npm")
        .args(["install", "--no-audit", "--no-fund", "--prefix"])
        .arg(root)
        .arg(package)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("npm exited with {}", output.status)
        } else {
            stderr
        });
    }
    Ok(())
}

fn apply_version_override(package: &str, version: &str) -> String {
    if let Some((name, _)) = split_package_version(package) {
        format!("{name}@{version}")
    } else {
        format!("{package}@{version}")
    }
}

fn extract_package_version(package: &str) -> Option<String> {
    split_package_version(package).map(|(_, v)| v.to_string())
}

fn split_package_version(package: &str) -> Option<(&str, &str)> {
    if let Some(stripped) = package.strip_prefix('@') {
        let idx = stripped.rfind('@')? + 1;
        let full_idx = idx + 1;
        let (name, version) = package.split_at(full_idx);
        Some((name.trim_end_matches('@'), version.trim_start_matches('@')))
    } else {
        let idx = package.rfind('@')?;
        let (name, version) = package.split_at(idx);
        Some((name, version.trim_start_matches('@')))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_version_override_to_scoped_and_unscoped_packages() {
        assert_eq!(
            apply_version_override("@scope/tool@1.0.0", "2.0.0"),
            "@scope/tool@2.0.0"
        );
        assert_eq!(
            apply_version_override("@scope/tool", "2.0.0"),
            "@scope/tool@2.0.0"
        );
        assert_eq!(
            apply_version_override("plain-tool@1.0.0", "2.0.0"),
            "plain-tool@2.0.0"
        );
        assert_eq!(
            apply_version_override("plain-tool", "2.0.0"),
            "plain-tool@2.0.0"
        );
    }

    #[test]
    fn extracts_versions_from_registry_package_specs() {
        assert_eq!(
            extract_package_version("@scope/tool@1.0.0"),
            Some("1.0.0".to_string())
        );
        assert_eq!(extract_package_version("@scope/tool"), None);
        assert_eq!(
            extract_package_version("plain-tool@1.0.0"),
            Some("1.0.0".to_string())
        );
        assert_eq!(extract_package_version("plain-tool"), None);
    }
}
