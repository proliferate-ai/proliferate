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
use crate::domains::agents::registry::schema::{
    AgentRegistryAuthSlotEnvVar, AgentRegistryEnvVarKind,
};
use crate::domains::agents::route_auth::profile::{AgentRuntimeAuthProfile, ResolvedSource};
use crate::domains::agents::route_auth::resolve_launch_auth_profile;

/// Collect credential facts for classification from the auth profile the
/// launcher will actually use. Native profiles merge composed workspace env
/// with registry-bounded ambient process env. Explicit sources replace those
/// native facts for single-source harnesses; OpenCode intentionally composes
/// both. Both call sites (launch_options and create_session) go through this
/// single entry point.
///
/// `runtime_home` is the AnyHarness home whose `agent-auth/state.json` the
/// route reader consults, including the same server-origin guard as launch.
pub fn collect_launch_env_facts(
    agent_kind: &str,
    readiness_env: &BTreeMap<String, String>,
    runtime_home: &Path,
) -> Vec<CredentialFact> {
    let ambient: BTreeMap<String, String> = std::env::vars().collect();
    let native_facts =
        || collect_launch_env_facts_with_ambient(agent_kind, readiness_env, &ambient);
    match resolve_launch_auth_profile(runtime_home, agent_kind) {
        Ok(profile @ AgentRuntimeAuthProfile::Sources(_)) => {
            let mut facts = collect_enrolled_source_facts(&profile);
            // OpenCode intentionally composes injected sources with its native
            // providers. Every other supported routed harness is single-source:
            // its selected route must mask ambient/native credentials exactly as
            // the launch renderer does.
            if agent_kind == "opencode" {
                facts.extend(native_facts());
            }
            facts
        }
        Ok(AgentRuntimeAuthProfile::Native) => native_facts(),
        Err(error) => {
            tracing::debug!(agent_kind, %error, "route profile unresolved; native facts govern");
            native_facts()
        }
    }
}

/// Facts derived from the enrolled credential sources in workspace-scoped
/// `agent-auth/state.json`. Reuses the launch-time route resolver — one reader,
/// two consumers (this collector and the renderer) — so a classification-
/// visible context exactly tracks a source the launcher would inject. Route
/// resolution errors are logged and leave native/composed facts in control,
/// preserving the collector's existing non-fatal behavior.
///
/// Per source kind:
/// - `gateway` → a single [`CredentialFact::Route`] for the gateway route
///   (`anthropic-api`-style native contexts must NOT match; the gateway context
///   matches its `Route` signal). No api_key route fact is ever emitted.
/// - `api_key` → a presence-only [`CredentialFact::Env`] for the source's
///   `env_var_name`. This is the BYOK path: on the local surface the raw key is
///   enrolled in state.json (not the composed workspace env), so without this
///   the catalog's api_key-route context (e.g. claude `anthropic-api`, gated on
///   `Env(ANTHROPIC_API_KEY)`) never activates and the model menu comes back
///   empty. The Env fact carries presence only; the raw value is still rendered
///   into the launch env by the existing `render_profile` path at spawn time.
fn collect_enrolled_source_facts(profile: &AgentRuntimeAuthProfile) -> Vec<CredentialFact> {
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            let mut facts = Vec::new();
            let mut has_gateway = false;
            for source in &sources.sources {
                match source {
                    ResolvedSource::Gateway(_) => has_gateway = true,
                    ResolvedSource::ApiKey(api_key) => facts.push(CredentialFact::Env {
                        var: api_key.env_var_name.clone(),
                    }),
                }
            }
            // At most one gateway Route fact regardless of gateway source count;
            // never an api_key route fact (invariant preserved by construction).
            if has_gateway {
                facts.push(CredentialFact::Route {
                    kind: route_kinds::GATEWAY.to_string(),
                });
            }
            facts
        }
        AgentRuntimeAuthProfile::Native => Vec::new(),
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
#[path = "launch_facts_route_transition_tests.rs"]
mod route_transition_tests;

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
    /// that harness instead of native credential facts.
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
    /// gateway → no route fact. INVARIANT: api_key sources must NEVER get a
    /// route fact / route_kind (that is reserved for the gateway route).
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

    /// BYOK fix: an enrolled api_key source surfaces a presence-only `Env` fact
    /// for its `env_var_name`, so the catalog's api_key-route context (e.g.
    /// claude `anthropic-api`, gated on `Env(ANTHROPIC_API_KEY)`) activates on
    /// the local surface even though the raw key lives in state.json, never the
    /// composed workspace env. The fact is presence-only — never an `EnvFlag`
    /// carrying the value — and the source still emits NO route fact.
    #[test]
    fn api_key_source_in_state_emits_env_fact() {
        let home = temp_home();
        write_state(
            &home,
            r#"{"version":2,"revision":1,"harnesses":[
                {"harness_kind":"claude","sources":[
                    {"kind":"api_key","env_var_name":"ANTHROPIC_API_KEY","value":"sk-ant-raw"}]}]}"#,
        );

        let facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);
        assert!(
            facts.contains(&CredentialFact::Env {
                var: "ANTHROPIC_API_KEY".to_string(),
            }),
            "enrolled api_key source should emit a presence-only Env fact for its \
             env_var_name; got: {facts:?}"
        );
        // Presence only: the raw value must never ride along as an EnvFlag.
        assert!(
            !facts.iter().any(|fact| matches!(
                fact,
                CredentialFact::EnvFlag { var, .. } if var == "ANTHROPIC_API_KEY"
            )),
            "api_key Env fact must be presence-only, never an EnvFlag; got: {facts:?}"
        );
        // Invariant still holds: no route fact for an api_key source.
        assert!(
            !facts
                .iter()
                .any(|fact| matches!(fact, CredentialFact::Route { .. })),
            "api_key source must not emit a route fact; got: {facts:?}"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    /// Surface scoping / no-leak: an api_key source enrolled for one harness
    /// does NOT surface its env fact for a different (unconfigured) harness, and
    /// a gateway-only harness surfaces no api_key Env fact. State-source
    /// selection is keyed on harness_kind exactly like the launch-time renderer.
    #[test]
    fn api_key_env_fact_is_scoped_to_its_harness() {
        let home = temp_home();
        write_state(
            &home,
            r#"{"version":2,"revision":1,"harnesses":[
                {"harness_kind":"codex","sources":[
                    {"kind":"api_key","env_var_name":"OPENAI_API_KEY","value":"sk-raw"}]},
                {"harness_kind":"claude","sources":[
                    {"kind":"gateway","base_url":"https://gw","key":"sk-vk"}]}]}"#,
        );

        // codex's api_key surfaces its own env fact.
        let codex_facts = collect_launch_env_facts("codex", &BTreeMap::new(), &home);
        assert!(
            codex_facts.contains(&CredentialFact::Env {
                var: "OPENAI_API_KEY".to_string(),
            }),
            "codex's enrolled api_key must surface OPENAI_API_KEY; got: {codex_facts:?}"
        );

        // claude (gateway-only, no api_key) must NOT inherit codex's env fact.
        let claude_facts = collect_launch_env_facts("claude", &BTreeMap::new(), &home);
        assert!(
            !claude_facts.contains(&CredentialFact::Env {
                var: "OPENAI_API_KEY".to_string(),
            }),
            "another harness's api_key env fact must not leak; got: {claude_facts:?}"
        );
        // Gateway-only harness surfaces a Route fact but no api_key Env fact.
        assert!(
            claude_facts
                .iter()
                .any(|fact| matches!(fact, CredentialFact::Route { kind } if kind == "gateway")),
            "gateway-only harness should still emit its Route fact; got: {claude_facts:?}"
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

    /// End-to-end proof of the BYOK fix: an enrolled api_key source's `Env`
    /// fact activates the catalog's `anthropic-api` context and populates the
    /// model menu — the exact path that returned ZERO models before the fix
    /// (self-host/local BYOK users saw an empty menu and could not launch).
    #[test]
    fn api_key_env_fact_activates_anthropic_api_and_unlocks_models() {
        use crate::domains::agents::auth::context::classify;
        use crate::domains::agents::catalog::bundled::bundled_agent_catalog_document;
        use crate::domains::agents::catalog::service::ActiveCatalog;
        use crate::domains::agents::model::AgentKind;
        use crate::domains::agents::registry::built_in_registry;
        use std::sync::Arc;

        let document = Arc::new(bundled_agent_catalog_document().clone());
        let contexts = document
            .agents
            .iter()
            .find(|agent| agent.kind == "claude")
            .map(|agent| agent.auth_contexts.as_slice())
            .expect("claude auth contexts in bundled catalog");
        let descriptor = built_in_registry()
            .into_iter()
            .find(|descriptor| descriptor.kind == AgentKind::Claude)
            .expect("claude descriptor");

        // The fact the fix surfaces for an enrolled ANTHROPIC_API_KEY api_key
        // source (presence only).
        let api_key_fact = CredentialFact::Env {
            var: "ANTHROPIC_API_KEY".to_string(),
        };

        let active = classify(&descriptor, contexts, std::slice::from_ref(&api_key_fact));
        assert!(
            active.is_active("anthropic-api"),
            "api_key Env fact must activate the anthropic-api context; got {:?}",
            active.ids()
        );

        let catalog = ActiveCatalog::new(Arc::clone(&document));
        let visible = catalog.visible_models("claude", &active);
        assert!(
            !visible.is_empty(),
            "the BYOK model menu must be non-empty once anthropic-api is active"
        );

        // And the empty-fact baseline still yields no api_key-gated menu, so the
        // fact is doing the unlocking (guards against a vacuous assertion).
        let baseline = classify(&descriptor, contexts, &[]);
        let baseline_visible = catalog.visible_models("claude", &baseline);
        assert!(
            baseline_visible.len() < visible.len(),
            "the api_key fact must unlock strictly more models than baseline; \
             baseline={:?} active={:?}",
            baseline_visible.iter().map(|m| &m.id).collect::<Vec<_>>(),
            visible.iter().map(|m| &m.id).collect::<Vec<_>>()
        );
    }
}
