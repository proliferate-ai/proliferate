//! Document-local invariants for the v2 agent catalog, always enforced (the
//! loader runs [`validate_agent_catalog_document`] on every v2 parse).
//! Cross-document checks against the registry the catalog was probed
//! against live in `validation_pairing.rs`.

use std::collections::HashSet;

use chrono::DateTime;

use super::schema::{
    AgentCatalogAgent, AgentCatalogArtifactPin, AgentCatalogArtifactSource, AgentCatalogAuthContext,
    AgentCatalogAuthSignal, AgentCatalogDocument, AgentCatalogModel,
};
use crate::domains::agents::model::AgentKind;

/// Reserved auth-context id meaning "no credentials at all".
pub const BASELINE_AUTH_CONTEXT_ID: &str = "baseline";

/// Maximum signal nesting depth: one combinator over leaves, nothing deeper.
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

    if agent.session.models.is_empty() {
        anyhow::bail!("agent catalog agent '{}' has no models", agent.kind);
    }
    let mut seen_models = HashSet::new();
    for model in &agent.session.models {
        validate_model(&agent.kind, model, &context_ids, &mut seen_models)?;
    }
    Ok(())
}

/// A resolved pin source is the lockfile's executable truth, so its fields must
/// be materializable: per-target downloads need a url and the trust-anchor
/// sha256; npm/git need a package/ref. A pin with no source is fine (legacy).
fn validate_artifact_pin(kind: &str, role: &str, pin: &AgentCatalogArtifactPin) -> anyhow::Result<()> {
    let Some(source) = &pin.source else {
        return Ok(());
    };
    match source {
        AgentCatalogArtifactSource::Binary { targets }
        | AgentCatalogArtifactSource::Archive { targets } => {
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
            if repo.trim().is_empty() || git_ref.trim().is_empty() {
                anyhow::bail!("agent '{kind}' {role} git source needs repo and gitRef");
            }
            if executable_relpath.trim().is_empty() {
                anyhow::bail!("agent '{kind}' {role} git source needs executableRelpath");
            }
        }
    }
    Ok(())
}

fn validate_auth_context(
    agent_kind: &str,
    context: &AgentCatalogAuthContext,
    context_ids: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if context.id.trim().is_empty() {
        anyhow::bail!("agent catalog agent '{agent_kind}' has empty auth context id");
    }
    if !context_ids.insert(context.id.clone()) {
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
    match context.auth_slot_id.as_deref() {
        Some(slot_id) if !slot_id.trim().is_empty() => {}
        _ => anyhow::bail!(
            "agent catalog agent '{agent_kind}' auth context '{}' is missing authSlotId",
            context.id
        ),
    }
    if let Some(signals) = &context.signals {
        validate_signal(agent_kind, &context.id, signals)?;
        if signals.depth() > MAX_SIGNAL_DEPTH {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' auth context '{}' signals exceed depth {MAX_SIGNAL_DEPTH}",
                context.id
            );
        }
    }
    Ok(())
}

fn validate_signal(
    agent_kind: &str,
    context_id: &str,
    signal: &AgentCatalogAuthSignal,
) -> anyhow::Result<()> {
    match signal {
        AgentCatalogAuthSignal::Env(var) => {
            if var.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' has empty env signal"
                );
            }
        }
        AgentCatalogAuthSignal::EnvFlag(flag) => {
            let valid = flag
                .split_once('=')
                .is_some_and(|(var, value)| !var.trim().is_empty() && !value.trim().is_empty());
            if !valid {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' envFlag signal '{flag}' is not 'VAR=value'"
                );
            }
        }
        AgentCatalogAuthSignal::Discovery(kind) => {
            if kind.trim().is_empty() {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' has empty discovery signal"
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

fn validate_model(
    agent_kind: &str,
    model: &AgentCatalogModel,
    context_ids: &HashSet<String>,
    seen_models: &mut HashSet<String>,
) -> anyhow::Result<()> {
    if model.id.trim().is_empty() {
        anyhow::bail!("agent catalog agent '{agent_kind}' has empty model id");
    }
    if !seen_models.insert(model.id.clone()) {
        anyhow::bail!(
            "agent catalog agent '{agent_kind}' model '{}' is duplicated",
            model.id
        );
    }
    if model.display_name.trim().is_empty() {
        anyhow::bail!(
            "agent catalog agent '{agent_kind}' model '{}' display name is empty",
            model.id
        );
    }
    if model.availability.any_of.is_empty() {
        anyhow::bail!(
            "agent catalog agent '{agent_kind}' model '{}' has empty availability",
            model.id
        );
    }
    for context_id in &model.availability.any_of {
        if context_id != BASELINE_AUTH_CONTEXT_ID && !context_ids.contains(context_id) {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' model '{}' availability references unknown auth context '{context_id}'",
                model.id
            );
        }
    }
    for (control_key, control) in &model.controls {
        if control.values.is_empty() {
            anyhow::bail!(
                "agent catalog agent '{agent_kind}' model '{}' control '{control_key}' has no values",
                model.id
            );
        }
        if let Some(default) = control.default.as_deref() {
            if !control.values.iter().any(|value| value == default) {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' model '{}' control '{control_key}' default '{default}' is not a value",
                    model.id
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::draft_catalog_json;

    fn draft_catalog() -> AgentCatalogDocument {
        serde_json::from_str(draft_catalog_json()).expect("draft catalog must parse")
    }

    fn signal(json: serde_json::Value) -> AgentCatalogAuthSignal {
        serde_json::from_value(json).expect("signal must parse")
    }

    fn expect_invalid(catalog: &AgentCatalogDocument, expected_fragment: &str) {
        let error = validate_agent_catalog_document(catalog).expect_err("catalog must be invalid");
        assert!(
            error.to_string().contains(expected_fragment),
            "expected '{expected_fragment}' in: {error}"
        );
    }

    #[test]
    fn draft_catalog_validates() {
        validate_agent_catalog_document(&draft_catalog()).expect("draft catalog must validate");
    }

    #[test]
    fn rejects_empty_catalog_version() {
        let mut catalog = draft_catalog();
        catalog.catalog_version = "  ".to_string();
        expect_invalid(&catalog, "catalog version is empty");
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let mut catalog = draft_catalog();
        catalog.schema_version = 3;
        expect_invalid(&catalog, "schema version is not supported");
    }

    #[test]
    fn rejects_duplicate_model_ids() {
        let mut catalog = draft_catalog();
        let claude = &mut catalog.agents[0];
        let duplicate = claude.session.models[0].clone();
        claude.session.models.push(duplicate);
        expect_invalid(&catalog, "model 'sonnet' is duplicated");
    }

    #[test]
    fn rejects_duplicate_auth_context_ids() {
        let mut catalog = draft_catalog();
        let claude = &mut catalog.agents[0];
        let duplicate = claude.auth_contexts[0].clone();
        claude.auth_contexts.push(duplicate);
        expect_invalid(&catalog, "auth context 'bedrock' is duplicated");
    }

    #[test]
    fn rejects_availability_referencing_unknown_auth_context() {
        let mut catalog = draft_catalog();
        let claude = &mut catalog.agents[0];
        claude.session.models[0]
            .availability
            .any_of
            .push("anthropic-vertex".to_string());
        expect_invalid(
            &catalog,
            "availability references unknown auth context 'anthropic-vertex'",
        );
    }

    #[test]
    fn accepts_baseline_availability_without_declared_baseline_context() {
        let mut catalog = draft_catalog();
        let claude = &mut catalog.agents[0];
        claude.session.models[0]
            .availability
            .any_of
            .push(BASELINE_AUTH_CONTEXT_ID.to_string());
        validate_agent_catalog_document(&catalog).expect("baseline is always a known context");
    }

    #[test]
    fn rejects_non_baseline_auth_context_without_slot_id() {
        let mut catalog = draft_catalog();
        catalog.agents[0].auth_contexts[0].auth_slot_id = None;
        expect_invalid(&catalog, "auth context 'bedrock' is missing authSlotId");
    }

    #[test]
    fn rejects_baseline_auth_context_with_slot_id_or_signals() {
        let mut catalog = draft_catalog();
        let baseline = catalog.agents[4]
            .auth_contexts
            .iter_mut()
            .find(|context| context.id == BASELINE_AUTH_CONTEXT_ID)
            .expect("opencode baseline context");
        baseline.auth_slot_id = Some("anthropic".to_string());
        expect_invalid(&catalog, "baseline auth context must not have authSlotId");

        let mut catalog = draft_catalog();
        let baseline = catalog.agents[4]
            .auth_contexts
            .iter_mut()
            .find(|context| context.id == BASELINE_AUTH_CONTEXT_ID)
            .expect("opencode baseline context");
        baseline.signals = Some(signal(serde_json::json!({ "env": "ANTHROPIC_API_KEY" })));
        expect_invalid(&catalog, "baseline auth context must not have signals");
    }

    #[test]
    fn rejects_signals_deeper_than_two_levels() {
        let mut catalog = draft_catalog();
        catalog.agents[0].auth_contexts[0].signals = Some(signal(serde_json::json!({
            "anyOf": [
                { "allOf": [ { "env": "ANTHROPIC_API_KEY" } ] }
            ]
        })));
        expect_invalid(&catalog, "signals exceed depth 2");
    }

    #[test]
    fn rejects_empty_signal_combinator_and_malformed_env_flag() {
        let mut catalog = draft_catalog();
        catalog.agents[0].auth_contexts[0].signals =
            Some(signal(serde_json::json!({ "anyOf": [] })));
        expect_invalid(&catalog, "empty signal combinator");

        let mut catalog = draft_catalog();
        catalog.agents[0].auth_contexts[0].signals = Some(signal(
            serde_json::json!({ "envFlag": "CLAUDE_CODE_USE_BEDROCK" }),
        ));
        expect_invalid(&catalog, "is not 'VAR=value'");
    }

    #[test]
    fn rejects_model_control_default_outside_values() {
        let mut catalog = draft_catalog();
        let sonnet = &mut catalog.agents[0].session.models[0];
        let effort = sonnet.controls.get_mut("effort").expect("effort control");
        effort.default = Some("xhigh".to_string());
        expect_invalid(&catalog, "default 'xhigh' is not a value");
    }
}
