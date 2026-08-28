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
    /// How many auth sources this harness may keep enabled at once
    /// (`single` = radio, `multi` = additive gateway + api_key rows). The
    /// declared authority for the server/TS single-vs-multi mirrors; the Rust
    /// render plane does not branch on it (cardinality is a product-layer
    /// selection rule), so it is carried through untyped and only round-tripped.
    #[serde(default)]
    pub auth_cardinality: Option<String>,
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
    /// Typed provider-config kinds this harness supports (agent-auth.md's
    /// vault table: `aws_bedrock`, `azure_openai`). Empty/omitted means the
    /// harness offers none — the settings UI's typed-secret create flow
    /// (`getSupportedProviderConfigKinds`) is driven by this list, and a
    /// vault entry of an undeclared kind is rejected at selection-write time
    /// like any other invalid selection (agent-auth.md's "Two rules keep
    /// typed kinds from sprawling"). Each declaration carries the env var
    /// vocabulary of its config kind, INCLUDING the non-secret mode-switch
    /// flags (e.g. claude's `CLAUDE_CODE_USE_FOUNDRY`) that only exist on
    /// this side of the document — `auth.slots[]` does not repeat them.
    /// Readers of the flag vocabulary must consult both.
    #[serde(default)]
    pub provider_config: Vec<AgentRegistryProviderConfig>,
    /// How this harness's own self-updater is neutralized so the managed lane
    /// stays the single source of version truth (Update Flow FR-3 / R2.5).
    /// Required per harness — validation rejects a document that omits it.
    pub self_update_neutralization: AgentRegistrySelfUpdateNeutralization,
}

/// Per-harness record of HOW the harness's own self-update path is disabled by
/// the managed launcher. Drives `managed_launcher_env`: an `env` mechanism
/// injects each `env[]` var into the launcher; `none_found`/`not_applicable`
/// inject nothing and exist to document the static-analysis finding honestly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistrySelfUpdateNeutralization {
    /// One of `env`, `none_found`, `not_applicable`.
    pub mechanism: String,
    /// Human-readable evidence: which var disables it, or why none was found.
    pub detail: String,
    /// Env vars injected into the managed launcher when `mechanism == "env"`.
    #[serde(default)]
    pub env: Vec<AgentRegistrySelfUpdateEnvVar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistrySelfUpdateEnvVar {
    pub name: String,
    pub value: String,
}

/// One typed provider-config declaration: which vault `kind` this harness
/// accepts, and the field-spec vocabulary its render recipe consumes to turn
/// a decrypted vault JSON document into the harness's own env set. `envVars`
/// reuses [`AgentRegistryAuthSlotEnvVar`]'s plain/tagged form so a Bedrock
/// mode-switch flag (`CLAUDE_CODE_USE_BEDROCK`) and its credential vars share
/// one vocabulary with auth slots instead of inventing a second one — a
/// `flag`-kind entry here classifies exactly like one declared on a slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryProviderConfig {
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub env_vars: Vec<AgentRegistryAuthSlotEnvVar>,
    /// True while the cell is built but live-unverified (e.g. codex's
    /// `azure_openai` config.toml `model_providers` injection has never been
    /// exercised against real Azure OpenAI): the server excludes a pending
    /// kind from the selectable set, so no real selection can reach its
    /// render arm until the dependency named in `pending_reason` clears.
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub pending_reason: Option<String>,
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
        #[serde(default)]
        companions: Vec<AgentRegistryNativeCompanion>,
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
    /// First-party per-platform tarball pins (no ACP registry, no npm): a
    /// sha256-verified archive per platform, resolved by resolve-pins.mjs onto
    /// the catalog's archive source and installed through the existing archive
    /// path. Additive — pending Agent Auth ADR ratification; no catalog entry
    /// uses it yet (claude/codex stay git/npm this rung).
    #[serde(rename = "direct_archive")]
    DirectArchive {
        platforms: HashMap<String, AgentRegistryAgentProcessArchiveTarget>,
        #[serde(default)]
        args: Vec<String>,
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

/// A sidecar release asset installed beside a `tarball_release` native CLI;
/// see `model::NativeCompanionSpec`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryNativeCompanion {
    pub name: String,
    pub versioned_url_template: String,
    pub expected_binary_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryAgentProcessArchiveTarget {
    pub url: String,
    pub sha256: String,
    pub expected_binary: String,
    #[serde(default)]
    pub size: Option<u64>,
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

        // Plain-string entries default to secret; tagged entries carry kind.
        assert_eq!(
            anthropic_slot
                .env_vars
                .iter()
                .map(|env_var| (env_var.name(), env_var.kind()))
                .collect::<Vec<_>>(),
            vec![
                ("ANTHROPIC_AUTH_TOKEN", AgentRegistryEnvVarKind::Secret),
                ("ANTHROPIC_API_KEY", AgentRegistryEnvVarKind::Secret),
                ("CLAUDE_CODE_USE_BEDROCK", AgentRegistryEnvVarKind::Flag),
                ("AWS_BEARER_TOKEN_BEDROCK", AgentRegistryEnvVarKind::Secret),
            ]
        );
        assert_eq!(
            anthropic_slot.discovery_kinds,
            vec![
                "claude-config-api-key",
                "claude-oauth-creds",
                "claude-keychain",
                "claude-oauth-account",
                "aws-credential-chain",
            ]
        );
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

    #[test]
    fn bundled_claude_declares_bedrock_and_azure_provider_config() {
        let registry = bundled_agent_registry_document();
        let claude = registry
            .agents
            .iter()
            .find(|agent| agent.kind == "claude")
            .expect("claude agent");

        let kinds: Vec<&str> = claude
            .provider_config
            .iter()
            .map(|entry| entry.kind.as_str())
            .collect();
        assert_eq!(kinds, vec!["aws_bedrock", "azure_openai"]);

        let bedrock = claude
            .provider_config
            .iter()
            .find(|entry| entry.kind == "aws_bedrock")
            .expect("claude aws_bedrock providerConfig");
        assert_eq!(
            bedrock
                .env_vars
                .iter()
                .map(|env_var| env_var.name())
                .collect::<Vec<_>>(),
            vec![
                "CLAUDE_CODE_USE_BEDROCK",
                "AWS_BEARER_TOKEN_BEDROCK",
                "AWS_REGION"
            ]
        );
        assert_eq!(
            bedrock.env_vars[0].kind(),
            AgentRegistryEnvVarKind::Flag,
            "the Bedrock mode switch must be tagged flag, not secret"
        );
    }

    #[test]
    fn bundled_codex_azure_openai_provider_config_is_pending() {
        // The registry declares codex azure_openai's env-var vocabulary (Track
        // D's full-scope intent), and D3-rust built the config.toml
        // model_providers injection it needs -- but the cell is
        // live-unverified (nobody has exercised codex against real Azure
        // OpenAI). This pins that the declaration stays marked `pending`
        // with a reason naming that debt, so it reads as honest scope
        // rather than a working integration.
        let registry = bundled_agent_registry_document();
        let codex = registry
            .agents
            .iter()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");

        let azure = codex
            .provider_config
            .iter()
            .find(|entry| entry.kind == "azure_openai")
            .expect("codex azure_openai providerConfig");
        assert!(azure.pending, "codex azure_openai must be marked pending");
        let reason = azure
            .pending_reason
            .as_deref()
            .expect("pending entry must carry a pendingReason");
        assert!(
            reason.contains("live-unverified"),
            "pendingReason must name the live-verification debt: {reason}"
        );

        let bedrock = codex
            .provider_config
            .iter()
            .find(|entry| entry.kind == "aws_bedrock")
            .expect("codex aws_bedrock providerConfig");
        assert!(
            !bedrock.pending,
            "codex aws_bedrock is env-var-driven and must not be pending"
        );
    }

    #[test]
    fn provider_config_defaults_to_empty_when_absent() {
        let agent: AgentRegistryAgent = serde_json::from_value(serde_json::json!({
            "kind": "grok",
            "displayName": "Grok",
            "agentProcess": {
                "install": {
                    "kind": "manual",
                    "docsUrl": "https://example.com"
                }
            },
            "launch": {
                "executableName": "grok",
                "defaultArgs": []
            },
            "auth": {
                "readinessPolicy": "none",
                "slots": []
            },
            "selfUpdateNeutralization": {
                "mechanism": "none_found",
                "detail": "static analysis found no self-update path"
            }
        }))
        .expect("agent without providerConfig must parse");
        assert!(agent.provider_config.is_empty());
    }
}
