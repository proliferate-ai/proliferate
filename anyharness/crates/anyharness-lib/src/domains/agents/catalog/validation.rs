//! Document-local invariants for the distribution/presentation catalog.
//!
//! Executable model, control, default, setting, gateway-seed, and unattended
//! mode rules are absent because those values no longer exist in this schema.

use std::collections::HashSet;

use chrono::DateTime;

use super::schema::{
    AgentCatalogAgent, AgentCatalogArtifactPin, AgentCatalogArtifactSource,
    AgentCatalogAuthContext, AgentCatalogAuthSignal, AgentCatalogDocument,
};
use crate::domains::agents::model::AgentKind;

pub const BASELINE_AUTH_CONTEXT_ID: &str = "baseline";
const MAX_SIGNAL_DEPTH: usize = 2;

pub fn validate_agent_catalog_document(catalog: &AgentCatalogDocument) -> anyhow::Result<()> {
    if catalog.schema_version != 2 {
        anyhow::bail!("agent catalog v2 schema version is not supported");
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
        validate_agent(agent, &mut seen_agents)?;
    }
    Ok(())
}

fn validate_agent(
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
    if agent.harness.agent_process.version.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{}' agentProcess pin version is empty",
            agent.kind
        );
    }
    validate_artifact_pin(&agent.kind, "agentProcess", &agent.harness.agent_process)?;
    if let Some(native) = &agent.harness.native {
        if native.version.trim().is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' native pin version is empty",
                agent.kind
            );
        }
        validate_artifact_pin(&agent.kind, "native", native)?;
    }

    let mut context_ids = HashSet::new();
    for context in &agent.auth_contexts {
        validate_auth_context(&agent.kind, context, &mut context_ids)?;
    }

    let mut presentation_model_ids = HashSet::new();
    for model in &agent.session.presentation_models {
        if model.id.trim().is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' has presentation model with empty id",
                agent.kind
            );
        }
        if !presentation_model_ids.insert(model.id.clone()) {
            anyhow::bail!(
                "agent catalog agent '{}' presentation model '{}' is duplicated",
                agent.kind,
                model.id
            );
        }
        if model.display_name.trim().is_empty() {
            anyhow::bail!(
                "agent catalog agent '{}' presentation model '{}' display name is empty",
                agent.kind,
                model.id
            );
        }
    }
    Ok(())
}

fn validate_artifact_pin(
    kind: &str,
    role: &str,
    pin: &AgentCatalogArtifactPin,
) -> anyhow::Result<()> {
    let Some(source) = &pin.source else {
        return Ok(());
    };
    match source {
        AgentCatalogArtifactSource::Binary { targets } => {
            validate_pin_targets(kind, role, targets)?;
        }
        AgentCatalogArtifactSource::Archive {
            targets,
            companions,
            ..
        } => {
            validate_pin_targets(kind, role, targets)?;
            for companion in companions {
                if companion.name.trim().is_empty() {
                    anyhow::bail!("agent '{kind}' {role} archive companion has empty name");
                }
                let companion_role = format!("{role} companion '{}'", companion.name);
                validate_pin_targets(kind, &companion_role, &companion.targets)?;
            }
        }
        AgentCatalogArtifactSource::Npm { package, .. } => {
            if package.trim().is_empty() {
                anyhow::bail!("agent '{kind}' {role} npm source has empty package");
            }
        }
        AgentCatalogArtifactSource::Git {
            repo,
            git_ref,
            executable_relpath,
            ..
        } => {
            if repo.trim().is_empty()
                || git_ref.trim().is_empty()
                || executable_relpath.trim().is_empty()
            {
                anyhow::bail!("agent '{kind}' {role} git source is incomplete");
            }
        }
    }
    Ok(())
}

fn validate_pin_targets(
    kind: &str,
    role: &str,
    targets: &std::collections::BTreeMap<String, super::schema::AgentCatalogPinTarget>,
) -> anyhow::Result<()> {
    if targets.is_empty() {
        anyhow::bail!("agent '{kind}' {role} source has no platform targets");
    }
    for (platform, target) in targets {
        if target.url.trim().is_empty() {
            anyhow::bail!("agent '{kind}' {role} target '{platform}' has empty url");
        }
        if target.sha256.trim().is_empty() {
            anyhow::bail!("agent '{kind}' {role} target '{platform}' has empty sha256");
        }
    }
    Ok(())
}

fn validate_auth_context(
    agent_kind: &str,
    context: &AgentCatalogAuthContext,
    seen: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if context.id.trim().is_empty() {
        anyhow::bail!("agent catalog agent '{agent_kind}' has empty auth context id");
    }
    if !seen.insert(context.id.clone()) {
        anyhow::bail!(
            "agent catalog agent '{agent_kind}' auth context '{}' is duplicated",
            context.id
        );
    }
    if context.id == BASELINE_AUTH_CONTEXT_ID {
        if context.auth_slot_id.is_some() {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' baseline auth context must not have authSlotId"
            );
        }
        if context.signals.is_some() {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' baseline auth context must not have signals"
            );
        }
        return Ok(());
    }
    if context
        .auth_slot_id
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        anyhow::bail!(
            "agent catalog agent '{agent_kind}' auth context '{}' is missing authSlotId",
            context.id
        );
    }
    if let Some(signal) = &context.signals {
        if signal.depth() > MAX_SIGNAL_DEPTH {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' auth context '{}' signals exceed depth {MAX_SIGNAL_DEPTH}",
                context.id
            );
        }
        validate_signal(agent_kind, &context.id, signal)?;
    }
    Ok(())
}

fn validate_signal(
    agent_kind: &str,
    context_id: &str,
    signal: &AgentCatalogAuthSignal,
) -> anyhow::Result<()> {
    match signal {
        AgentCatalogAuthSignal::Env(value)
        | AgentCatalogAuthSignal::Discovery(value)
        | AgentCatalogAuthSignal::Route(value) => {
            if value.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' has empty signal"
                );
            }
        }
        AgentCatalogAuthSignal::EnvFlag(value) => {
            let valid = value
                .split_once('=')
                .is_some_and(|(key, value)| !key.trim().is_empty() && !value.trim().is_empty());
            if !valid {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' envFlag signal '{value}' is not 'VAR=value'"
                );
            }
        }
        AgentCatalogAuthSignal::AnyOf(children) | AgentCatalogAuthSignal::AllOf(children) => {
            if children.is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' has empty signal combinator"
                );
            }
            for child in children {
                validate_signal(agent_kind, context_id, child)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::canonical_catalog_json;

    fn canonical_catalog() -> AgentCatalogDocument {
        serde_json::from_str(canonical_catalog_json()).expect("canonical catalog must parse")
    }

    #[test]
    fn canonical_catalog_validates() {
        validate_agent_catalog_document(&canonical_catalog())
            .expect("canonical catalog must validate");
    }

    #[test]
    fn rejects_duplicate_presentation_model_ids() {
        let mut catalog = canonical_catalog();
        let duplicate = catalog.agents[0].session.presentation_models[0].clone();
        catalog.agents[0]
            .session
            .presentation_models
            .push(duplicate);
        let error = validate_agent_catalog_document(&catalog).expect_err("duplicate must fail");
        assert!(error.to_string().contains("presentation model"));
    }

    #[test]
    fn rejects_duplicate_auth_context_ids() {
        let mut catalog = canonical_catalog();
        let duplicate = catalog.agents[0].auth_contexts[0].clone();
        catalog.agents[0].auth_contexts.push(duplicate);
        let error = validate_agent_catalog_document(&catalog).expect_err("duplicate must fail");
        assert!(error.to_string().contains("auth context"));
    }
}
