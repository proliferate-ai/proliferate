use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domains::agents::model::ModelCatalogStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DynamicModelRegistrySource {
    BundledCatalog,
    ProviderCli,
}

impl DynamicModelRegistrySource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BundledCatalog => "bundled_catalog",
            Self::ProviderCli => "provider_cli",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "bundled_catalog" => Some(Self::BundledCatalog),
            "provider_cli" => Some(Self::ProviderCli),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DynamicModelRegistryStatus {
    Available,
    RefreshFailed,
    AgentNotReady,
    Unsupported,
}

impl DynamicModelRegistryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Available => "available",
            Self::RefreshFailed => "refresh_failed",
            Self::AgentNotReady => "agent_not_ready",
            Self::Unsupported => "unsupported",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "available" => Some(Self::Available),
            "refresh_failed" => Some(Self::RefreshFailed),
            "agent_not_ready" => Some(Self::AgentNotReady),
            "unsupported" => Some(Self::Unsupported),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicModelRegistryModel {
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
    pub provider: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DynamicModelRegistrySnapshot {
    pub kind: String,
    pub workspace_id: Option<String>,
    pub source: DynamicModelRegistrySource,
    pub status: DynamicModelRegistryStatus,
    pub refreshed_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub models: Vec<DynamicModelRegistryModel>,
    pub warnings: Vec<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshModelRegistryOptions {
    pub workspace_id: Option<String>,
    pub force_provider_refresh: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedModelIntent {
    pub requested_model_id: String,
    pub resolved_model_id: Option<String>,
    pub available: bool,
    pub reason: Option<String>,
}
