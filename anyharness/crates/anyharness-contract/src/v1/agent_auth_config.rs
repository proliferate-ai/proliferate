use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthExternalScope {
    pub provider: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSelectionConfig {
    pub agent_kind: String,
    #[serde(default)]
    pub auth_slot_id: String,
    pub materialization_mode: String,
    pub credential_id: String,
    pub credential_revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_share_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub protected_env: BTreeMap<String, String>,
    #[serde(default)]
    pub support_env: BTreeMap<String, String>,
    #[serde(default)]
    pub protected_config: BTreeMap<String, Value>,
    #[serde(default)]
    pub support_config: BTreeMap<String, Value>,
    #[serde(default)]
    pub synced_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthConfigRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_auth_scope: Option<AgentAuthExternalScope>,
    pub revision: i64,
    #[serde(default)]
    pub selections: Vec<AgentAuthSelectionConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthSelectionStatus {
    pub agent_kind: String,
    pub auth_slot_id: String,
    pub materialization_mode: String,
    pub credential_id: String,
    pub credential_revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_share_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub protected_env_keys: Vec<String>,
    pub support_env_keys: Vec<String>,
    pub protected_config_keys: Vec<String>,
    pub support_config_keys: Vec<String>,
    pub synced_file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthConfigStatusResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_auth_scope: Option<AgentAuthExternalScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
    pub status: String,
    #[serde(default)]
    pub selections: Vec<AgentAuthSelectionStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthConfigResponse {
    pub applied: bool,
    pub revision: i64,
    pub selection_count: usize,
    #[serde(default)]
    pub no_selection_kinds: Vec<String>,
    pub status: String,
}
