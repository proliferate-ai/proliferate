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
