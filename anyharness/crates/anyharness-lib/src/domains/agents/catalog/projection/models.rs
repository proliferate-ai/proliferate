use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
use crate::domains::agents::catalog::schema::{
    AgentCatalogAgent, AgentCatalogControl, AgentCatalogDocument,
};
use crate::domains::agents::catalog::validation::validate_agent_catalog_document;
use crate::domains::agents::model::{
    ModelCatalogStatus, ModelRegistryMetadata, ModelRegistryModelMetadata,
    SessionDefaultControlKey, SessionDefaultControlMetadata, SessionDefaultControlValueMetadata,
    SessionDefaultControlsState,
};

/// Returns target-bundled fallback model metadata for all supported agents.
pub fn bundled_model_registries() -> Vec<ModelRegistryMetadata> {
    agent_catalog_to_model_registries(bundled_agent_catalog_document())
        .expect("bundled agents catalog model registry projection must validate")
}

pub fn bundled_create_mode_ids(agent_kind: &str) -> Option<Vec<String>> {
    let catalog = bundled_agent_catalog_document();
    let agent = catalog
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)?;
    agent
        .session
        .controls
        .iter()
        .find(|control| {
            control.key == "mode" && control.apply.create_field.as_deref() == Some("modeId")
        })
        .map(|control| {
            control
                .values
                .iter()
                .map(|value| value.value.clone())
                .collect()
        })
}

fn agent_catalog_to_model_registries(
    catalog: &AgentCatalogDocument,
) -> anyhow::Result<Vec<ModelRegistryMetadata>> {
    validate_agent_catalog_document(catalog)?;
    Ok(catalog
        .agents
        .iter()
        .filter_map(|agent| match agent_catalog_agent_to_registry(agent) {
            Ok(Some(registry)) => Some(Ok(registry)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<anyhow::Result<Vec<_>>>()?)
}

fn agent_catalog_agent_to_registry(
    agent: &AgentCatalogAgent,
) -> anyhow::Result<Option<ModelRegistryMetadata>> {
    let session_default_controls = session_default_controls_for_agent(agent)?;
    let mut models = agent
        .session
        .models
        .iter()
        .map(|model| ModelRegistryModelMetadata {
            id: model.id.clone(),
            display_name: model.display_name.clone(),
            description: model.description.clone(),
            is_default: model.is_default,
            default_opt_in: model.default_opt_in,
            status: model.status,
            aliases: model.aliases.clone(),
            min_runtime_version: model.min_runtime_version.clone(),
            launch_remediation: model.launch_remediation.clone(),
            session_default_controls: session_default_controls.clone(),
            session_default_controls_state: if session_default_controls.is_empty() {
                SessionDefaultControlsState::Empty
            } else {
                SessionDefaultControlsState::Valid
            },
        })
        .filter(model_is_selectable)
        .collect::<Vec<_>>();

    if models.is_empty() {
        return Ok(None);
    }

    let preferred_default_id = models
        .iter()
        .any(|model| model.id == agent.session.default_model_id)
        .then(|| agent.session.default_model_id.clone())
        .or_else(|| {
            models
                .iter()
                .find(|model| model.is_default)
                .map(|model| model.id.clone())
        })
        .or_else(|| models.first().map(|model| model.id.clone()));

    if let Some(default_id) = preferred_default_id.as_deref() {
        for model in &mut models {
            model.is_default = model.id == default_id;
        }
    }

    Ok(Some(ModelRegistryMetadata {
        kind: agent.kind.clone(),
        display_name: agent.display_name.clone(),
        default_model_id: preferred_default_id,
        models,
    }))
}

fn session_default_controls_for_agent(
    agent: &AgentCatalogAgent,
) -> anyhow::Result<Vec<SessionDefaultControlMetadata>> {
    agent
        .session
        .controls
        .iter()
        .filter(|control| matches!(control.key.as_str(), "reasoning" | "effort" | "fast_mode"))
        .map(agent_catalog_control_to_session_default_control)
        .collect()
}

fn agent_catalog_control_to_session_default_control(
    control: &AgentCatalogControl,
) -> anyhow::Result<SessionDefaultControlMetadata> {
    let key = match control.key.as_str() {
        "reasoning" => SessionDefaultControlKey::Reasoning,
        "effort" => SessionDefaultControlKey::Effort,
        "fast_mode" => SessionDefaultControlKey::FastMode,
        _ => anyhow::bail!("unsupported session default control '{}'", control.key),
    };
    Ok(SessionDefaultControlMetadata {
        key,
        label: control.label.clone(),
        values: control
            .values
            .iter()
            .map(|value| SessionDefaultControlValueMetadata {
                value: value.value.clone(),
                label: value.label.clone(),
                description: value.description.clone(),
                is_default: value.is_default,
            })
            .collect(),
        default_value: control.default_value.clone(),
    })
}

fn model_is_selectable(model: &ModelRegistryModelMetadata) -> bool {
    model.status == ModelCatalogStatus::Active && runtime_version_allows_model(model)
}

fn runtime_version_allows_model(model: &ModelRegistryModelMetadata) -> bool {
    model
        .min_runtime_version
        .as_deref()
        .map(|min_version| version_at_least(env!("CARGO_PKG_VERSION"), min_version))
        .unwrap_or(true)
}

fn version_at_least(current: &str, min: &str) -> bool {
    parse_version(current) >= parse_version(min)
}

fn parse_version(version: &str) -> Vec<u64> {
    version
        .split(['.', '-'])
        .take(3)
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::model::{
        ModelLaunchRemediationKind, ModelLaunchRemediationMetadata,
    };

    #[test]
    fn claude_registry_uses_concise_product_labels() {
        let claude = bundled_model_registries()
            .into_iter()
            .find(|config| config.kind == "claude")
            .expect("claude registry");

        let labels = claude
            .models
            .iter()
            .map(|model| {
                (
                    model.id.as_str(),
                    model.display_name.as_str(),
                    model.description.as_deref(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            claude.default_model_id.as_deref(),
            Some("us.anthropic.claude-sonnet-4-6")
        );
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "us.anthropic.claude-sonnet-4-6"
                && *name == "Sonnet 4.6"
                && description
                    .unwrap_or("")
                    .contains("Best for everyday tasks")
        }));
        assert!(labels.iter().any(|(id, name, description)| {
            *id == "us.anthropic.claude-opus-4-8[1m]"
                && *name == "Opus 4.8 (1M context)"
                && description.unwrap_or("").contains("long sessions")
        }));
    }

    #[test]
    fn bundled_codex_gpt_5_5_is_active_with_remediation() {
        let codex = bundled_model_registries()
            .into_iter()
            .find(|config| config.kind == "codex")
            .expect("codex registry");

        assert_eq!(codex.default_model_id.as_deref(), Some("gpt-5.5"));
        let gpt_55 = codex
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5")
            .expect("gpt 5.5 model");
        assert_eq!(
            gpt_55
                .launch_remediation
                .as_ref()
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::ManagedReinstall)
        );
    }

    #[test]
    fn cursor_gpt_5_5_uses_external_update_remediation() {
        let cursor = bundled_model_registries()
            .into_iter()
            .find(|config| config.kind == "cursor")
            .expect("cursor registry");

        let gpt_55 = cursor
            .models
            .iter()
            .find(|model| model.id == "gpt-5.5-medium")
            .expect("cursor gpt 5.5 model");
        assert_eq!(
            gpt_55
                .launch_remediation
                .as_ref()
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::ExternalUpdate)
        );
    }

    #[test]
    fn bundled_frontier_agent_defaults_are_current() {
        use std::collections::BTreeSet;

        let registries = bundled_model_registries();
        let cursor = registries
            .iter()
            .find(|config| config.kind == "cursor")
            .expect("cursor registry");
        assert_eq!(
            cursor.default_model_id.as_deref(),
            Some("composer-2.5-fast")
        );
        assert!(cursor.models.iter().any(|model| {
            model.id == "claude-opus-4-8-thinking-high"
                && model.default_opt_in == Some(true)
        }));
        let cursor_default_opt_in_ids = cursor
            .models
            .iter()
            .filter(|model| model.default_opt_in == Some(true))
            .map(|model| model.id.as_str())
            .collect::<BTreeSet<_>>();
        let expected_cursor_default_opt_in_ids = BTreeSet::from([
            "auto",
            "claude-opus-4-8-high",
            "claude-opus-4-8-max",
            "claude-opus-4-8-thinking-high",
            "claude-opus-4-8-thinking-max",
            "claude-opus-4-8-thinking-xhigh",
            "claude-opus-4-8-xhigh",
            "composer-2.5",
            "composer-2.5-fast",
            "gemini-3.1-pro",
            "gemini-3.5-flash",
            "gpt-5.5-extra-high",
            "gpt-5.5-high",
            "gpt-5.5-medium",
            "grok-build-0.1",
            "kimi-k2.5",
        ]);
        assert_eq!(
            cursor_default_opt_in_ids,
            expected_cursor_default_opt_in_ids
        );

        let gemini = registries
            .iter()
            .find(|config| config.kind == "gemini")
            .expect("gemini registry");
        assert_eq!(
            gemini.default_model_id.as_deref(),
            Some("auto-gemini-3")
        );

        let opencode = registries
            .iter()
            .find(|config| config.kind == "opencode")
            .expect("opencode registry");
        assert!(opencode
            .models
            .iter()
            .any(|model| model.id == "opencode/mimo-v2.5-free"));
        assert!(!opencode
            .models
            .iter()
            .any(|model| model.id == "opencode/ring-2.6-1t-free"));
    }

    #[test]
    fn hidden_candidate_and_too_new_models_are_not_selectable() {
        let mut catalog = bundled_agent_catalog_document().clone();
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        codex
            .session
            .models
            .push(crate::domains::agents::catalog::schema::AgentCatalogModel {
                id: "candidate".to_string(),
                display_name: "Candidate".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Candidate,
                is_default: false,
                default_opt_in: None,
                min_runtime_version: None,
                launch_remediation: None,
            });
        codex
            .session
            .models
            .push(crate::domains::agents::catalog::schema::AgentCatalogModel {
                id: "too-new".to_string(),
                display_name: "Too New".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Active,
                is_default: false,
                default_opt_in: None,
                min_runtime_version: Some("999.0.0".to_string()),
                launch_remediation: None,
            });
        codex
            .session
            .models
            .push(crate::domains::agents::catalog::schema::AgentCatalogModel {
                id: "hidden".to_string(),
                display_name: "Hidden".to_string(),
                description: None,
                aliases: vec![],
                status: ModelCatalogStatus::Hidden,
                is_default: false,
                default_opt_in: None,
                min_runtime_version: None,
                launch_remediation: None,
            });

        let registries =
            agent_catalog_to_model_registries(&catalog).expect("valid effective registry");
        let codex = registries
            .into_iter()
            .find(|registry| registry.kind == "codex")
            .expect("codex registry");

        assert!(!codex.models.iter().any(|model| model.id == "candidate"));
        assert!(!codex.models.iter().any(|model| model.id == "too-new"));
        assert!(!codex.models.iter().any(|model| model.id == "hidden"));
    }

    #[test]
    fn validates_launch_remediation_metadata() {
        let mut catalog = bundled_agent_catalog_document().clone();
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        let active = codex
            .session
            .models
            .iter_mut()
            .find(|model| model.status == ModelCatalogStatus::Active)
            .expect("active model");
        active.launch_remediation = Some(ModelLaunchRemediationMetadata {
            kind: ModelLaunchRemediationKind::Restart,
            message: "Restart and retry.".to_string(),
        });

        let registries = agent_catalog_to_model_registries(&catalog).expect("valid remediation");

        assert_eq!(
            registries
                .into_iter()
                .find(|registry| registry.kind == "codex")
                .expect("codex registry")
                .models
                .into_iter()
                .find(|model| model.launch_remediation.is_some())
                .and_then(|model| model.launch_remediation)
                .map(|remediation| remediation.kind),
            Some(ModelLaunchRemediationKind::Restart)
        );
    }
}
