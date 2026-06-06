use crate::domains::agents::model::{ModelRegistryMetadata, ModelRegistryModelMetadata};

use super::model::{DynamicModelRegistrySnapshot, DynamicModelRegistryStatus, ResolvedModelIntent};
use super::projection::{is_snapshot_launch_usable, launch_registry_for_kind};
use super::store::DynamicModelRegistryStore;

#[derive(Debug)]
pub enum ModelResolutionError {
    Unsupported(String),
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
    let selected_model = match provided_model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
    {
        Some(model_id) => resolve_requested_model(model_registry, model_id)
            .ok_or_else(|| ModelResolutionError::Unsupported(model_id.to_string()))?,
        None => {
            let Some(default_model_id) = model_registry.default_model_id.as_deref() else {
                return Ok(None);
            };
            find_model_by_id(model_registry, default_model_id).ok_or_else(|| {
                ModelResolutionError::Invalid(format!("invalid model ID: '{default_model_id}'"))
            })?
        }
    };

    Ok(Some(resolve_model_launch_id(
        model_registry,
        selected_model,
    )))
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

fn resolve_requested_model<'a>(
    model_registry: &'a ModelRegistryMetadata,
    provided_model_id: &str,
) -> Option<&'a ModelRegistryModelMetadata> {
    find_model_by_id(model_registry, provided_model_id).or_else(|| {
        let normalized_model_id =
            normalize_legacy_model_id(model_registry.kind.as_str(), provided_model_id)
                .unwrap_or(provided_model_id);
        find_model_by_id_or_alias(model_registry, normalized_model_id)
    })
}

fn find_model_by_id<'a>(
    model_registry: &'a ModelRegistryMetadata,
    model_id: &str,
) -> Option<&'a ModelRegistryModelMetadata> {
    model_registry
        .models
        .iter()
        .find(|model| model.id == model_id)
}

fn find_model_by_id_or_alias<'a>(
    model_registry: &'a ModelRegistryMetadata,
    model_id: &str,
) -> Option<&'a ModelRegistryModelMetadata> {
    model_registry
        .models
        .iter()
        .find(|model| model.id == model_id || model.aliases.iter().any(|alias| alias == model_id))
}

fn resolve_model_launch_id(
    model_registry: &ModelRegistryMetadata,
    model: &ModelRegistryModelMetadata,
) -> String {
    if model_registry.kind == "claude" {
        for launch_id in ["sonnet", "sonnet[1m]", "opus[1m]", "haiku"] {
            if model.id == launch_id || model.aliases.iter().any(|alias| alias == launch_id) {
                return launch_id.to_string();
            }
        }
        if let Some(normalized) = normalize_legacy_model_id("claude", &model.id) {
            return normalized.to_string();
        }
    }

    model.id.clone()
}

fn normalize_legacy_model_id(agent_kind: &str, model_id: &str) -> Option<&'static str> {
    if agent_kind != "claude" {
        return None;
    }

    match model_id {
        "claude-sonnet-4-5" | "claude-sonnet-4-6" | "us.anthropic.claude-sonnet-4-6" => {
            Some("sonnet")
        }
        "claude-sonnet-4-5-1m" | "claude-sonnet-4-6-1m" | "us.anthropic.claude-sonnet-4-6[1m]" => {
            Some("sonnet[1m]")
        }
        "claude-opus-4-5"
        | "claude-opus-4-6-1m"
        | "claude-opus-4-7"
        | "claude-opus-4-7-1m"
        | "claude-opus-4-8"
        | "claude-opus-4-8-1m"
        | "us.anthropic.claude-opus-4-6-v1"
        | "us.anthropic.claude-opus-4-6-v1[1m]"
        | "us.anthropic.claude-opus-4-7"
        | "us.anthropic.claude-opus-4-7[1m]"
        | "us.anthropic.claude-opus-4-8"
        | "us.anthropic.claude-opus-4-8[1m]"
        | "opus" => Some("opus[1m]"),
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
    fn resolves_claude_catalog_ids_to_live_launch_ids() {
        let mut sonnet = plain_model("us.anthropic.claude-sonnet-4-6", true);
        sonnet.aliases = vec!["sonnet".to_string(), "claude-sonnet-4-6".to_string()];
        let opus = plain_model("us.anthropic.claude-opus-4-8", false);
        let mut opus_1m = plain_model("us.anthropic.claude-opus-4-8[1m]", false);
        opus_1m.aliases = vec!["opus[1m]".to_string(), "claude-opus-4-8-1m".to_string()];
        let registry = ModelRegistryMetadata {
            kind: "claude".to_string(),
            display_name: "Claude".to_string(),
            default_model_id: Some("us.anthropic.claude-sonnet-4-6".to_string()),
            models: vec![sonnet, opus, opus_1m],
        };

        let default_resolved =
            resolve_model_id(&registry, None).expect("default catalog model should resolve");
        let opus_resolved = resolve_model_id(&registry, Some("us.anthropic.claude-opus-4-8"))
            .expect("catalog Opus model should resolve");
        let opus_1m_resolved =
            resolve_model_id(&registry, Some("us.anthropic.claude-opus-4-8[1m]"))
                .expect("catalog Opus 1M model should resolve");

        assert_eq!(default_resolved.as_deref(), Some("sonnet"));
        assert_eq!(opus_resolved.as_deref(), Some("opus[1m]"));
        assert_eq!(opus_1m_resolved.as_deref(), Some("opus[1m]"));
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
