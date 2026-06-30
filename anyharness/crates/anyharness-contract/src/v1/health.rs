use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::agents::AgentReconcileSummary;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub runtime_home: String,
    pub capabilities: RuntimeCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_pressure: Option<RuntimeResourcePressure>,
    pub agent_seed: AgentSeedHealth,
    pub agent_reconcile: AgentReconcileSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    pub replay: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePressureLevel {
    Unknown,
    Nominal,
    Elevated,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCpuPressure {
    pub load_average_1m: f64,
    pub normalized_percent: f64,
    pub ideal_max_percent: f64,
    pub logical_core_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMemoryPressure {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub percent: f64,
    pub ideal_max_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResourcePressure {
    pub level: RuntimePressureLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<RuntimeCpuPressure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<RuntimeMemoryPressure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure_percent: Option<f64>,
    pub collected_at: String,
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
