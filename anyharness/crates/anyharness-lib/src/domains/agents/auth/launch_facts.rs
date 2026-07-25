//! Credential-fact collection for auth-context classification.
//!
//! Classification must judge the env the spawned CLI will actually run with.
//! Native launches inherit the ambient process env, so restricting to the
//! composed workspace env alone causes classification to diverge from launch
//! reality (e.g. user shell exports CLAUDE_CODE_USE_BEDROCK=1 + AWS creds;
//! CLI runs Bedrock; but classifier picks anthropic-oauth because those vars
//! were absent from the composed env).
//!
//! Amended rule (supersedes decisions ledger 8 "never ambient"):
//! - Env-key presence set: composed keys UNION ambient keys that are
//!   REGISTRY-DECLARED for the harness kind. Nothing outside the registry's
//!   declared vars is ever read from ambient.
//! - Flag values (EnvFlag kind vars only): composed value WINS on conflict;
//!   ambient fills gaps only.
//! - Ambient is bounded to registry-declared vars — the registry document
//!   enumerates slot env_vars per harness.
//!
//! This is the effectful doorstep in front of the pure classifier
//! (`context::classify`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use anyharness_credential_discovery::CredentialFact;

use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::{AgentRegistryAuthSlotEnvVar, AgentRegistryEnvVarKind};

/// Collect credential facts for classification, merging composed workspace env
/// with registry-bounded ambient process env. Both call sites
/// (launch_options and create_session) go through this single entry point.
pub fn collect_launch_env_facts(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
) -> Vec<CredentialFact> {
    let ambient: BTreeMap<String, String> = std::env::vars().collect();
    collect_launch_env_facts_with_ambient(agent_kind, readiness_env, &ambient)
}

/// Pure-logic core: testable without mutating the process environment.
/// `ambient_env` represents the full process env snapshot; only
/// registry-declared vars for `agent_kind` are consulted from it.
pub(crate) fn collect_launch_env_facts_with_ambient(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
    ambient_env: &BTreeMap<String, String>,
) -> Vec<CredentialFact> {
    // Collect registry-declared env vars for this harness kind.
    let mut registry_vars: Vec<&AgentRegistryAuthSlotEnvVar> = Vec::new();
    if let Some(agent) = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == agent_kind)
    {
        for slot in &agent.auth.slots {
            for env_var in &slot.env_vars {
                registry_vars.push(env_var);
            }
        }
    }

    // Build the merged env-key presence set and flag values.
    // Composed always wins; ambient fills gaps for registry-declared vars only.
    let mut env_keys: BTreeSet<String> = readiness_env.keys().cloned().collect();
    let mut flag_values: BTreeMap<String, String> = BTreeMap::new();

    for reg_var in &registry_vars {
        let name = reg_var.name();

        // Add ambient presence for registry-declared vars not in composed env.
        if !readiness_env.contains_key(name) && ambient_env.contains_key(name) {
            env_keys.insert(name.to_string());
        }

        // Collect flag values: composed wins, ambient fills gaps.
        if reg_var.kind() == AgentRegistryEnvVarKind::Flag {
            if let Some(value) = readiness_env.get(name) {
                flag_values.insert(name.to_string(), value.clone());
            } else if let Some(value) = ambient_env.get(name) {
                flag_values.insert(name.to_string(), value.clone());
            }
        }
    }

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    anyharness_credential_discovery::collect_facts(&home_dir, &env_keys, &flag_values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_credential_discovery::CredentialFact;

    /// (a) Ambient registry-declared flag var + discovery fact → bedrock
    /// classifies for claude even with empty composed env.
    #[test]
    fn ambient_flag_var_contributes_to_classification() {
        let composed: BTreeMap<String, String> = BTreeMap::new();
        let ambient: BTreeMap<String, String> = [
            ("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string()),
        ]
        .into_iter()
        .collect();

        let facts = collect_launch_env_facts_with_ambient("claude", &composed, &ambient);

        assert!(
            facts.contains(&CredentialFact::EnvFlag {
                var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
                value: "1".to_string(),
            }),
            "ambient flag var should produce EnvFlag fact; got: {facts:?}"
        );
    }

    /// (b) Composed value beats ambient value for the same flag var.
    #[test]
    fn composed_flag_value_wins_over_ambient() {
        let composed: BTreeMap<String, String> = [(
            "CLAUDE_CODE_USE_BEDROCK".to_string(),
            "0".to_string(),
        )]
        .into_iter()
        .collect();
        let ambient: BTreeMap<String, String> = [(
            "CLAUDE_CODE_USE_BEDROCK".to_string(),
            "1".to_string(),
        )]
        .into_iter()
        .collect();

        let facts = collect_launch_env_facts_with_ambient("claude", &composed, &ambient);

        assert!(
            facts.contains(&CredentialFact::EnvFlag {
                var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
                value: "0".to_string(),
            }),
            "composed value should win over ambient; got: {facts:?}"
        );
        assert!(
            !facts.contains(&CredentialFact::EnvFlag {
                var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
                value: "1".to_string(),
            }),
            "ambient value should NOT appear when composed overrides"
        );
    }

    /// (c) Ambient var NOT in registry is ignored.
    #[test]
    fn ambient_non_registry_var_ignored() {
        let composed: BTreeMap<String, String> = BTreeMap::new();
        let ambient: BTreeMap<String, String> = [(
            "TOTALLY_UNKNOWN_VAR_XYZ".to_string(),
            "secret".to_string(),
        )]
        .into_iter()
        .collect();

        let facts = collect_launch_env_facts_with_ambient("claude", &composed, &ambient);

        assert!(
            !facts.contains(&CredentialFact::Env {
                var: "TOTALLY_UNKNOWN_VAR_XYZ".to_string(),
            }),
            "non-registry ambient vars must never leak into facts; got: {facts:?}"
        );
    }

    /// (d) Existing composed-only behavior unchanged — composed env vars
    /// produce facts regardless of ambient state.
    #[test]
    fn composed_only_behavior_unchanged() {
        let composed: BTreeMap<String, String> = [
            ("ANTHROPIC_API_KEY".to_string(), "sk-ant-xxx".to_string()),
            ("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string()),
        ]
        .into_iter()
        .collect();
        let ambient: BTreeMap<String, String> = BTreeMap::new();

        let facts = collect_launch_env_facts_with_ambient("claude", &composed, &ambient);

        assert!(
            facts.contains(&CredentialFact::Env {
                var: "ANTHROPIC_API_KEY".to_string(),
            }),
            "composed secret var should produce Env fact; got: {facts:?}"
        );
        assert!(
            facts.contains(&CredentialFact::EnvFlag {
                var: "CLAUDE_CODE_USE_BEDROCK".to_string(),
                value: "1".to_string(),
            }),
            "composed flag var should produce EnvFlag fact; got: {facts:?}"
        );
    }

    /// Ambient registry-declared secret var (non-flag) contributes presence
    /// but NOT value.
    #[test]
    fn ambient_secret_var_contributes_presence_only() {
        let composed: BTreeMap<String, String> = BTreeMap::new();
        let ambient: BTreeMap<String, String> = [(
            "ANTHROPIC_API_KEY".to_string(),
            "sk-ant-secret".to_string(),
        )]
        .into_iter()
        .collect();

        let facts = collect_launch_env_facts_with_ambient("claude", &composed, &ambient);

        assert!(
            facts.contains(&CredentialFact::Env {
                var: "ANTHROPIC_API_KEY".to_string(),
            }),
            "ambient secret var should produce presence-only Env fact; got: {facts:?}"
        );
        // Value must NOT appear anywhere — secrets are presence-only.
        for fact in &facts {
            match fact {
                CredentialFact::EnvFlag { var, .. } => {
                    assert_ne!(var, "ANTHROPIC_API_KEY", "secret var must not produce EnvFlag");
                }
                _ => {}
            }
        }
    }
}
