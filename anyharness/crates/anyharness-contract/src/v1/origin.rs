use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OriginKind {
    Human,
    Cowork,
    Api,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OriginEntrypoint {
    Desktop,
    Cloud,
    LocalRuntime,
    Cowork,
}

/// Advisory provenance metadata for workspace and session records.
///
/// Origin is a read-model hint. It is not authoritative for authorization,
/// billing, mutability, sandbox ownership, MCP inheritance, or policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OriginContext {
    pub kind: OriginKind,
    pub entrypoint: OriginEntrypoint,
}
