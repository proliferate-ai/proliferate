use std::collections::HashSet;

use chrono::DateTime;

use super::schema::{AgentCatalogAgent, AgentCatalogControl, AgentCatalogDocument};
use crate::domains::agents::model::{AgentKind, ModelCatalogStatus};

const LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS: usize = 160;

pub fn validate_agent_catalog_document(catalog: &AgentCatalogDocument) -> anyhow::Result<()> {
    if catalog.schema_version != 1 {
        anyhow::bail!("agent catalog schema version is not supported");
    }
    if catalog.catalog_version.trim().is_empty() {
        anyhow::bail!("agent catalog version is empty");
    }
    DateTime::parse_from_rfc3339(&catalog.generated_at)?;
    if catalog.agents.is_empty() {
        anyhow::bail!("agent catalog has no agents");
    }

    let mut seen_agents = HashSet::new();
    for agent in &catalog.agents {
        validate_agent_catalog_agent(agent, &mut seen_agents)?;
    }
    Ok(())
}

fn validate_agent_catalog_agent(
    agent: &AgentCatalogAgent,
    seen_agents: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if AgentKind::parse(agent.kind.as_str()).is_none() {
        anyhow::bail!("agent catalog agent '{}' is not supported", agent.kind);
    }
    if !seen_agents.insert(agent.kind.clone()) {
        anyhow::bail!("agent catalog agent '{}' is duplicated", agent.kind);
    }
    if agent.display_name.trim().is_empty() {
        anyhow::bail!("agent catalog agent '{}' display name is empty", agent.kind);
    }
    if agent.session.models.is_empty() {
        anyhow::bail!("agent catalog agent '{}' has no models", agent.kind);
    }
    if agent.session.default_model_id.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' default model is empty",
            agent.kind
        );
    }

    let mut seen_model_values = HashSet::new();
    let mut default_count = 0;
    for model in &agent.session.models {
        if model.id.trim().is_empty() {
            anyhow::bail!("agent catalog agent '{}' has empty model id", agent.kind);
        }
        if model.display_name.trim().is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' model '{}' display name is empty",
                agent.kind,
                model.id
            );
        }
        if !seen_model_values.insert(model.id.clone()) {
            anyhow::bail!(
                "agent catalog agent '{}' model '{}' is duplicated",
                agent.kind,
                model.id
            );
        }
        for alias in &model.aliases {
            if alias.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' has empty alias",
                    agent.kind,
                    model.id
                );
            }
            if !seen_model_values.insert(alias.clone()) {
                anyhow::bail!(
                    "agent catalog agent '{}' model alias '{}' collides",
                    agent.kind,
                    alias
                );
            }
        }
        if let Some(remediation) = &model.launch_remediation {
            if model.status != ModelCatalogStatus::Active {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' has launch remediation but is not active",
                    agent.kind,
                    model.id
                );
            }
            let message = remediation.message.trim();
            if message.is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' launch remediation message is empty",
                    agent.kind,
                    model.id
                );
            }
            if message.chars().count() > LAUNCH_REMEDIATION_MESSAGE_MAX_CHARS {
                anyhow::bail!(
                    "agent catalog agent '{}' model '{}' launch remediation message is too long",
                    agent.kind,
                    model.id
                );
            }
        }
        if model.is_default {
            default_count += 1;
            if model.id != agent.session.default_model_id {
                anyhow::bail!(
                    "agent catalog agent '{}' default model '{}' does not match defaultModelId '{}'",
                    agent.kind,
                    model.id,
                    agent.session.default_model_id
                );
            }
        }
    }
    if default_count != 1 {
        anyhow::bail!(
            "agent catalog agent '{}' must have exactly one default model",
            agent.kind
        );
    }
    if !agent
        .session
        .models
        .iter()
        .any(|model| model.id == agent.session.default_model_id)
    {
        anyhow::bail!(
            "agent catalog agent '{}' defaultModelId '{}' is not in models",
            agent.kind,
            agent.session.default_model_id
        );
    }

    let mut seen_controls = HashSet::new();
    for control in &agent.session.controls {
        validate_agent_catalog_control(&agent.kind, control, &mut seen_controls)?;
    }
    Ok(())
}

fn validate_agent_catalog_control(
    agent_kind: &str,
    control: &AgentCatalogControl,
    seen_controls: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if !seen_controls.insert(control.key.clone()) {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' is duplicated",
            agent_kind,
            control.key
        );
    }
    if control.label.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' label is empty",
            agent_kind,
            control.key
        );
    }
    if control.control_type != "select" {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' has unsupported type '{}'",
            agent_kind,
            control.key,
            control.control_type
        );
    }
    if !matches!(
        control.missing_live_config_policy.as_str(),
        "ignore_default" | "queue_then_conflict" | "block_prompt" | "remediate"
    ) {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' has unsupported missingLiveConfigPolicy '{}'",
            agent_kind,
            control.key,
            control.missing_live_config_policy
        );
    }
    if !matches!(
        control.value_source.as_str(),
        "inline" | "agentModels" | "discoveredModels"
    ) {
        anyhow::bail!(
            "agent catalog agent '{}' control '{}' has unsupported valueSource '{}'",
            agent_kind,
            control.key,
            control.value_source
        );
    }
    if let Some(create_field) = control.apply.create_field.as_deref() {
        if !supported_agent_catalog_create_field(&control.key, create_field) {
            anyhow::bail!(
                "agent catalog agent '{}' control '{}' has unsupported createField '{}'",
                agent_kind,
                control.key,
                create_field
            );
        }
    }
    validate_agent_catalog_control_key_shape(agent_kind, control)?;
    if control.value_source == "inline" {
        if control.values.is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' inline control '{}' has no values",
                agent_kind,
                control.key
            );
        }
        let mut seen_values = HashSet::new();
        for value in &control.values {
            if value.value.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{}' control '{}' has empty value",
                    agent_kind,
                    control.key
                );
            }
            if value.label.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{}' control '{}' value '{}' label is empty",
                    agent_kind,
                    control.key,
                    value.value
                );
            }
            if !seen_values.insert(value.value.clone()) {
                anyhow::bail!(
                    "agent catalog agent '{}' control '{}' value '{}' is duplicated",
                    agent_kind,
                    control.key,
                    value.value
                );
            }
        }
        if let Some(default_value) = control.default_value.as_deref() {
            if !seen_values.contains(default_value) {
                anyhow::bail!(
                    "agent catalog agent '{}' inline control '{}' default '{}' is not a value",
                    agent_kind,
                    control.key,
                    default_value
                );
            }
        }
    }
    Ok(())
}

fn validate_agent_catalog_control_key_shape(
    agent_kind: &str,
    control: &AgentCatalogControl,
) -> anyhow::Result<()> {
    match control.key.as_str() {
        "model" => {
            if control.apply.create_field.as_deref() != Some("modelId") {
                anyhow::bail!(
                    "agent catalog agent '{}' model control must create modelId",
                    agent_kind
                );
            }
            if !matches!(control.value_source.as_str(), "agentModels" | "discoveredModels") {
                anyhow::bail!(
                    "agent catalog agent '{}' model control has unsupported valueSource '{}'",
                    agent_kind,
                    control.value_source
                );
            }
        }
        "mode" => {
            if control.apply.create_field.as_deref() != Some("modeId") {
                anyhow::bail!(
                    "agent catalog agent '{}' mode control must create modeId",
                    agent_kind
                );
            }
            if control.value_source != "inline" {
                anyhow::bail!(
                    "agent catalog agent '{}' mode control has unsupported valueSource '{}'",
                    agent_kind,
                    control.value_source
                );
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn supported_agent_catalog_create_field(control_key: &str, create_field: &str) -> bool {
    matches!(
        (control_key, create_field),
        ("model", "modelId") | ("mode", "modeId")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;

    #[test]
    fn bundled_agent_catalog_is_valid() {
        bundled_agent_catalog_document().expect("bundled catalog should validate");
    }

    #[test]
    fn agent_catalog_rejects_unsupported_create_field() {
        let mut catalog = bundled_agent_catalog_document().expect("bundled catalog");
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        let effort = codex
            .session
            .controls
            .iter_mut()
            .find(|control| control.key == "effort")
            .expect("effort control");
        effort.apply.create_field = Some("arbitraryField".to_string());

        let error = validate_agent_catalog_document(&catalog).expect_err("invalid create field");

        assert!(
            error.to_string().contains("unsupported createField"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn agent_catalog_rejects_unsupported_value_source() {
        let mut catalog = bundled_agent_catalog_document().expect("bundled catalog");
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        let effort = codex
            .session
            .controls
            .iter_mut()
            .find(|control| control.key == "effort")
            .expect("effort control");
        effort.value_source = "inlinee".to_string();

        let error = validate_agent_catalog_document(&catalog).expect_err("invalid value source");

        assert!(
            error.to_string().contains("unsupported valueSource"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn agent_catalog_rejects_model_control_with_inline_values() {
        let mut catalog = bundled_agent_catalog_document().expect("bundled catalog");
        let codex = catalog
            .agents
            .iter_mut()
            .find(|agent| agent.kind == "codex")
            .expect("codex agent");
        let model = codex
            .session
            .controls
            .iter_mut()
            .find(|control| control.key == "model")
            .expect("model control");
        model.value_source = "inline".to_string();

        let error = validate_agent_catalog_document(&catalog).expect_err("invalid model control");

        assert!(
            error.to_string().contains("model control has unsupported valueSource"),
            "unexpected error: {error}"
        );
    }
}
