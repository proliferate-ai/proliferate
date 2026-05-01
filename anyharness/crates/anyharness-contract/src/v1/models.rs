use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub type WorkspaceId = String;
pub type SessionId = String;

/// Runtime-owned lifecycle status for a model catalog row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelCatalogStatus {
    Candidate,
    Active,
    Deprecated,
    Hidden,
}

/// Product-owned remediation hint shown when a live harness cannot apply a
/// selected catalog model at launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelLaunchRemediationKind {
    ManagedReinstall,
    ExternalUpdate,
    Restart,
}

/// Catalog metadata for the app-owned action shown after live-apply mismatch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelLaunchRemediation {
    /// App-owned action class for remediation.
    pub kind: ModelLaunchRemediationKind,
    /// Short detail text from the catalog. Button labels remain app-owned.
    pub message: String,
}

/// A known model in the AnyHarness catalog for a given provider.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    /// Session-level model ID exposed by the harness (e.g. "opus[1m]")
    pub id: String,
    /// Human-readable name (e.g. "Claude Opus 4.6")
    pub display_name: String,
    /// Optional descriptive copy surfaced in launch/settings UIs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether this is the default model for the provider
    pub is_default: bool,
    /// Runtime-owned lifecycle status for this model
    pub status: ModelCatalogStatus,
    /// Legacy or provider-native selectors that resolve to this model ID
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// Minimum AnyHarness runtime version required for this model, if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_runtime_version: Option<String>,
    /// Optional app-owned remediation hint for launch-time live-apply mismatch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_remediation: Option<ModelLaunchRemediation>,
}

/// A model row in the backend-owned registry for a given harness.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelRegistryModel {
    /// Session-level model selector ID accepted by the harness
    pub id: String,
    /// Human-readable name for the model
    pub display_name: String,
    /// Optional descriptive copy surfaced in launch/settings UIs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether this is the default model for the registry
    pub is_default: bool,
    /// Runtime-owned lifecycle status for this model
    pub status: ModelCatalogStatus,
    /// Legacy or provider-native selectors that resolve to this model ID
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// Minimum AnyHarness runtime version required for this model, if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_runtime_version: Option<String>,
    /// Optional app-owned remediation hint for launch-time live-apply mismatch
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_remediation: Option<ModelLaunchRemediation>,
}

/// Backend-owned model registry for a harness.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelRegistry {
    /// Which agent this registry is for
    pub kind: String,
    /// Human-readable harness name
    pub display_name: String,
    /// Default session-level model selector ID for this harness
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model_id: Option<String>,
    /// Known models for this harness
    pub models: Vec<ModelRegistryModel>,
}

/// Provider-level configuration metadata describing which models AnyHarness
/// intentionally exposes for this agent.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    /// Which agent this config is for
    pub kind: String,
    /// Human-readable provider name (e.g. "Claude")
    pub display_name: String,
    /// Known models for this provider
    pub models: Vec<ModelEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_entry_serializes_in_camel_case() {
        let model = ModelEntry {
            id: "default".to_string(),
            display_name: "Default".to_string(),
            description: None,
            is_default: true,
            status: ModelCatalogStatus::Active,
            aliases: vec![],
            min_runtime_version: None,
            launch_remediation: None,
        };

        let json = serde_json::to_value(&model).expect("serialize model entry");

        assert_eq!(
            json,
            serde_json::json!({
                "id": "default",
                "displayName": "Default",
                "isDefault": true,
                "status": "active"
            })
        );
    }

    #[test]
    fn provider_config_serializes_display_name() {
        let config = ProviderConfig {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            models: vec![],
        };

        let json = serde_json::to_value(&config).expect("serialize provider config");

        assert_eq!(
            json,
            serde_json::json!({
                "kind": "claude",
                "displayName": "Claude",
                "models": []
            })
        );
    }

    #[test]
    fn model_registry_serializes_optional_fields() {
        let registry = ModelRegistry {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: vec![ModelRegistryModel {
                id: "sonnet".to_string(),
                display_name: "Sonnet".to_string(),
                description: Some("Sonnet 4.6".to_string()),
                is_default: true,
                status: ModelCatalogStatus::Active,
                aliases: vec!["claude-sonnet-4-6".to_string()],
                min_runtime_version: None,
                launch_remediation: Some(ModelLaunchRemediation {
                    kind: ModelLaunchRemediationKind::ManagedReinstall,
                    message: "Update Claude tools and retry.".to_string(),
                }),
            }],
        };

        let json = serde_json::to_value(&registry).expect("serialize model registry");

        assert_eq!(
            json,
            serde_json::json!({
                "kind": "claude",
                "displayName": "Claude",
                "defaultModelId": "sonnet",
                "models": [{
                    "id": "sonnet",
                    "displayName": "Sonnet",
                    "description": "Sonnet 4.6",
                    "isDefault": true,
                    "status": "active",
                    "aliases": ["claude-sonnet-4-6"],
                    "launchRemediation": {
                        "kind": "managed_reinstall",
                        "message": "Update Claude tools and retry."
                    }
                }]
            })
        );
    }
}
