use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub runtime_home: String,
    pub capabilities: RuntimeCapabilities,
    pub agent_seed: AgentSeedHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub replay: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentSeedHealth {
    pub status: AgentSeedStatus,
    pub source: AgentSeedSource,
    pub ownership: AgentSeedOwnership,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub seeded_agents: Vec<String>,
    pub last_action: AgentSeedLastAction,
    pub seed_owned_artifact_count: u32,
    pub skipped_existing_artifact_count: u32,
    pub repaired_artifact_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_kind: Option<AgentSeedFailureKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedStatus {
    NotConfiguredDev,
    MissingBundledSeed,
    Hydrating,
    Ready,
    Partial,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedSource {
    Bundled,
    ExternalDev,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedOwnership {
    FullSeed,
    PartialSeed,
    UserOwnedExisting,
    NotConfigured,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedLastAction {
    None,
    Hydrated,
    Repaired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedFailureKind {
    MissingArchive,
    InvalidChecksum,
    InvalidManifest,
    InvalidArchive,
    Io,
    UnsupportedTarget,
    VerificationFailed,
}
