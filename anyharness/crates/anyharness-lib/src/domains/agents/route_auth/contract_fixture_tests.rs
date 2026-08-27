//! Rust's half of the `agent-auth-state` contract fixture.
//!
//! Python produces `fixtures/contracts/agent-auth-state/v2.json`
//! (`materialize/agent_auth.py::render_agent_auth_state`); this side asserts we
//! parse it and resolve it to the profiles the fixture's README claims. Per
//! `specs/engineering/testing/standard.md`, changing the shape means changing the
//! fixture, which breaks whichever side has not caught up — the point is that the
//! break is mechanical rather than a runtime surprise in a sandbox.
//!
//! Split from `render_tests.rs` for the line-count ceiling; nested inside it so
//! its `TempHome` and resolver helpers are in scope.

// The parent test module's helpers (`TempHome`, `HarnessPlanResolver`, …).
use super::*;
// The module under test, reached through its public re-exports.
use crate::domains::agents::route_auth::state::{AgentAuthState, SOURCE_KIND_GATEWAY};
use crate::domains::agents::route_auth::{
    profile::ResolvedSource, resolve_launch_route_auth_for_server, AgentRuntimeAuthProfile,
};

const FIXTURE: &str =
    include_str!("../../../../../../../fixtures/contracts/agent-auth-state/v2.json");

fn fixture_state() -> AgentAuthState {
    serde_json::from_str(FIXTURE).expect("the contract fixture must parse as a v2 document")
}

/// The document parses and its top-level shape is what the producer promises.
/// Notably the wire is snake_case; a producer that emitted camelCase would fail
/// here rather than silently rendering every harness native.
#[test]
fn the_contract_fixture_parses_as_a_v2_document() {
    let state = fixture_state();

    assert_eq!(state.version, 2);
    assert_eq!(state.revision, 42);
    assert_eq!(
        state.user_id.as_deref(),
        Some("20000000-0000-4000-8000-000000000001")
    );
    assert_eq!(
        state.issuing_server_origin.as_deref(),
        Some("https://api.proliferate.example")
    );
    assert_eq!(state.harnesses.len(), 5);
}

/// Contract point 1: every gateway source carries its OWN virtual key.
///
/// The keys are scoped per (subject, harness) by the gateway's access groups, so
/// a producer that resolves one subject-wide key and fans it out is wrong. This
/// asserts distinctness rather than exact values, so rotating the fixture's
/// placeholder keys does not churn the test.
#[test]
fn every_gateway_source_carries_its_own_per_harness_key() {
    let state = fixture_state();

    let mut keys = Vec::new();
    for harness in ["claude", "codex", "opencode"] {
        let sources = state
            .sources_for(harness)
            .unwrap_or_else(|| panic!("{harness} entry present"));
        let gateway = sources
            .iter()
            .find(|source| source.kind == SOURCE_KIND_GATEWAY)
            .unwrap_or_else(|| panic!("{harness} gateway source"));
        keys.push(gateway.key.clone().expect("gateway key"));
    }

    let distinct: std::collections::BTreeSet<_> = keys.iter().collect();
    assert_eq!(
        distinct.len(),
        keys.len(),
        "gateway keys must be per-harness, not one shared subject key: {keys:?}"
    );
}

/// Contract point 2: the three-way empty-sources semantics, resolved end to end.
///
/// `grok` is present with `sources: []` in the fixture — a selection the producer
/// could not satisfy — and must refuse the launch, while a harness the fixture
/// omits entirely is native. If the producer ever "tidies up" by dropping empty
/// entries, this test is what catches it.
#[test]
fn the_fixtures_empty_entry_fails_closed_while_an_absent_one_is_native() {
    let state = fixture_state();

    // Present with an empty list → refuse.
    assert_eq!(state.sources_for("grok").map(<[_]>::len), Some(0));
    let error = resolve_profile(Some(&state), "grok").expect_err("grok must fail closed");
    assert!(matches!(
        &error,
        RouteAuthError::SelectionMissing { harness_kind, revision: 42 } if harness_kind == "grok"
    ));

    // Absent from the document → native.
    assert!(state.sources_for("opencode-zen").is_none());
    assert_eq!(
        resolve_profile(Some(&state), "opencode-zen").expect("resolve"),
        AgentRuntimeAuthProfile::Native
    );
}

/// Every satisfiable entry resolves to the sources the README describes, in
/// order: cursor's only route is `api_key`, and opencode composes a gateway plus
/// a direct provider key simultaneously.
#[test]
fn the_fixtures_satisfiable_entries_resolve_to_the_documented_profiles() {
    let state = fixture_state();

    for harness in ["claude", "codex"] {
        match resolve_profile(Some(&state), harness).expect("resolve") {
            AgentRuntimeAuthProfile::Sources(sources) => {
                assert_eq!(sources.revision, 42);
                assert_eq!(sources.sources.len(), 1);
                assert!(matches!(sources.sources[0], ResolvedSource::Gateway(_)));
            }
            other => panic!("{harness} should be routed, got {other:?}"),
        }
    }

    match resolve_profile(Some(&state), "cursor").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => match &sources.sources[..] {
            [ResolvedSource::ApiKey(profile)] => {
                assert_eq!(profile.env_var_name, "CURSOR_API_KEY");
            }
            other => panic!("cursor should carry exactly one api_key source, got {other:?}"),
        },
        other => panic!("cursor should be routed, got {other:?}"),
    }

    match resolve_profile(Some(&state), "opencode").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(
                sources.sources.len(),
                3,
                "one direct api_key + gateway + provider_config (Track D)"
            );
            // The producer sorts a harness's sources by (kind, env_var_name), and
            // "api_key" < "gateway" < "provider_config" — so the api_key row comes
            // FIRST, gateway second, provider_config third. The fixture has to
            // carry the order the producer actually emits, or it is a document no
            // reconcile could ever write.
            assert!(matches!(sources.sources[0], ResolvedSource::ApiKey(_)));
            assert!(matches!(sources.sources[1], ResolvedSource::Gateway(_)));
            match &sources.sources[2] {
                ResolvedSource::ProviderConfig(profile) => {
                    assert_eq!(profile.config_kind, "aws_bedrock");
                    assert_eq!(
                        profile
                            .env
                            .get("AWS_BEARER_TOKEN_BEDROCK")
                            .map(String::as_str),
                        Some("bedrock-raw-0006")
                    );
                    assert_eq!(
                        profile.env.get("AWS_REGION").map(String::as_str),
                        Some("us-east-1")
                    );
                }
                other => panic!("opencode's third source should be provider_config, got {other:?}"),
            }
        }
        other => panic!("opencode should be routed, got {other:?}"),
    }
}

/// The consumer reads the fixture through the REAL file path, not just serde:
/// written to a runtime home, `resolve_launch_route_auth` renders claude's
/// gateway recipe from it. A fixture that parses but cannot drive a launch would
/// otherwise pass the tests above.
#[test]
fn the_contract_fixture_drives_a_real_launch_render() {
    let home = TempHome::new("contract-fixture");
    home.write_state_raw(FIXTURE.as_bytes());

    let rendered = resolve_launch_route_auth_for_server(
        home.path(),
        "claude",
        &HarnessPlanResolver,
        // The fixture is stamped with an origin, so the guard must be given the
        // matching one or the document reads as absent.
        Some("https://api.proliferate.example"),
    )
    .expect("the fixture must render a claude launch");

    assert_eq!(
        rendered.set.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
        Some("sk-vk-claude-0001"),
        "claude's own per-harness key, not another harness's"
    );
    assert_eq!(
        rendered.set.get("ANTHROPIC_BASE_URL").map(String::as_str),
        Some("https://llm.proliferate.example")
    );
}
