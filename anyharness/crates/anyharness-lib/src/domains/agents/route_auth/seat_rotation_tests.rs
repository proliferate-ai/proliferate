//! Seat rotation proof tests (slice 2): the rotated launch seam over a real
//! state file + a real SQLite-backed [`SeatCoolingStore`], plus the frozen
//! refusal copy pins. The pure-decision unit tests live in `rotation.rs`; the
//! classifier unit tests in `integrations/acp/provider_errors.rs`.

use serde_json::{json, Value};

use crate::domains::agents::seat_cooling::{next_five_hour_window_top, SeatCoolingStore};
use crate::integrations::acp::provider_errors::classify_seat_usage_limit_error;
use crate::persistence::Db;

use super::plan::{GatewayModelPlan, GatewayModelResolve};
use super::refusal::{format_reset_time, LaunchRefusal};
use super::test_support::TempHome;
use super::{
    launch_route_selection_failure_rotated_for_server,
    resolve_launch_route_auth_rotated_for_server, RouteAuthError,
};

struct NoPlanResolver;

impl GatewayModelResolve for NoPlanResolver {
    fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        GatewayModelPlan::default()
    }
}

fn seat(seat_id: &str) -> Value {
    json!({
        "kind": "seat",
        "env": { "CLAUDE_CODE_OAUTH_TOKEN": format!("sk-ant-oat01-{seat_id}") },
        "seat_id": seat_id,
    })
}

fn gateway() -> Value {
    json!({ "kind": "gateway", "base_url": "https://llm.proliferate.ai", "key": "sk-vk-1" })
}

fn claude_state(sources: Vec<Value>, settings: Option<Value>) -> Value {
    let mut entry = json!({ "harness_kind": "claude", "sources": sources });
    if let Some(settings) = settings {
        entry["settings"] = settings;
    }
    json!({ "version": 2, "revision": 7, "harnesses": [entry] })
}

fn store() -> SeatCoolingStore {
    SeatCoolingStore::new(Db::open_in_memory().expect("open in-memory db"))
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// One rotated launch render; returns the seat that served.
fn launch(home: &TempHome, store: &SeatCoolingStore) -> String {
    resolve_launch_route_auth_rotated_for_server(
        home.path(),
        "claude",
        &NoPlanResolver,
        store,
        None,
    )
    .expect("render")
    .serving_seat_id
    .expect("a seat launch must name its serving seat")
}

/// Three seats, one cooling: successive launches (with `confirm_served`
/// between, as a successful spawn would) alternate over the two active seats
/// in document order, never touching the cooling one.
#[test]
fn rotation_skips_cooling_and_round_robins() {
    let home = TempHome::new("rotation-round-robin");
    home.write_state_json(&claude_state(
        vec![seat("seat-a"), seat("seat-b"), seat("seat-c")],
        None,
    ));
    let store = store();
    store.mark_cooling("seat-b", "claude", now() + 3_600, Some("five_hour"), now());

    let mut served = Vec::new();
    for _ in 0..4 {
        let seat_id = launch(&home, &store);
        store.confirm_served("claude", &seat_id, now());
        served.push(seat_id);
    }
    // a (first), then c (b skipped as cooling), then wrap to a, then c again.
    assert_eq!(served, ["seat-a", "seat-c", "seat-a", "seat-c"]);
}

/// A pool that is entirely cooling: with a gateway source beside the pool the
/// launch drops the seats and renders the gateway recipe; a seat-only pool
/// refuses with `AllSeatsCooling`, whose Display names the EARLIEST reset.
#[test]
fn all_seats_cooling_falls_back_with_reason() {
    let store = store();
    let earliest = now() + 1_800;
    let later = now() + 7_200;
    store.mark_cooling("seat-a", "claude", later, Some("five_hour"), now());
    store.mark_cooling("seat-b", "claude", earliest, Some("five_hour"), now());

    // With a gateway source beside the pool → the gateway recipe renders.
    let home = TempHome::new("all-cooling-fallback");
    home.write_state_json(&claude_state(
        vec![gateway(), seat("seat-a"), seat("seat-b")],
        None,
    ));
    let rendered = resolve_launch_route_auth_rotated_for_server(
        home.path(),
        "claude",
        &NoPlanResolver,
        &store,
        None,
    )
    .expect("gateway fallback renders");
    assert!(rendered.set.contains_key("ANTHROPIC_AUTH_TOKEN"));
    assert!(!rendered.set.contains_key("CLAUDE_CODE_OAUTH_TOKEN"));
    assert_eq!(rendered.serving_seat_id, None);

    // Seat-only pool → the typed refusal, naming the earliest reset.
    let seat_only = TempHome::new("all-cooling-refusal");
    seat_only.write_state_json(&claude_state(vec![seat("seat-a"), seat("seat-b")], None));
    let error = resolve_launch_route_auth_rotated_for_server(
        seat_only.path(),
        "claude",
        &NoPlanResolver,
        &store,
        None,
    )
    .expect_err("seat-only all-cooling must refuse");
    assert!(matches!(
        &error,
        RouteAuthError::AllSeatsCooling { harness_kind, earliest_reset_epoch_s }
            if harness_kind == "claude" && *earliest_reset_epoch_s == earliest
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_ALL_SEATS_COOLING");
    assert!(
        error.to_string().contains(&format_reset_time(earliest)),
        "the Display names the earliest reset: {error}"
    );
    // The create-time preview produces the same refusal.
    let preview = launch_route_selection_failure_rotated_for_server(
        seat_only.path(),
        "claude",
        &store,
        None,
    )
    .expect("preview refuses too");
    assert_eq!(preview.code(), "AGENT_ROUTE_ALL_SEATS_COOLING");
}

/// settings.rotate=false pins the applied (last-served) seat: it keeps
/// serving even though a fresher seat sits later in the pool, and when the
/// pin itself cools the launch refuses with `SeatCooling` instead of
/// rotating off the user's pin.
#[test]
fn rotate_toggle_off_pins_applied_seat() {
    let home = TempHome::new("rotate-off-pins");
    home.write_state_json(&claude_state(
        vec![seat("seat-a"), seat("seat-b")],
        Some(json!({ "rotate": false })),
    ));
    let store = store();
    store.confirm_served("claude", "seat-a", now());

    // The applied seat serves, repeatedly — no advancing.
    for _ in 0..2 {
        let seat_id = launch(&home, &store);
        assert_eq!(seat_id, "seat-a");
        store.confirm_served("claude", &seat_id, now());
    }

    // The pinned seat cooling → the typed refusal (seat-b stays untouched).
    let reset = now() + 3_600;
    store.mark_cooling("seat-a", "claude", reset, Some("five_hour"), now());
    let error = resolve_launch_route_auth_rotated_for_server(
        home.path(),
        "claude",
        &NoPlanResolver,
        &store,
        None,
    )
    .expect_err("a cooling pin refuses");
    assert!(matches!(
        &error,
        RouteAuthError::SeatCooling { harness_kind, seat_id, reset_at_epoch_s }
            if harness_kind == "claude" && seat_id == "seat-a" && *reset_at_epoch_s == reset
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_SEAT_COOLING");
}

/// The limit-error observation rule (turn/finish.rs): a classified message
/// carrying an epoch cools until exactly that reset; one without a parseable
/// reset cools until the top of the next 5-hour window.
#[test]
fn limit_error_marks_seat_cooling_until_reset() {
    let store = store();
    let now_epoch_s = now();
    let carried_reset = now_epoch_s + 4_000;

    let observation = classify_seat_usage_limit_error(&format!(
        "Claude AI usage limit reached|{carried_reset}"
    ))
    .expect("classified");
    let cooling_until = observation
        .reset_at_epoch_s
        .unwrap_or_else(|| next_five_hour_window_top(now_epoch_s));
    store.mark_cooling("seat-a", "claude", cooling_until, Some(observation.window), now_epoch_s);
    assert_eq!(store.cooling_until("seat-a", now_epoch_s), Some(carried_reset));

    let observation =
        classify_seat_usage_limit_error("5-hour limit reached ∙ resets 3pm").expect("classified");
    let cooling_until = observation
        .reset_at_epoch_s
        .unwrap_or_else(|| next_five_hour_window_top(now_epoch_s));
    store.mark_cooling("seat-b", "claude", cooling_until, Some(observation.window), now_epoch_s);
    assert_eq!(
        store.cooling_until("seat-b", now_epoch_s),
        Some(next_five_hour_window_top(now_epoch_s))
    );
}

/// Cooling is durable: mark, drop the Db handle, reopen the same runtime
/// home, still cooling — and an expired record reads as not-cooling.
#[test]
fn cooling_survives_restart() {
    let home = TempHome::new("cooling-restart");
    let reset = now() + 3_600;
    {
        let store = SeatCoolingStore::new(Db::open(home.path()).expect("open db"));
        store.mark_cooling("seat-a", "claude", reset, Some("five_hour"), now());
    }
    let reopened = SeatCoolingStore::new(Db::open(home.path()).expect("reopen db"));
    assert_eq!(reopened.cooling_until("seat-a", now()), Some(reset));
    // Expired rows read as not-cooling (and are pruned lazily).
    assert_eq!(reopened.cooling_until("seat-a", reset + 1), None);
}

/// Rotation state advances ONLY on a confirmed successful spawn: any number
/// of create-time previews and launch renders leave `last_served` untouched;
/// one `confirm_served` moves it.
#[test]
fn last_served_advances_only_on_successful_spawn() {
    let home = TempHome::new("advance-on-confirm");
    home.write_state_json(&claude_state(vec![seat("seat-a"), seat("seat-b")], None));
    let store = store();

    for _ in 0..3 {
        assert!(launch_route_selection_failure_rotated_for_server(
            home.path(),
            "claude",
            &store,
            None
        )
        .is_none());
        assert_eq!(launch(&home, &store), "seat-a", "no confirm → no advance");
    }
    assert_eq!(store.last_served("claude"), None);

    store.confirm_served("claude", "seat-a", now());
    assert_eq!(store.last_served("claude").as_deref(), Some("seat-a"));
    assert_eq!(launch(&home, &store), "seat-b", "confirm advanced the wheel");
}

/// The frozen refusal copy, pinned exactly. The `{time}` piece is produced by
/// the same local-time helper the copy uses (its own formatting rules are
/// pinned with injected timestamps in refusal.rs).
#[test]
fn refusal_copy_is_pinned_exactly() {
    assert_eq!(
        LaunchRefusal::NoConfiguredSource {
            harness: "claude".into()
        }
        .copy(),
        "Claude isn't set up — pick a method in Settings."
    );
    // An unknown kind falls back to the kind string.
    assert_eq!(
        LaunchRefusal::NoConfiguredSource {
            harness: "mystery".into()
        }
        .copy(),
        "mystery isn't set up — pick a method in Settings."
    );
    assert_eq!(
        LaunchRefusal::SourceUnsatisfied {
            harness: "claude".into(),
            reason: "the credits behind it ran out".into()
        }
        .copy(),
        "The auth method selected for claude can't be used right now — \
         the credits behind it ran out. Pick or fix a method in Settings → Agents."
    );
    let reset = now() + 3_600;
    assert_eq!(
        LaunchRefusal::SeatCooling {
            seat: "seat-a".into(),
            reset_at_epoch_s: reset
        }
        .copy(),
        format!(
            "This Claude.ai login hit its usage limit — it resets at {}. \
             Rotation is off, so launches wait for this login.",
            format_reset_time(reset)
        )
    );
    assert_eq!(
        LaunchRefusal::AllSeatsCooling {
            earliest_reset_epoch_s: reset
        }
        .copy(),
        format!(
            "All Claude.ai logins hit their usage limits — the earliest resets at {}.",
            format_reset_time(reset)
        )
    );
}

/// The refusal codes, and the `RouteAuthError` → `LaunchRefusal` mapping:
/// `SelectionMissing` carries its reason (else the family words), the cooling
/// pair map 1:1, and shape/IO errors map to `None`.
#[test]
fn refusal_codes_and_route_auth_error_mapping() {
    assert_eq!(
        LaunchRefusal::NoConfiguredSource { harness: "x".into() }.code(),
        "AGENT_AUTH_NOT_CONFIGURED"
    );
    assert_eq!(
        LaunchRefusal::SourceUnsatisfied {
            harness: "x".into(),
            reason: "r".into()
        }
        .code(),
        "AGENT_ROUTE_SELECTION_MISSING"
    );
    assert_eq!(
        LaunchRefusal::SeatCooling {
            seat: "s".into(),
            reset_at_epoch_s: 1
        }
        .code(),
        "AGENT_ROUTE_SEAT_COOLING"
    );
    assert_eq!(
        LaunchRefusal::AllSeatsCooling {
            earliest_reset_epoch_s: 1
        }
        .code(),
        "AGENT_ROUTE_ALL_SEATS_COOLING"
    );

    let with_reason = RouteAuthError::SelectionMissing {
        harness_kind: "grok".into(),
        revision: 1,
        reason: Some("managed model access isn't ready on this account yet".into()),
    };
    assert_eq!(
        LaunchRefusal::from_route_auth_error(&with_reason),
        Some(LaunchRefusal::SourceUnsatisfied {
            harness: "grok".into(),
            reason: "managed model access isn't ready on this account yet".into()
        })
    );
    let without_reason = RouteAuthError::SelectionMissing {
        harness_kind: "grok".into(),
        revision: 1,
        reason: None,
    };
    assert_eq!(
        LaunchRefusal::from_route_auth_error(&without_reason),
        Some(LaunchRefusal::SourceUnsatisfied {
            harness: "grok".into(),
            reason: "its seat or key may have been revoked, or the credits behind it ran out"
                .into()
        })
    );
    assert_eq!(
        LaunchRefusal::from_route_auth_error(&RouteAuthError::SeatCooling {
            harness_kind: "claude".into(),
            seat_id: "seat-a".into(),
            reset_at_epoch_s: 9
        }),
        Some(LaunchRefusal::SeatCooling {
            seat: "seat-a".into(),
            reset_at_epoch_s: 9
        })
    );
    assert_eq!(
        LaunchRefusal::from_route_auth_error(&RouteAuthError::AllSeatsCooling {
            harness_kind: "claude".into(),
            earliest_reset_epoch_s: 9
        }),
        Some(LaunchRefusal::AllSeatsCooling {
            earliest_reset_epoch_s: 9
        })
    );
    assert_eq!(
        LaunchRefusal::from_route_auth_error(&RouteAuthError::UnknownHarness {
            harness_kind: "x".into()
        }),
        None
    );
}
