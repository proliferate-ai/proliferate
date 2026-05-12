use crate::domains::agents::model::ModelRegistryMetadata;

pub(super) fn find_model_registry<'a>(
    configs: &'a [ModelRegistryMetadata],
    agent_kind: &str,
) -> anyhow::Result<&'a ModelRegistryMetadata> {
    configs
        .iter()
        .find(|config| config.kind == agent_kind)
        .ok_or_else(|| anyhow::anyhow!("model registry not found for agent '{agent_kind}'"))
}

pub(super) fn resolve_model_id(
    model_registry: &ModelRegistryMetadata,
    provided_model_id: Option<&str>,
) -> anyhow::Result<Option<String>> {
    let valid_ids = model_registry
        .models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    let resolved_model_id = provided_model_id.map(|model_id| {
        if valid_ids.contains(&model_id) {
            return model_id;
        }
        let normalized_model_id =
            normalize_legacy_model_id(model_registry.kind.as_str(), model_id).unwrap_or(model_id);
        resolve_model_alias(model_registry, normalized_model_id).unwrap_or(normalized_model_id)
    });

    resolve_catalog_id(
        resolved_model_id,
        &valid_ids,
        model_registry.default_model_id.as_deref(),
        "model",
    )
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
) -> anyhow::Result<Option<String>> {
    match provided {
        Some(id) => {
            if !valid_ids.contains(&id) {
                anyhow::bail!("invalid {label} ID: '{id}'");
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

    fn plain_model(id: &str, is_default: bool) -> ModelRegistryModelMetadata {
        ModelRegistryModelMetadata {
            id: id.to_string(),
            display_name: id.to_string(),
            description: None,
            is_default,
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

        assert!(error.to_string().contains("invalid model ID"));
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
}
