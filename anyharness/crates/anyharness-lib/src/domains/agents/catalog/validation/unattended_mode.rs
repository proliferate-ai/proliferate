use super::super::schema::AgentCatalogAgent;

/// An unattended mode is executable policy, not presentation metadata. Keep
/// it inside the catalog's declared mode vocabulary so every runtime that
/// accepts the catalog can safely apply the default. Models without their own
/// `mode` matrix inherit the agent-level vocabulary; models that do declare a
/// matrix must include the curated value themselves.
pub(super) fn validate_unattended_mode(agent: &AgentCatalogAgent) -> anyhow::Result<()> {
    let Some(mode_id) = agent.session.unattended_mode_id.as_deref() else {
        return Ok(());
    };
    if mode_id.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' unattendedModeId is empty",
            agent.kind
        );
    }

    let agent_mode = agent
        .session
        .controls
        .iter()
        .find(|control| control.key == "mode")
        .ok_or_else(|| {
            anyhow::anyhow!(
                "agent catalog agent '{}' unattendedModeId '{mode_id}' has no agent-level mode control",
                agent.kind
            )
        })?;
    if !agent_mode.values.iter().any(|value| value == mode_id) {
        anyhow::bail!(
            "agent catalog agent '{}' unattendedModeId '{mode_id}' is not in the agent-level mode control",
            agent.kind
        );
    }

    for model in &agent.session.models {
        let Some(model_mode) = model.controls.get("mode") else {
            continue;
        };
        if !model_mode.values.iter().any(|value| value == mode_id) {
            anyhow::bail!(
                "agent catalog agent '{}' unattendedModeId '{mode_id}' is not supported by model '{}'",
                agent.kind,
                model.id
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::{draft_catalog_json, AgentCatalogDocument};

    fn draft_agent() -> AgentCatalogAgent {
        let catalog: AgentCatalogDocument =
            serde_json::from_str(draft_catalog_json()).expect("draft catalog must parse");
        catalog.agents.into_iter().next().expect("claude agent")
    }

    fn expect_invalid(agent: &AgentCatalogAgent, expected_fragment: &str) {
        let error = validate_unattended_mode(agent).expect_err("agent must be invalid");
        assert!(
            error.to_string().contains(expected_fragment),
            "expected '{expected_fragment}' in: {error}"
        );
    }

    #[test]
    fn rejects_blank_unattended_mode() {
        let mut agent = draft_agent();
        agent.session.unattended_mode_id = Some("   ".to_string());
        expect_invalid(&agent, "unattendedModeId is empty");
    }

    #[test]
    fn rejects_unattended_mode_outside_agent_vocabulary() {
        let mut agent = draft_agent();
        agent.session.unattended_mode_id = Some("bypassPermissions".to_string());
        agent
            .session
            .controls
            .iter_mut()
            .find(|control| control.key == "mode")
            .expect("claude mode control")
            .values
            .retain(|value| value != "bypassPermissions");
        expect_invalid(&agent, "is not in the agent-level mode control");
    }

    #[test]
    fn rejects_unattended_mode_outside_model_vocabulary() {
        let mut agent = draft_agent();
        agent.session.unattended_mode_id = Some("bypassPermissions".to_string());
        let model = agent
            .session
            .models
            .iter_mut()
            .find(|model| model.controls.contains_key("mode"))
            .expect("claude model mode control");
        let model_id = model.id.clone();
        model
            .controls
            .get_mut("mode")
            .expect("claude model mode control")
            .values
            .retain(|value| value != "bypassPermissions");
        expect_invalid(&agent, &format!("is not supported by model '{model_id}'"));
    }
}
