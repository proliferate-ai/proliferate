//! Runtime-owned model registry catalog metadata, split from `model.rs`
//! (re-exported there) to keep that file within the repo line ceiling.

/// Runtime-owned model registry metadata used by session validation and launch defaults.
#[derive(Debug, Clone)]
pub struct ModelRegistryMetadata {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub models: Vec<ModelRegistryModelMetadata>,
}

/// Runtime-owned model metadata for one harness registry row.
#[derive(Debug, Clone)]
pub struct ModelRegistryModelMetadata {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub default_opt_in: Option<bool>,
    pub status: ModelCatalogStatus,
    pub aliases: Vec<String>,
    pub min_runtime_version: Option<String>,
    pub launch_remediation: Option<ModelLaunchRemediationMetadata>,
    pub session_default_controls: Vec<SessionDefaultControlMetadata>,
    pub session_default_controls_state: SessionDefaultControlsState,
}

/// Runtime-owned lifecycle status for one model catalog row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelCatalogStatus {
    Candidate,
    Active,
    Deprecated,
    Hidden,
}

/// Product-owned remediation class for a launch-time live-apply mismatch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelLaunchRemediationKind {
    ManagedReinstall,
    ExternalUpdate,
    Restart,
}

/// Runtime-owned catalog remediation metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct ModelLaunchRemediationMetadata {
    pub kind: ModelLaunchRemediationKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionDefaultControlKey {
    Reasoning,
    Effort,
    FastMode,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct SessionDefaultControlValueMetadata {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct SessionDefaultControlMetadata {
    pub key: SessionDefaultControlKey,
    pub label: String,
    pub values: Vec<SessionDefaultControlValueMetadata>,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDefaultControlsState {
    Omitted,
    Empty,
    Valid,
    Invalid,
}
