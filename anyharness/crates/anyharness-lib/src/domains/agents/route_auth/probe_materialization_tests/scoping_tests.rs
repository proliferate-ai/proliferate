//! T-01..T-04: scoping one flat source list down to one auth context (pure).

use super::super::*;
use super::*;

// ---------------------------------------------------------------------------
// T-01..T-04: scoping (pure)
// ---------------------------------------------------------------------------

/// T-01 — opencode carries a gateway PLUS two api_key rows simultaneously, which
/// is legal. Each context must see only its own material.
///
/// This guards the bug that would otherwise make all six opencode contexts share
/// one identical union fingerprint, so rotating any single key would stale all six
/// entries and re-probe the harness six times.
#[test]
fn opencode_contexts_scope_to_their_own_source_only() {
    let home = TempHome::new("scope-opencode");
    home.write_state_json(&state(
        6,
        json!([{
            "harness_kind": "opencode",
            "sources": [
                gateway_source(VK),
                api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                api_key_source("OPENAI_API_KEY", "sk-oai"),
            ],
        }]),
    ));
    let contexts = opencode_contexts();

    let gateway = material_for(&home, "opencode", "gateway", &contexts).expect("gateway");
    assert_eq!(
        scoped_sources(&gateway).expect("sources").len(),
        1,
        "the gateway context must not see the api_key rows"
    );
    assert!(matches!(
        scoped_sources(&gateway).unwrap()[0],
        ResolvedSource::Gateway(_)
    ));

    let anthropic = material_for(&home, "opencode", "anthropic-api", &contexts).expect("anthropic");
    assert_eq!(
        scoped_sources(&anthropic).unwrap(),
        &[ResolvedSource::ApiKey(ApiKeyProfile {
            env_var_name: "ANTHROPIC_API_KEY".into(),
            value: "sk-ant".into(),
        })]
    );

    let openai = material_for(&home, "opencode", "openai-api", &contexts).expect("openai");
    assert_eq!(
        scoped_sources(&openai).unwrap(),
        &[ResolvedSource::ApiKey(ApiKeyProfile {
            env_var_name: "OPENAI_API_KEY".into(),
            value: "sk-oai".into(),
        })]
    );

    // gemini-api is a PURE env context (the shipped catalog gives it
    // GEMINI_API_KEY / GOOGLE_API_KEY and no discovery signal), and the document
    // carries no source for either: a selection this machine cannot honor.
    assert!(matches!(
        material_for(&home, "opencode", "gemini-api", &contexts),
        Err(RouteAuthError::SelectionMissing { .. })
    ));

    // But a MIXED env+discovery context with no enrolled source is the ordinary
    // logged-in case, not a failure: a launch there renders nothing and reads the
    // user's own credential, so the probe must do the same. Failing closed here
    // would turn every login-backed context on every enrolled machine into a
    // permanent failed attempt. (openai-api declares both an env signal and
    // `opencode-auth-json/openai`.)
    let home_login_only = TempHome::new("scope-login-only");
    home_login_only.write_state_json(&state(
        6,
        json!([{ "harness_kind": "opencode", "sources": [gateway_source(VK)] }]),
    ));
    let login_backed =
        material_for(&home_login_only, "opencode", "openai-api", &contexts).expect("login-backed");
    assert!(
        login_backed.is_native(),
        "a mixed env+discovery context with nothing enrolled reads the user's own login"
    );
    // The pure-env sibling on the SAME document still fails closed — proving the
    // discovery signal is what made the difference.
    assert!(matches!(
        material_for(&home_login_only, "opencode", "gemini-api", &contexts),
        Err(RouteAuthError::SelectionMissing { .. })
    ));

    // Discovery-only and baseline read the user's own login: inject nothing.
    for native_context in ["opencode-zen", "baseline"] {
        let scoped = material_for(&home, "opencode", native_context, &contexts).expect("native");
        assert!(
            scoped.is_native(),
            "{native_context} must resolve to the user's own login"
        );
    }
}

/// T-02 — claude's `bedrock` (an envFlag signal) and `anthropic-oauth` (a
/// discovery signal) both resolve Native: a launch renders no credential for
/// either, so neither may the probe.
#[test]
fn claude_env_flag_and_discovery_contexts_are_native() {
    let home = TempHome::new("scope-claude");
    home.write_state_json(&state(
        3,
        json!([{ "harness_kind": "claude", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = claude_contexts();

    for native_context in ["bedrock", "anthropic-oauth"] {
        let scoped = material_for(&home, "claude", native_context, &contexts).expect("native");
        assert!(scoped.is_native(), "{native_context} must be native");
        assert!(
            scoped.env_value_digests.is_empty(),
            "{native_context} must carry no credential digests"
        );
        assert!(scoped.gateway_base_url.is_none());
    }
    // The gateway context on the same document DOES resolve a route.
    let gateway = material_for(&home, "claude", "gateway", &contexts).expect("gateway");
    assert!(!gateway.is_native());
    assert_eq!(gateway.gateway_base_url.as_deref(), Some(GATEWAY_BASE_URL));
}

/// T-03 — cursor declares exactly one context, `cursor-login`, and it is Native.
/// A cursor GATEWAY context is unrepresentable: it does not exist in the catalog,
/// so the seam can never be asked for one. Forcing the render anyway is the only
/// way to see `UnsupportedRoute`, which is asserted here so the boundary is
/// pinned.
#[test]
fn cursor_has_only_a_native_login_context_and_no_gateway_route() {
    let home = TempHome::new("scope-cursor");
    home.write_state_json(&state(
        2,
        json!([{ "harness_kind": "cursor", "sources": [gateway_source(VK)] }]),
    ));
    let contexts = cursor_contexts();
    assert_eq!(contexts.len(), 1, "the catalog gives cursor exactly one context");

    let login = material_for(&home, "cursor", "cursor-login", &contexts).expect("login");
    assert!(login.is_native());

    // Asking for a context id cursor does not declare falls back to Native (there
    // are no signals to read), NOT to a gateway materialization.
    let unknown = material_for(&home, "cursor", "gateway", &contexts).expect("unknown context");
    assert!(unknown.is_native());

    // And if a gateway profile were somehow forced through the renderer, the
    // renderer itself refuses.
    let forced = render_profile(
        &AgentRuntimeAuthProfile::Sources(HarnessSources {
            harness_kind: "cursor".to_string(),
            revision: 2,
            sources: vec![ResolvedSource::Gateway(GatewayProfile {
                base_url: GATEWAY_BASE_URL.to_string(),
                key: VK.to_string(),
            })],
        }),
        "cursor",
        &plan_with(&[]),
        home.path(),
    );
    assert!(matches!(forced, Err(RouteAuthError::UnsupportedRoute { .. })));
}

/// T-04 — `baseline` scrubs every registry-declared credential var for the
/// harness, and does so WITHOUT mutating this process's environment. The central
/// CLI mutates its own env for this; inside a long-lived server that would blind
/// every later credential classification.
#[test]
fn baseline_scrubs_registry_env_vars_without_touching_process_env() {
    let home = TempHome::new("scope-baseline");
    home.write_state_json(&state(1, json!([])));
    let contexts = opencode_contexts();

    let probe_var = "ANTHROPIC_API_KEY";
    let before = std::env::var_os(probe_var);

    let material = material_for(&home, "opencode", "baseline", &contexts).expect("baseline");
    let materialized =
        materialize_for_probe(home.path(), "opencode", &material, &plan_with(&["m-1"]))
            .expect("materialize");

    let removed: BTreeSet<&str> = materialized
        .env_remove
        .iter()
        .map(String::as_str)
        .collect();
    // Whatever the registry declares for opencode must all be removed. Assert the
    // relationship rather than a hardcoded list, so a registry addition cannot
    // silently escape the scrub.
    let declared: BTreeSet<String> = bundled_agent_registry_document()
        .agents
        .iter()
        .find(|agent| agent.kind == "opencode")
        .expect("opencode in registry")
        .auth
        .slots
        .iter()
        .flat_map(|slot| slot.env_vars.iter())
        .map(|env_var| env_var.name().to_string())
        .collect();
    assert!(!declared.is_empty(), "opencode declares credential env vars");
    for name in &declared {
        assert!(
            removed.contains(name.as_str()),
            "baseline must scrub the registry-declared {name}"
        );
    }

    assert_eq!(
        std::env::var_os(probe_var),
        before,
        "the scrub must be per-child, never a process-env mutation"
    );
}
