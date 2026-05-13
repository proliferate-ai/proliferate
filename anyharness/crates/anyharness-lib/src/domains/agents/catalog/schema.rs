use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::domains::agents::model::{ModelCatalogStatus, ModelLaunchRemediationMetadata};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogDocument {
    pub schema_version: u32,
    pub catalog_version: String,
    pub generated_at: String,
    #[serde(default)]
    pub agents: Vec<AgentCatalogAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgent {
    pub kind: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub process: AgentCatalogProcess,
    pub session: AgentCatalogSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSession {
    pub default_model_id: String,
    #[serde(default)]
    pub default_mode_id: Option<String>,
    #[serde(default)]
    pub models: Vec<AgentCatalogModel>,
    #[serde(default)]
    pub controls: Vec<AgentCatalogControl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogModel {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub status: ModelCatalogStatus,
    pub is_default: bool,
    #[serde(default)]
    pub default_opt_in: Option<bool>,
    #[serde(default)]
    pub min_runtime_version: Option<String>,
    #[serde(default)]
    pub launch_remediation: Option<ModelLaunchRemediationMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControl {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub control_type: String,
    #[serde(default)]
    pub default_value: Option<String>,
    #[serde(default)]
    pub values: Vec<AgentCatalogControlValue>,
    #[serde(default)]
    pub surfaces: AgentCatalogControlSurfaces,
    #[serde(default)]
    pub apply: AgentCatalogControlApply,
    #[serde(default)]
    pub value_source: String,
    #[serde(default)]
    pub missing_live_config_policy: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlSurfaces {
    #[serde(default)]
    pub start: bool,
    #[serde(default)]
    pub session: bool,
    #[serde(default)]
    pub automation: bool,
    #[serde(default)]
    pub settings: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlApply {
    #[serde(default)]
    pub create_field: Option<String>,
    #[serde(default)]
    pub live_config_id: Option<String>,
    #[serde(default)]
    pub live_setter: Option<String>,
    #[serde(default)]
    pub queue_before_materialized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogControlValue {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogProcess {
    #[serde(default)]
    pub native: Option<AgentCatalogNativeArtifact>,
    pub agent_process: AgentCatalogAgentProcessArtifact,
    pub launch: AgentCatalogLaunch,
    pub auth: AgentCatalogAuth,
    #[serde(default)]
    pub docs_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogNativeArtifact {
    pub install: AgentCatalogNativeInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAgentProcessArtifact {
    pub install: AgentCatalogAgentProcessInstall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum AgentCatalogNativeInstall {
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
pub enum AgentCatalogAgentProcessInstall {
    #[serde(rename = "registry_backed")]
    RegistryBacked {
        registry_id: String,
        fallback: AgentCatalogAgentProcessFallback,
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
pub enum AgentCatalogAgentProcessFallback {
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
pub struct AgentCatalogLaunch {
    pub executable_name: String,
    #[serde(default)]
    pub default_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogAuth {
    #[serde(default)]
    pub env_vars: Vec<String>,
    #[serde(default)]
    pub login: Option<AgentCatalogLogin>,
    pub discovery: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogLogin {
    pub label: String,
    pub command: AgentCatalogCommand,
    pub reuses_user_state: bool,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogCommand {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}
