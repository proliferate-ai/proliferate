//! Cross-document invariants pairing a v2 agent catalog with the registry
//! it was probed against. Run wherever a registry pairing is in scope
//! (build pipeline, sync validation); the current draft pins no registry
//! (`probedAgainst.registryVersion: null`) and references slots a future
//! registry revision will declare, so this is a separate entry rather than
//! part of the loader path.

use super::schema::{AgentCatalogAuthSignal, AgentCatalogDocument};
use super::validation::BASELINE_AUTH_CONTEXT_ID;
use crate::domains::agents::registry::schema::{
    AgentRegistryAuthSlot, AgentRegistryDocument, AgentRegistryEnvVarKind,
};

/// Cross-document invariants against the registry the catalog was probed
/// against: every non-baseline `authSlotId` must name a registry auth slot
/// on the same agent kind, and signal vocabulary must be a subset of what
/// the slot declares (env vars with their secret|flag tags, discovery
/// kinds). Slots that declare no vocabulary are validated structurally only.
///
/// TODO(PR-7a): once registry.json carries the source vocabulary (flag tags
/// on CLAUDE_CODE_USE_BEDROCK-style vars, named discovery kinds), pair this
/// check with the pinned registry in the build pipeline and sync path.
pub fn validate_agent_catalog_registry_pairing(
    catalog: &AgentCatalogDocument,
    registry: &AgentRegistryDocument,
) -> anyhow::Result<()> {
    for agent in &catalog.agents {
        let registry_agent = registry
            .agents
            .iter()
            .find(|candidate| candidate.kind == agent.kind)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "agent catalog agent '{}' is not in the registry",
                    agent.kind
                )
            })?;
        for context in &agent.auth_contexts {
            if context.id == BASELINE_AUTH_CONTEXT_ID {
                continue;
            }
            let slot_id = context.auth_slot_id.as_deref().unwrap_or_default();
            let slot = registry_agent
                .auth
                .slots
                .iter()
                .find(|slot| slot.id == slot_id)
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "agent catalog agent '{}' auth context '{}' references unknown registry auth slot '{slot_id}'",
                        agent.kind,
                        context.id
                    )
                })?;
            if let Some(signals) = &context.signals {
                validate_signal_vocabulary(&agent.kind, &context.id, signals, slot)?;
            }
        }
    }
    Ok(())
}

fn validate_signal_vocabulary(
    agent_kind: &str,
    context_id: &str,
    signal: &AgentCatalogAuthSignal,
    slot: &AgentRegistryAuthSlot,
) -> anyhow::Result<()> {
    match signal {
        AgentCatalogAuthSignal::Env(var) => {
            if !slot.env_vars.is_empty() && declared_env_var_kind(slot, var).is_none() {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' env signal '{var}' is not in registry slot '{}' env vars",
                    slot.id
                );
            }
        }
        AgentCatalogAuthSignal::EnvFlag(flag) => {
            let var = flag.split_once('=').map(|(var, _)| var).unwrap_or(flag);
            match declared_env_var_kind(slot, var) {
                Some(AgentRegistryEnvVarKind::Flag) => {}
                Some(AgentRegistryEnvVarKind::Secret) => anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' envFlag signal '{var}' is a secret env var in registry slot '{}'",
                    slot.id
                ),
                None if !slot.env_vars.is_empty() => anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' envFlag signal '{var}' is not in registry slot '{}' env vars",
                    slot.id
                ),
                None => {}
            }
        }
        AgentCatalogAuthSignal::Discovery(kind) => {
            if !slot.discovery_kinds.is_empty()
                && !slot.discovery_kinds.iter().any(|declared| declared == kind)
            {
                anyhow::bail!(
                    "agent catalog agent '{agent_kind}' auth context '{context_id}' discovery signal '{kind}' is not in registry slot '{}' discovery kinds",
                    slot.id
                );
            }
        }
        AgentCatalogAuthSignal::AnyOf(children) | AgentCatalogAuthSignal::AllOf(children) => {
            for child in children {
                validate_signal_vocabulary(agent_kind, context_id, child, slot)?;
            }
        }
    }
    Ok(())
}

fn declared_env_var_kind(
    slot: &AgentRegistryAuthSlot,
    var: &str,
) -> Option<AgentRegistryEnvVarKind> {
    slot.env_vars
        .iter()
        .find(|env_var| env_var.name() == var)
        .map(|env_var| env_var.kind())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::draft_catalog_json;
    use crate::domains::agents::catalog::validation::validate_agent_catalog_document;
    use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
    use crate::domains::agents::registry::schema::AgentRegistryAuthSlotEnvVar;

    fn draft_catalog() -> AgentCatalogDocument {
        serde_json::from_str(draft_catalog_json()).expect("draft catalog must parse")
    }

    fn signal(json: serde_json::Value) -> AgentCatalogAuthSignal {
        serde_json::from_value(json).expect("signal must parse")
    }

    /// Pairing fixture: the draft's auth contexts reference slots a future
    /// registry revision will declare, so pairing tests use a hand-trimmed
    /// catalog whose contexts resolve against the bundled registry.
    fn pairing_catalog(signals: Option<serde_json::Value>) -> AgentCatalogDocument {
        let mut catalog = draft_catalog();
        catalog.agents.truncate(1);
        let claude = &mut catalog.agents[0];
        claude
            .auth_contexts
            .retain(|context| context.id == "anthropic-api");
        claude.auth_contexts[0].auth_slot_id = Some("anthropic".to_string());
        claude.auth_contexts[0].signals = signals.map(signal);
        claude.session.models.retain(|model| {
            model
                .availability
                .any_of
                .contains(&"anthropic-api".to_string())
        });
        for model in &mut claude.session.models {
            model.availability.any_of.retain(|id| id == "anthropic-api");
        }
        validate_agent_catalog_document(&catalog).expect("pairing fixture must validate");
        catalog
    }

    #[test]
    fn pairing_accepts_known_slot_and_declared_env_vars() {
        let catalog = pairing_catalog(Some(serde_json::json!({ "env": "ANTHROPIC_API_KEY" })));
        let registry = bundled_agent_registry_document();

        validate_agent_catalog_registry_pairing(&catalog, registry)
            .expect("known slot + declared env var must pass");
    }

    #[test]
    fn pairing_rejects_unknown_auth_slot() {
        let mut catalog = pairing_catalog(None);
        catalog.agents[0].auth_contexts[0].auth_slot_id = Some("anthropic-vertex".to_string());
        let registry = bundled_agent_registry_document();

        let error = validate_agent_catalog_registry_pairing(&catalog, registry)
            .expect_err("unknown slot must fail");

        assert!(
            error
                .to_string()
                .contains("references unknown registry auth slot 'anthropic-vertex'"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn pairing_rejects_env_signal_outside_slot_vocabulary() {
        let catalog = pairing_catalog(Some(serde_json::json!({ "env": "NOT_A_DECLARED_VAR" })));
        let registry = bundled_agent_registry_document();

        let error = validate_agent_catalog_registry_pairing(&catalog, registry)
            .expect_err("undeclared env var must fail");

        assert!(
            error
                .to_string()
                .contains("env signal 'NOT_A_DECLARED_VAR' is not in registry slot 'anthropic'"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn pairing_rejects_env_flag_signal_on_secret_var() {
        let catalog = pairing_catalog(Some(
            serde_json::json!({ "envFlag": "ANTHROPIC_API_KEY=1" }),
        ));
        let registry = bundled_agent_registry_document();

        let error = validate_agent_catalog_registry_pairing(&catalog, registry)
            .expect_err("envFlag on a secret var must fail");

        assert!(
            error.to_string().contains("is a secret env var"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn pairing_accepts_flag_tagged_env_flag_and_declared_discovery_kind() {
        let catalog = pairing_catalog(Some(serde_json::json!({
            "allOf": [
                { "envFlag": "CLAUDE_CODE_USE_BEDROCK=1" },
                { "discovery": "aws-credential-chain" }
            ]
        })));
        let mut registry = bundled_agent_registry_document().clone();
        let slot = registry.agents[0]
            .auth
            .slots
            .iter_mut()
            .find(|slot| slot.id == "anthropic")
            .expect("anthropic slot");
        slot.env_vars.push(AgentRegistryAuthSlotEnvVar::Tagged {
            name: "CLAUDE_CODE_USE_BEDROCK".to_string(),
            kind: AgentRegistryEnvVarKind::Flag,
        });
        slot.discovery_kinds = vec!["aws-credential-chain".to_string()];

        validate_agent_catalog_registry_pairing(&catalog, &registry)
            .expect("bedrock-style signature must pass against tagged vocabulary");
    }

    #[test]
    fn pairing_rejects_discovery_signal_outside_declared_kinds() {
        let catalog = pairing_catalog(Some(
            serde_json::json!({ "discovery": "claude-oauth-creds" }),
        ));
        let mut registry = bundled_agent_registry_document().clone();
        let slot = registry.agents[0]
            .auth
            .slots
            .iter_mut()
            .find(|slot| slot.id == "anthropic")
            .expect("anthropic slot");
        slot.discovery_kinds = vec!["aws-credential-chain".to_string()];

        let error = validate_agent_catalog_registry_pairing(&catalog, &registry)
            .expect_err("undeclared discovery kind must fail");

        assert!(
            error
                .to_string()
                .contains("discovery signal 'claude-oauth-creds' is not in registry slot"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn pairing_waives_discovery_check_when_slot_declares_no_kinds() {
        // registry.json has no discovery kinds yet (PR-7a vocabulary):
        // structural validation only.
        let catalog = pairing_catalog(Some(
            serde_json::json!({ "discovery": "claude-oauth-creds" }),
        ));
        let registry = bundled_agent_registry_document();

        validate_agent_catalog_registry_pairing(&catalog, registry)
            .expect("undeclared vocabulary must waive the subset check");
    }
}
