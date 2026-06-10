use anyharness_contract::v1::{AgentSeedFailureKind, AgentSeedLastAction};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSeedManifest {
    pub schema_version: u32,
    pub seed_version: String,
    pub target: String,
    #[serde(default)]
    pub seeded_agents: Vec<String>,
    pub artifacts: Vec<AgentSeedManifestArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSeedManifestArtifact {
    pub path: String,
    pub kind: String,
    pub role: String,
    pub sha256: String,
    #[serde(default)]
    pub executable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSeedState {
    pub schema_version: u32,
    pub seed_version: Option<String>,
    pub target: Option<String>,
    #[serde(default)]
    pub seeded_agents: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<AgentSeedArtifactRecord>,
    pub last_action: AgentSeedLastAction,
    pub repaired_artifact_count: u32,
    pub skipped_existing_artifact_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSeedArtifactRecord {
    pub path: String,
    pub kind: String,
    pub role: String,
    pub owner: AgentSeedArtifactOwner,
    pub seed_version: String,
    pub seed_checksum: String,
    pub last_observed_checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentSeedArtifactOwner {
    Seed,
    UserExisting,
    UserModified,
}

#[derive(Debug, thiserror::Error)]
pub(super) enum SeedError {
    #[error("missing seed archive")]
    MissingArchive,
    #[error("unsupported target")]
    UnsupportedTarget,
    #[error("invalid checksum")]
    InvalidChecksum,
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("invalid archive: {0}")]
    InvalidArchive(String),
    #[error("verification failed: {0}")]
    VerificationFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl SeedError {
    pub(super) fn failure_kind(&self) -> AgentSeedFailureKind {
        match self {
            Self::MissingArchive => AgentSeedFailureKind::MissingArchive,
            Self::UnsupportedTarget => AgentSeedFailureKind::UnsupportedTarget,
            Self::InvalidChecksum => AgentSeedFailureKind::InvalidChecksum,
            Self::InvalidManifest(_) | Self::Json(_) => AgentSeedFailureKind::InvalidManifest,
            Self::InvalidArchive(_) => AgentSeedFailureKind::InvalidArchive,
            Self::VerificationFailed(_) => AgentSeedFailureKind::VerificationFailed,
            Self::Io(_) => AgentSeedFailureKind::Io,
        }
    }
}
