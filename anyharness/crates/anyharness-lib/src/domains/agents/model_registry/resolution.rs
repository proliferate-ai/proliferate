use crate::domains::agents::model::ModelRegistryMetadata;

use super::model::{DynamicModelRegistrySnapshot, DynamicModelRegistryStatus, ResolvedModelIntent};
use super::projection::{is_snapshot_launch_usable, launch_registry_for_kind};
use super::store::DynamicModelRegistryStore;

#[derive(Debug)]
pub enum ModelResolutionError {
    Unsupported(String),
    Invalid(String),
}

#[derive(Debug)]
enum CatalogIdResolutionError {
    Invalid(String),
}

pub fn launch_registry_for_scope(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
) -> anyhow::Result<Option<ModelRegistryMetadata>> {
    let snapshot = match load_launch_snapshot_for_session(store, agent_kind, workspace_id)? {
        LaunchSnapshotDecision::Use(snapshot) => Some(snapshot),
        LaunchSnapshotDecision::Ignore => None,
        LaunchSnapshotDecision::Block(_) => return Ok(None),
    };
    Ok(launch_registry_for_kind(agent_kind, snapshot.as_ref()))
}

pub fn resolve_launch_model_id(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
    provided_model_id: Option<&str>,
) -> anyhow::Result<Result<Option<String>, ModelResolutionError>> {
    let registry = match launch_registry_for_session(store, agent_kind, workspace_id)? {
        Ok(Some(registry)) => registry,
        Ok(None) => {
            return Ok(Err(ModelResolutionError::Invalid(format!(
                "model registry not found for agent '{agent_kind}'"
            ))));
        }
        Err(error) => return Ok(Err(error)),
    };

    Ok(resolve_model_id(&registry, provided_model_id))
}

fn launch_registry_for_session(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
) -> anyhow::Result<Result<Option<ModelRegistryMetadata>, ModelResolutionError>> {
    let snapshot = match load_launch_snapshot_for_session(store, agent_kind, workspace_id)? {
        LaunchSnapshotDecision::Use(snapshot) => Some(snapshot),
        LaunchSnapshotDecision::Ignore => None,
        LaunchSnapshotDecision::Block(message) => {
            return Ok(Err(ModelResolutionError::Invalid(message)));
        }
    };

    let Some(registry) = launch_registry_for_kind(agent_kind, snapshot.as_ref()) else {
        return Ok(Err(ModelResolutionError::Invalid(format!(
            "model registry not found for agent '{agent_kind}'"
        ))));
    };

    Ok(Ok(Some(registry)))
}

pub fn resolve_model_intent(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
    requested_model_id: &str,
) -> anyhow::Result<ResolvedModelIntent> {
    let Some(registry) = launch_registry_for_scope(store, agent_kind, workspace_id)? else {
        return Ok(ResolvedModelIntent {
            requested_model_id: requested_model_id.to_string(),
            resolved_model_id: None,
            available: false,
            reason: Some("model_registry_not_found".to_string()),
        });
    };

    let resolved = resolve_model_id(&registry, Some(requested_model_id))
        .ok()
        .flatten();

    Ok(ResolvedModelIntent {
        requested_model_id: requested_model_id.to_string(),
        resolved_model_id: resolved.clone(),
        available: resolved.is_some(),
        reason: resolved
            .is_none()
            .then(|| "model_not_available_on_target".to_string()),
    })
}

pub fn resolve_model_id(
    model_registry: &ModelRegistryMetadata,
    provided_model_id: Option<&str>,
) -> Result<Option<String>, ModelResolutionError> {
    let valid_ids = model_registry
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    let resolved_model_id = provided_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(|model_id| {
            if valid_ids.contains(&model_id) {
                return model_id;
            }
            let normalized_model_id =
                normalize_legacy_model_id(model_registry.kind.as_str(), model_id)
                    .unwrap_or(model_id);
            resolve_model_alias(model_registry, normalized_model_id).unwrap_or(normalized_model_id)
        });

    resolve_catalog_id(
        resolved_model_id,
        &valid_ids,
        model_registry.default_model_id.as_deref(),
        "model",
    )
    .map_err(|error| match (provided_model_id, error) {
        (Some(model_id), CatalogIdResolutionError::Invalid(_)) => {
            ModelResolutionError::Unsupported(model_id.trim().to_string())
        }
        (_, CatalogIdResolutionError::Invalid(detail)) => ModelResolutionError::Invalid(detail),
    })
}

enum LaunchSnapshotDecision {
    Use(DynamicModelRegistrySnapshot),
    Ignore,
    Block(String),
}

fn load_launch_snapshot_for_session(
    store: &DynamicModelRegistryStore,
    agent_kind: &str,
    workspace_id: Option<&str>,
) -> anyhow::Result<LaunchSnapshotDecision> {
    if let Some(workspace_id) = workspace_id {
        if let Some(snapshot) = store.get(agent_kind, Some(workspace_id))? {
            return Ok(validate_snapshot_for_session_launch(agent_kind, snapshot));
        }
    }

    if let Some(snapshot) = store.get(agent_kind, None)? {
        return Ok(validate_snapshot_for_session_launch(agent_kind, snapshot));
    }

    Ok(LaunchSnapshotDecision::Ignore)
}

fn validate_snapshot_for_session_launch(
    agent_kind: &str,
    snapshot: DynamicModelRegistrySnapshot,
) -> LaunchSnapshotDecision {
    if is_snapshot_launch_usable(&snapshot, chrono::Utc::now()) {
        return LaunchSnapshotDecision::Use(snapshot);
    }

    if dynamic_registry_required_for_launch(agent_kind) {
        return LaunchSnapshotDecision::Block(unusable_dynamic_snapshot_message(
            agent_kind, &snapshot,
        ));
    }

    LaunchSnapshotDecision::Ignore
}

fn dynamic_registry_required_for_launch(agent_kind: &str) -> bool {
    matches!(agent_kind, "cursor" | "opencode")
}

fn unusable_dynamic_snapshot_message(
    agent_kind: &str,
    snapshot: &DynamicModelRegistrySnapshot,
) -> String {
    if snapshot.status != DynamicModelRegistryStatus::Available {
        return format!(
            "{agent_kind} model registry is not available for launch; refresh models before launching"
        );
    }
    if snapshot.models.is_empty() {
        return format!("{agent_kind} model registry is empty; refresh models before launching");
    }
    if snapshot
        .expires_at
        .is_some_and(|expires_at| expires_at <= chrono::Utc::now())
    {
        return format!("{agent_kind} model registry is stale; refresh models before launching");
    }
    format!("{agent_kind} model registry is unusable; refresh models before launching")
}

fn resolve_model_alias<'a>(
    model_registry: &'a ModelRegistryMetadata,
    provided_model_id: &str,
) -> Option<&'a str> {
    model_registry
        .models
        .iter()
        .find(|model| model.aliases.iter().any(|alias| alias == provided_model_id))
        .map(|model| model.id.as_str())
}

fn resolve_catalog_id(
    provided: Option<&str>,
    valid_ids: &[&str],
    default_id: Option<&str>,
    label: &str,
) -> Result<Option<String>, CatalogIdResolutionError> {
    match provided {
        Some(id) => {
            if !valid_ids.contains(&id) {
                return Err(CatalogIdResolutionError::Invalid(format!(
                    "invalid {label} ID: '{id}'"
                )));
            }
            Ok(Some(id.to_string()))
        }
        None => Ok(default_id.map(|value| value.to_string())),
    }
}

fn normalize_legacy_model_id(agent_kind: &str, model_id: &str) -> Option<&'static str> {
    if agent_kind != "claude" {
        return None;
    }

    match model_id {
        "claude-sonnet-4-5" | "claude-sonnet-4-6" => Some("sonnet"),
        "claude-sonnet-4-5-1m" | "claude-sonnet-4-6-1m" => Some("sonnet[1m]"),
        "claude-opus-4-5" | "claude-opus-4-6-1m" | "opus" => Some("opus[1m]"),
        "claude-haiku-4-5" => Some("haiku"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::model::{
        ModelCatalogStatus, ModelRegistryModelMetadata, SessionDefaultControlsState,
    };
    use crate::domains::agents::model_registry::model::DynamicModelRegistrySource;

    fn plain_model(id: &str, is_default: bool) -> ModelRegistryModelMetadata {
        ModelRegistryModelMetadata {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            is_default,
            default_opt_in: None,
            status: ModelCatalogStatus::Active,
            aliases: vec![],
            min_runtime_version: None,
            launch_remediation: None,
            session_default_controls: vec![],
            session_default_controls_state: SessionDefaultControlsState::Empty,
        }
    }

    fn registry_with_models(models: Vec<ModelRegistryModelMetadata>) -> ModelRegistryMetadata {
        let default_model_id = models
            .iter()
            .find(|model| model.is_default)
            .map(|model| model.id.clone());

        ModelRegistryMetadata {
            kind: "test".to_string(),
            display_name: "Test".to_string(),
            default_model_id,
            models,
        }
    }

    #[test]
    fn resolves_default_model_id() {
        let provider_config = registry_with_models(vec![plain_model("default", true)]);

        let resolved =
            resolve_model_id(&provider_config, None).expect("default model should resolve");

        assert_eq!(resolved.as_deref(), Some("default"));
    }

    #[test]
    fn rejects_unknown_model_id() {
        let provider_config = registry_with_models(vec![plain_model("default", true)]);

        let error = resolve_model_id(&provider_config, Some("missing"))
            .expect_err("invalid model id should fail");

        assert!(matches!(
            error,
            ModelResolutionError::Unsupported(model_id) if model_id == "missing"
        ));
    }

    #[test]
    fn normalizes_legacy_claude_opus_alias() {
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: vec![plain_model("sonnet", true), plain_model("opus[1m]", false)],
        };

        let resolved =
            resolve_model_id(&registry, Some("opus")).expect("legacy model id should normalize");

        assert_eq!(resolved.as_deref(), Some("opus[1m]"));
    }

    #[test]
    fn resolves_catalog_aliases_to_canonical_model_id() {
        let mut opus = plain_model("opus[1m]", false);
        opus.aliases = vec!["claude-opus-4-7".to_string()];
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: vec![plain_model("sonnet", true), opus],
        };

        let resolved = resolve_model_id(&registry, Some("claude-opus-4-7"))
            .expect("catalog alias should resolve");

        assert_eq!(resolved.as_deref(), Some("opus[1m]"));
    }

    #[test]
    fn preserves_pinned_claude_opus_4_6_model_id() {
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("sonnet".to_string()),
            models: {
                let mut opus = plain_model("opus[1m]", false);
                opus.aliases = vec!["claude-opus-4-6".to_string()];
                vec![
                    plain_model("sonnet", true),
                    opus,
                    plain_model("claude-opus-4-6", false),
                ]
            },
        };

        let resolved = resolve_model_id(&registry, Some("claude-opus-4-6"))
            .expect("pinned Opus 4.6 model id should resolve directly");

        assert_eq!(resolved.as_deref(), Some("claude-opus-4-6"));
    }

    #[test]
    fn blocks_dynamic_session_launch_with_stale_snapshot() {
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "opencode".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: chrono::Utc::now() - chrono::Duration::hours(2),
            expires_at: Some(chrono::Utc::now() - chrono::Duration::minutes(1)),
            models: vec![super::super::model::DynamicModelRegistryModel {
                id: "openai/gpt-5.4".to_string(),
                display_name: "GPT 5.4".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(false),
                provider: Some("openai".to_string()),
            }],
            warnings: vec![],
            error_message: None,
        };

        let decision = validate_snapshot_for_session_launch("opencode", snapshot);

        assert!(matches!(
            decision,
            LaunchSnapshotDecision::Block(message) if message.contains("stale")
        ));
    }

    #[test]
    fn blocks_dynamic_launch_registry_fallback_with_stale_snapshot() {
        let store =
            DynamicModelRegistryStore::new(crate::persistence::Db::open_in_memory().expect("db"));
        let snapshot = DynamicModelRegistrySnapshot {
            kind: "opencode".to_string(),
            workspace_id: None,
            source: DynamicModelRegistrySource::ProviderCli,
            status: DynamicModelRegistryStatus::Available,
            refreshed_at: chrono::Utc::now() - chrono::Duration::hours(2),
            expires_at: Some(chrono::Utc::now() - chrono::Duration::minutes(1)),
            models: vec![super::super::model::DynamicModelRegistryModel {
                id: "openai/gpt-5.4".to_string(),
                display_name: "GPT 5.4".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: true,
                default_opt_in: Some(false),
                provider: Some("openai".to_string()),
            }],
            warnings: vec![],
            error_message: None,
        };

        store.upsert(&snapshot).expect("snapshot");

        let registry = launch_registry_for_scope(&store, "opencode", None)
            .expect("registry lookup should succeed");

        assert!(registry.is_none());
    }
}
