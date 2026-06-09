use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryDocument {
    pub schema_version: u32,
    pub registry_version: String,
    pub generated_at: String,
    #[serde(default)]
    pub agents: Vec<AgentRegistryAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAgent {
    pub kind: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub native: Option<AgentRegistryNativeArtifact>,
    pub agent_process: AgentRegistryAgentProcessArtifact,
    pub launch: AgentRegistryLaunch,
    pub auth: AgentRegistryAuth,
    #[serde(default)]
    pub docs_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryNativeArtifact {
    pub install: AgentRegistryNativeInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAgentProcessArtifact {
    pub install: AgentRegistryAgentProcessInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentRegistryNativeInstall {
    #[serde(rename = "direct_binary")]
    DirectBinary {
        #[serde(default)]
        latest_version_url: Option<String>,
        binary_url_template: String,
        platform_map: HashMap<String, String>,
    },
    #[serde(rename = "tarball_release")]
    TarballRelease {
        latest_url_template: String,
        versioned_url_template: String,
        expected_binary_template: String,
        platform_map: HashMap<String, String>,
    },
    #[serde(rename = "path_only")]
    PathOnly {
        candidate_binaries: Vec<String>,
        #[serde(default)]
        docs_url: Option<String>,
    },
    #[serde(rename = "manual")]
    Manual { docs_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentRegistryAgentProcessInstall {
    #[serde(rename = "registry_backed")]
    RegistryBacked {
        registry_id: String,
        fallback: AgentRegistryAgentProcessFallback,
    },
    #[serde(rename = "managed_npm_package")]
    ManagedNpmPackage {
        package: String,
        #[serde(default)]
        package_subdir: Option<PathBuf>,
        #[serde(default)]
        source_build_binary_name: Option<String>,
        executable_relpath: PathBuf,
    },
    #[serde(rename = "path_only")]
    PathOnly {
        candidate_binaries: Vec<String>,
        #[serde(default)]
        default_args: Vec<String>,
        #[serde(default)]
        docs_url: Option<String>,
    },
    #[serde(rename = "manual")]
    Manual { docs_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentRegistryAgentProcessFallback {
    #[serde(rename = "npm_package")]
    NpmPackage {
        package: String,
        #[serde(default)]
        package_subdir: Option<PathBuf>,
        #[serde(default)]
        source_build_binary_name: Option<String>,
        executable_relpath: PathBuf,
    },
    #[serde(rename = "native_subcommand")]
    NativeSubcommand { args: Vec<String> },
    #[serde(rename = "binary_hint")]
    BinaryHint {
        candidate_binaries: Vec<String>,
        args: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryLaunch {
    pub executable_name: String,
    #[serde(default)]
    pub default_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAuth {
    pub readiness_policy: String,
    #[serde(default)]
    pub slots: Vec<AgentRegistryAuthSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAuthSlot {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub credential_provider_ids: Vec<String>,
    pub required_for_readiness: bool,
    #[serde(default)]
    pub env_vars: Vec<String>,
    pub discovery: String,
    #[serde(default)]
    pub login: Option<AgentRegistryLogin>,
    #[serde(default)]
    pub materialization: AgentRegistryAuthMaterialization,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAuthMaterialization {
    #[serde(default)]
    pub gateway_env: Option<AgentRegistryGatewayEnvMaterialization>,
    #[serde(default)]
    pub synced_files: Option<AgentRegistrySyncedFilesMaterialization>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryGatewayEnvMaterialization {
    pub protocol_facade: String,
    #[serde(default)]
    pub protected_env_keys: Vec<String>,
    #[serde(default)]
    pub support_env_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistrySyncedFilesMaterialization {
    #[serde(default)]
    pub protected_env_keys: Vec<String>,
    #[serde(default)]
    pub allowed_file_paths: Vec<String>,
    #[serde(default)]
    pub cleanup_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryLogin {
    pub label: String,
    pub command: AgentRegistryCommand,
    pub reuses_user_state: bool,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryCommand {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}
