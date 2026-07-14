//! Credential-fact collection for auth-context classification.
//!
//! Classification must judge the env the spawned CLI will actually run with.
//! Native launches inherit the ambient process env, so restricting to the
//! composed workspace env alone causes classification to diverge from launch
//! reality (e.g. user shell exports CLAUDE_CODE_USE_BEDROCK=1 + AWS creds;
//! CLI runs Bedrock; but classifier picks anthropic-oauth because those vars
//! were absent from the composed env).
//!
//! Collection contract:
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
use std::path::{Path, PathBuf};

use anyharness_credential_discovery::{route_kinds, CredentialFact};

use crate::domains::agents::registry::bundled::bundled_agent_registry_document;
use crate::domains::agents::registry::schema::{AgentRegistryAuthSlotEnvVar, AgentRegistryEnvVarKind};
use crate::domains::agents::route_auth::profile::{
    resolve_profile, AgentRuntimeAuthProfile, ResolvedSource,
};
use crate::domains::agents::route_auth::state::load_state_file;

/// Collect credential facts for classification, merging composed workspace env
/// with registry-bounded ambient process env, AND the enrolled-route facts
/// resolved from workspace-scoped `agent-auth/state.json`. Both call sites
/// (launch_options and create_session) go through this single entry point.
///
/// `runtime_home` is the AnyHarness home whose `agent-auth/state.json` the
/// route reader consults. It uses the same resolution as `route_auth` at
/// launch. A missing, native, or non-gateway state yields no route fact;
/// classification then falls through exactly as before.
pub fn collect_launch_env_facts(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
    runtime_home: &Path,
) -> Vec<CredentialFact> {
    let ambient: BTreeMap<String, String> = std::env::vars().collect();
    let mut facts = collect_launch_env_facts_with_ambient(agent_kind, readiness_env, &ambient);
    facts.extend(collect_route_facts(agent_kind, runtime_home));
    facts
}

/// Route facts from workspace-scoped `agent-auth/state.json`. Reuses
/// `route_auth::resolve_profile` — one reader, two consumers (this collector
/// and the launch-time renderer) — so a classification-visible gateway context
/// exactly tracks a gateway source the launcher would inject. A malformed
/// state file is tolerated as "no route" (stale in the SAFE direction: the
/// gateway context stays gated until the file heals), never an error here.
fn collect_route_facts(agent_kind: &str, runtime_home: &Path) -> Vec<CredentialFact> {
    let state = match load_state_file(runtime_home) {
        Ok(state) => state,
        Err(error) => {
            tracing::debug!(agent_kind, %error, "route state unreadable; no route facts");
            return Vec::new();
        }
    };
    match resolve_profile(state.as_ref(), agent_kind) {
        Ok(AgentRuntimeAuthProfile::Sources(sources)) => {
            let has_gateway = sources
                .sources
                .iter()
                .any(|source| matches!(source, ResolvedSource::Gateway(_)));
            if has_gateway {
                vec![CredentialFact::Route {
                    kind: route_kinds::GATEWAY.to_string(),
                }]
            } else {
                Vec::new()
            }
        }
        Ok(AgentRuntimeAuthProfile::Native) => Vec::new(),
        Err(error) => {
            tracing::debug!(agent_kind, %error, "route profile unresolved; no route facts");
            Vec::new()
        }
    }
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

    fn temp_home() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-route-facts-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(path.join("agent-auth")).expect("create agent-auth dir");
        path
    }

    fn write_state(home: &std::path::Path, json: &str) {
        std::fs::write(home.join("agent-auth").join("state.json"), json).expect("write state");
    }

    /// A gateway source in `agent-auth/state.json` emits a `Route` fact for
    /// that harness, collected beside the env facts.
    #[test]
    fn gateway_source_in_state_emits_route_fact() {
        let home = temp_home();
        write_state(
            &home,
            r#"{"version":2,"revision":1,"harnesses":[
                {"harness_kind":"claude","sources":[
                    {"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
        );

        let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);
        assert!(
            facts
                .iter()
                .any(|fact| matches!(fact, CredentialFact::Route { kind } if kind == "gateway")),
            "gateway source should emit a Route fact; got: {facts:?}"
        );

        // A harness the state file does not configure resolves Native → no
        // route fact.
        let facts = collect_launch_env_facts("codex", &BTreeMap::new(), &home);
        assert!(
            !facts
                .iter()
                .any(|fact| matches!(fact, CredentialFact::Route { .. })),
            "unconfigured harness must not get a route fact; got: {facts:?}"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// An api_key-only source (no gateway) resolves to Sources without a
    /// gateway → no route fact.
    #[test]
    fn api_key_only_source_emits_no_route_fact() {
        let home = temp_home();
        write_state(
            &home,
            r#"{"version":2,"revision":1,"harnesses":[
                {"harness_kind":"claude","sources":[
                    {"kind":"api_key","env_var_name":"ANTHROPIC_API_KEY","value":"sk"}]}]}"#,
        );

        let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);
        assert!(
            !facts
                .iter()
                .any(|fact| matches!(fact, CredentialFact::Route { .. })),
            "api_key-only source must not emit a route fact; got: {facts:?}"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// No state file at all: no route fact, no error (native behavior).
    #[test]
    fn missing_state_file_emits_no_route_fact() {
        let home = temp_home();
        let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);
        assert!(!facts
            .iter()
            .any(|fact| matches!(fact, CredentialFact::Route { .. })));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The classification-coherence guarantee behind the `model=default` fix.
    /// Facts are constructed directly (not via `collect_launch_env_facts`, which
    /// folds ambient process env) so the assertion is deterministic:
    ///
    /// - A CLEAN gateway route (the fixed path — no gateway credential copied
    ///   into the workspace env) classifies `gateway` ONLY, so the model menu is
    ///   gateway-eligible and native-only ids like `default` stay gated.
    /// - The abandoned readiness workaround copied the gateway
    ///   `ANTHROPIC_AUTH_TOKEN` into the workspace env; that token ALSO matches
    ///   the native `anthropic-api` signal, unioning both contexts and unlocking
    ///   native-only models on a gateway launch (→ LiteLLM 400). Pinned so the
    ///   incoherence stays diagnosed and a regression back to it is caught.
    #[test]
    fn gateway_route_classifies_gateway_context_only_with_clean_env() {
        use crate::domains::agents::auth::context::classify;
        use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
        use crate::domains::agents::model::AgentKind;
        use crate::domains::agents::registry::built_in_registry;
        use anyharness_credential_discovery::route_kinds;

        let catalog = bundled_agent_catalog_document();
        let contexts = catalog
            .agents
            .iter()
            .find(|agent| agent.kind == "claude")
            .map(|agent| agent.auth_contexts.as_slice())
            .expect("claude auth contexts in bundled catalog");
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Claude)
            .expect("claude descriptor");

        let gateway_fact = CredentialFact::Route {
            kind: route_kinds::GATEWAY.to_string(),
        };

        let clean = classify(&descriptor, contexts, std::slice::from_ref(&gateway_fact));
        assert_eq!(
            clean.ids(),
            &["gateway".to_string()],
            "a clean gateway route must classify gateway-only; got {:?}",
            clean.ids()
        );

        let workaround = classify(
            &descriptor,
            contexts,
            &[
                CredentialFact::Env {
                    var: "ANTHROPIC_AUTH_TOKEN".to_string(),
                },
                gateway_fact,
            ],
        );
        assert!(
            workaround.is_active("anthropic-api") && workaround.is_active("gateway"),
            "the workspace-env workaround unions native+gateway (the bug the \
             readiness fix removes); got {:?}",
            workaround.ids()
        );
    }
}
