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
    profile::ResolvedSource, resolve_launch_route_auth_rotated_for_server,
    AgentRuntimeAuthProfile,
};
use crate::domains::agents::seat_cooling::SeatCoolingStore;
use crate::persistence::Db;

const FIXTURE: &str =
    include_str!("../../../../../../../fixtures/contracts/agent-auth-state/v2.json");

/// The sibling variant: v2.json with claude additionally carrying
/// `"settings": {"rotate": false}` — the cross-language pin for the
/// rotate-off launch semantics (the main fixture stays rotate-default so the
/// other pins keep their round-robin meaning).
const ROTATE_OFF_FIXTURE: &str =
    include_str!("../../../../../../../fixtures/contracts/agent-auth-state/v2-rotate-off.json");

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
/// placeholder keys does not churn the test. (claude left this list with
/// seats v1: its fixture entry is now the seat variant — contract point 1b.)
#[test]
fn every_gateway_source_carries_its_own_per_harness_key() {
    let state = fixture_state();

    let mut keys = Vec::new();
    for harness in ["codex", "opencode"] {
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

/// Contract point 1b (seats v1 + rotation): claude's entry is a THREE-seat
/// pool — the wire shape `{kind, env: {CLAUDE_CODE_OAUTH_TOKEN}, seat_id}`
/// per active vault seat, expanded in vault order. Every seat resolves, in
/// document order (the order rotation treats as authoritative), each env map
/// carrying exactly the one harness-real env var. `seat_id` is the vault
/// entry id, never token material.
#[test]
fn the_fixtures_seat_pool_resolves_all_three_seats_in_document_order() {
    let state = fixture_state();

    match resolve_profile(Some(&state), "claude").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert!(sources.rotate, "no rotate setting in the fixture → true");
            let ids: Vec<&str> = sources
                .sources
                .iter()
                .map(|source| match source {
                    ResolvedSource::Seat(seat) => {
                        assert_eq!(
                            seat.env.keys().collect::<Vec<_>>(),
                            ["CLAUDE_CODE_OAUTH_TOKEN"],
                            "exactly the one harness-real env var"
                        );
                        seat.seat_id.as_str()
                    }
                    other => panic!("claude should carry only seat sources, got {other:?}"),
                })
                .collect();
            assert_eq!(
                ids,
                [
                    "30000000-0000-4000-8000-000000000021",
                    "30000000-0000-4000-8000-000000000022",
                    "30000000-0000-4000-8000-000000000023",
                ]
            );
        }
        other => panic!("claude should be routed, got {other:?}"),
    }
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

    // Present with an empty list → refuse, carrying the producer's typed
    // `unsatisfied_reason` into the refusal and its Display verbatim.
    assert_eq!(state.sources_for("grok").map(<[_]>::len), Some(0));
    let error = resolve_profile(Some(&state), "grok").expect_err("grok must fail closed");
    assert!(matches!(
        &error,
        RouteAuthError::SelectionMissing { harness_kind, revision: 42, reason: Some(reason) }
            if harness_kind == "grok"
                && reason == "managed model access isn't ready on this account yet"
    ));
    assert_eq!(
        error.to_string(),
        "The auth method selected for grok can't be used right now — \
         managed model access isn't ready on this account yet. \
         Pick or fix a method in Settings → Agents."
    );

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

    match resolve_profile(Some(&state), "codex").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.revision, 42);
            assert_eq!(sources.sources.len(), 1);
            assert!(matches!(sources.sources[0], ResolvedSource::Gateway(_)));
        }
        other => panic!("codex should be routed, got {other:?}"),
    }

    match resolve_profile(Some(&state), "claude").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.revision, 42);
            assert_eq!(sources.sources.len(), 3, "the three-seat pool");
            assert!(sources
                .sources
                .iter()
                .all(|source| matches!(source, ResolvedSource::Seat(_))));
        }
        other => panic!("claude should be routed, got {other:?}"),
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
                        profile.env.get("AWS_BEARER_TOKEN_BEDROCK").map(String::as_str),
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
/// written to a runtime home, the rotated launch entry renders claude's seat
/// recipe from it — serving seatAA (the pool's first, nothing cooling, no
/// last-served) — with the serving-seat channel set. A fixture that parses
/// but cannot drive a launch would otherwise pass the tests above.
#[test]
fn the_contract_fixture_drives_a_real_launch_render() {
    let home = TempHome::new("contract-fixture");
    home.write_state_raw(FIXTURE.as_bytes());
    let store = SeatCoolingStore::new(Db::open_in_memory().expect("open in-memory db"));

    let rendered = resolve_launch_route_auth_rotated_for_server(
        home.path(),
        "claude",
        &HarnessPlanResolver,
        &store,
        // The fixture is stamped with an origin, so the guard must be given the
        // matching one or the document reads as absent.
        Some("https://api.proliferate.example"),
    )
    .expect("the fixture must render a claude launch");

    assert_eq!(
        rendered.serving_seat_id.as_deref(),
        Some("30000000-0000-4000-8000-000000000021"),
        "seatAA — first in document order — serves absent cooling"
    );

    assert_eq!(
        rendered.set.get("CLAUDE_CODE_OAUTH_TOKEN").map(String::as_str),
        Some("sk-ant-oat01-Kx3mQ9rT5vW7yZ1aB2cD4eF6gH8jL0nP-seatAA"),
        "the seat's token, verbatim from the env map"
    );
    let config_dir = rendered
        .set
        .get("CLAUDE_CONFIG_DIR")
        .expect("per-seat CLAUDE_CONFIG_DIR");
    assert!(
        config_dir.contains("claude-config-30000000-0000-4000-8000-000000000021"),
        "the seat's OWN config dir: {config_dir}"
    );
    // The seat strip list applies (spec §4 cell 2's claude · seat row).
    for key in [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }
}

const SEAT_BB: &str = "30000000-0000-4000-8000-000000000022";
const SEAT_CC: &str = "30000000-0000-4000-8000-000000000023";

/// The rotate-off variant is v2.json plus EXACTLY claude's
/// `settings.rotate=false` — nothing else may drift between the siblings, or
/// the variant stops pinning what it claims to pin.
#[test]
fn the_rotate_off_variant_differs_from_v2_only_by_claudes_rotate_setting() {
    let mut variant: serde_json::Value =
        serde_json::from_str(ROTATE_OFF_FIXTURE).expect("variant parses");
    let base: serde_json::Value = serde_json::from_str(FIXTURE).expect("v2 parses");

    let claude = variant["harnesses"]
        .as_array_mut()
        .expect("harnesses")
        .iter_mut()
        .find(|entry| entry["harness_kind"] == "claude")
        .expect("claude entry");
    let settings = claude
        .as_object_mut()
        .expect("entry object")
        .remove("settings")
        .expect("the variant's claude entry carries settings");
    assert_eq!(settings, serde_json::json!({ "rotate": false }));
    assert_eq!(variant, base, "no other byte of the fixture may differ");
}

/// The cross-language rotate-off pin, launch-side: the variant resolves to
/// `rotate == false`, and with `last_served = seatBB` the launch serves
/// seatBB again (the pin), where the rotate-default v2.json round-robins on
/// to seatCC from the same last-served fact.
#[test]
fn the_rotate_off_fixture_pins_the_served_seat_where_v2_round_robins() {
    let rotate_off: AgentAuthState =
        serde_json::from_str(ROTATE_OFF_FIXTURE).expect("variant parses as a v2 document");
    match resolve_profile(Some(&rotate_off), "claude").expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert!(!sources.rotate, "the variant's claude entry is rotate-off");
        }
        other => panic!("claude should be routed, got {other:?}"),
    }

    let now_epoch_s = chrono::Utc::now().timestamp();
    let serving_after = |name: &str, fixture: &str| {
        let home = TempHome::new(name);
        home.write_state_raw(fixture.as_bytes());
        let store = SeatCoolingStore::new(Db::open_in_memory().expect("open in-memory db"));
        store.confirm_served("claude", SEAT_BB, now_epoch_s);
        resolve_launch_route_auth_rotated_for_server(
            home.path(),
            "claude",
            &HarnessPlanResolver,
            &store,
            Some("https://api.proliferate.example"),
        )
        .expect("the fixture must render a claude launch")
        .serving_seat_id
    };

    assert_eq!(
        serving_after("contract-fixture-rotate-off", ROTATE_OFF_FIXTURE).as_deref(),
        Some(SEAT_BB),
        "rotate-off pins the last-served seat"
    );
    assert_eq!(
        serving_after("contract-fixture-rotate-default", FIXTURE).as_deref(),
        Some(SEAT_CC),
        "rotate absent → true: the pool round-robins past the last-served seat"
    );
}
