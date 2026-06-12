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
    pub env_vars: Vec<AgentRegistryAuthSlotEnvVar>,
    pub discovery: String,
    /// Named discovery fact kinds this slot's credentials may surface as
    /// (e.g. `"claude-oauth-creds"`, `"aws-credential-chain"`). Optional
    /// source vocabulary for catalog v2 auth-context signals; empty means
    /// "not yet declared" and waives the subset check.
    #[serde(default)]
    pub discovery_kinds: Vec<String>,
    #[serde(default)]
    pub login: Option<AgentRegistryLogin>,
    #[serde(default)]
    pub materialization: AgentRegistryAuthMaterialization,
}

/// A credential env var declared by an auth slot. Backward compatible with
/// the plain-string form in registry.json (`"ANTHROPIC_API_KEY"`, kind
/// `secret`); the tagged form adds a `secret|flag` kind so catalog v2
/// signals can be validated (flag values are readable, secrets are
/// presence-only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AgentRegistryAuthSlotEnvVar {
    Name(String),
    Tagged {
        name: String,
        #[serde(default)]
        kind: AgentRegistryEnvVarKind,
    },
}

impl AgentRegistryAuthSlotEnvVar {
    pub fn name(&self) -> &str {
        match self {
            Self::Name(name) => name,
            Self::Tagged { name, .. } => name,
        }
    }

    pub fn kind(&self) -> AgentRegistryEnvVarKind {
        match self {
            Self::Name(_) => AgentRegistryEnvVarKind::default(),
            Self::Tagged { kind, .. } => *kind,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRegistryEnvVarKind {
    #[default]
    Secret,
    Flag,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

    #[test]
    fn bundled_registry_parses_and_validates_with_env_var_vocabulary() {
        let registry = bundled_agent_registry_document();

        let anthropic_slot = registry
            .agents
            .iter()
            .find(|agent| agent.kind == "claude")
            .and_then(|agent| agent.auth.slots.iter().find(|slot| slot.id == "anthropic"))
            .expect("claude anthropic slot");

        // Plain-string entries keep working and default to secret.
        assert_eq!(
            anthropic_slot
                .env_vars
                .iter()
                .map(|env_var| env_var.name())
                .collect::<Vec<_>>(),
            vec!["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]
        );
        assert!(anthropic_slot
            .env_vars
            .iter()
            .all(|env_var| env_var.kind() == AgentRegistryEnvVarKind::Secret));
        assert!(anthropic_slot.discovery_kinds.is_empty());
    }

    #[test]
    fn auth_slot_env_vars_accept_plain_and_tagged_forms() {
        let env_vars: Vec<AgentRegistryAuthSlotEnvVar> =
            serde_json::from_value(serde_json::json!([
                "ANTHROPIC_API_KEY",
                { "name": "CLAUDE_CODE_USE_BEDROCK", "kind": "flag" },
                { "name": "ANTHROPIC_AUTH_TOKEN" }
            ]))
            .expect("env vars must parse");

        assert_eq!(env_vars[0].name(), "ANTHROPIC_API_KEY");
        assert_eq!(env_vars[0].kind(), AgentRegistryEnvVarKind::Secret);
        assert_eq!(env_vars[1].name(), "CLAUDE_CODE_USE_BEDROCK");
        assert_eq!(env_vars[1].kind(), AgentRegistryEnvVarKind::Flag);
        assert_eq!(env_vars[2].kind(), AgentRegistryEnvVarKind::Secret);

        // Plain-string entries serialize back to plain strings (registry.json
        // round-trips byte-compatibly).
        assert_eq!(
            serde_json::to_value(&env_vars[0]).expect("serialize"),
            serde_json::json!("ANTHROPIC_API_KEY")
        );
    }
}
