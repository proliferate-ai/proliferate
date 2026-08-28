//! `state.rs`'s tests, split out along the crate's `#[path]` test-file
//! seam for the line-count ceiling (the pattern `profile_tests.rs` set).

use super::*;
use crate::domains::agents::route_auth::test_support::TempHome;

fn gateway_source(base_url: &str, key: &str) -> AuthSource {
    AuthSource {
        kind: SOURCE_KIND_GATEWAY.into(),
        base_url: Some(base_url.into()),
        key: Some(key.into()),
        env_var_name: None,
        value: None,
        config_kind: None,
        env: None,
        seat_id: None,
    }
}

fn api_key_source(env_var_name: &str, value: &str) -> AuthSource {
    AuthSource {
        kind: SOURCE_KIND_API_KEY.into(),
        base_url: None,
        key: None,
        env_var_name: Some(env_var_name.into()),
        value: Some(value.into()),
        config_kind: None,
        env: None,
        seat_id: None,
    }
}

/// `AuthSource`'s `Debug` is hand-written to redact by construction (repo
/// law: never print a secret; length-only telemetry): the credential
/// fields render as length-only markers while kinds, names, ids, and the
/// base URL stay readable — a whole-document `{:?}` (e.g. an `assert_eq!`
/// panic) must not be able to reproduce a key.
#[test]
fn auth_source_debug_redacts_key_value_and_env_values() {
    let canary = "sk-canary-fixture"; // 17 bytes: pins the marker exactly.
    let mut source = gateway_source("https://gw.example", canary);
    source.value = Some(canary.into());
    source.env_var_name = Some("ANTHROPIC_API_KEY".into());
    source.env = Some(
        [("CLAUDE_CODE_OAUTH_TOKEN".to_string(), canary.to_string())]
            .into_iter()
            .collect(),
    );
    source.seat_id = Some("seat-uuid-1".into());

    let debug = format!("{source:?}");

    assert!(!debug.contains(canary), "Debug output leaked a credential");
    assert!(debug.contains("<redacted 17 bytes>"), "got {debug}");
    // Non-secret shape stays readable for debugging.
    for readable in [
        "gateway",
        "https://gw.example",
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "seat-uuid-1",
    ] {
        assert!(debug.contains(readable), "missing {readable} in {debug}");
    }
}

#[test]
fn state_file_path_uses_well_known_layout() {
    let path = state_file_path(Path::new("/home/x/.proliferate/anyharness"));
    assert!(path.ends_with("agent-auth/state.json"));
}

#[test]
fn missing_file_is_native_none() {
    let home = TempHome::new("state-missing");
    let state = load_state_file(home.path()).expect("load");
    assert!(state.is_none());
}

#[test]
fn malformed_file_is_typed_error() {
    let home = TempHome::new("state-malformed");
    home.write_state_raw(b"{ not json");
    let error = load_state_file(home.path()).expect_err("malformed");
    assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
}

#[test]
fn v1_file_is_rejected_as_malformed() {
    // A v1 document (no `version`, `selections` instead of `harnesses`) has
    // no trustworthy shape for this render plane: reject as malformed.
    let home = TempHome::new("state-v1");
    home.write_state_raw(
        br#"{ "sequence": 3, "selections": [ { "harness": "claude", "route": "native" } ] }"#,
    );
    let error = load_state_file(home.path()).expect_err("v1 rejected");
    assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
}

#[test]
fn wrong_version_is_rejected_as_malformed() {
    let home = TempHome::new("state-badver");
    home.write_state_json(&serde_json::json!({
        "version": 1,
        "sequence": 3,
        "harnesses": []
    }));
    let error = load_state_file(home.path()).expect_err("bad version");
    assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
}

#[test]
fn round_trip_serde_preserves_sources() {
    let state = AgentAuthState {
        version: STATE_VERSION,
        sequence: 42,
        lineage: "lineage-round-trip".into(),
        user_id: Some("user-1".into()),
        issuing_server_origin: None,
        harnesses: vec![
            HarnessAuth {
                harness_kind: "claude".into(),
                sources: vec![gateway_source("https://llm.proliferate.ai", "sk-vk")],
                settings: None,
                unsatisfied_reason: None,
            },
            HarnessAuth {
                harness_kind: "opencode".into(),
                sources: vec![
                    gateway_source("https://llm.proliferate.ai", "sk-vk"),
                    api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                ],
                settings: None,
                unsatisfied_reason: None,
            },
        ],
    };
    let json = serde_json::to_string(&state).expect("serialize");
    let parsed: AgentAuthState = serde_json::from_str(&json).expect("parse");
    assert_eq!(state, parsed);
    // gateway source drops the api_key-only fields on the wire.
    assert!(!json.contains("\"env_var_name\":null"));
}

/// The three-way lookup that the fail-closed law needs: absent, present-but-
/// empty, and present-with-sources must be distinguishable AT THIS LAYER.
/// The old `&[AuthSource]` signature collapsed the first two, which is why
/// "present-but-empty fails closed" could not be implemented above it.
#[test]
fn sources_lookup_distinguishes_absent_from_present_but_empty() {
    let state = AgentAuthState {
        version: STATE_VERSION,
        sequence: 5,
        lineage: "lineage-lookup".into(),
        user_id: None,
        issuing_server_origin: None,
        harnesses: vec![
            HarnessAuth {
                harness_kind: "codex".into(),
                sources: vec![api_key_source("OPENAI_API_KEY", "sk-raw")],
                settings: None,
                unsatisfied_reason: None,
            },
            // A selected harness whose every source was dropped as
            // unsatisfiable: the renderer keeps the entry, empty.
            HarnessAuth {
                harness_kind: "opencode".into(),
                sources: vec![],
                settings: None,
                unsatisfied_reason: None,
            },
        ],
    };

    let codex = state.sources_for("codex").expect("codex entry present");
    assert_eq!(codex.len(), 1);
    assert_eq!(codex[0].kind, SOURCE_KIND_API_KEY);

    // Present but empty → Some([]) (fails closed upstream).
    assert_eq!(
        state.sources_for("opencode").map(<[_]>::len),
        Some(0),
        "a present-but-empty entry must not read as absent"
    );

    // Absent harness → None (native upstream).
    assert!(state.sources_for("claude").is_none());
}

#[test]
fn empty_harnesses_field_defaults() {
    let json = r#"{ "version": 2, "sequence": 0, "lineage": "lineage-defaults" }"#;
    let state: AgentAuthState = serde_json::from_str(json).expect("parse");
    assert!(state.harnesses.is_empty());
    // No stamp on this (legacy) shape either.
    assert!(state.issuing_server_origin.is_none());
}

#[test]
fn a_document_without_lineage_is_malformed() {
    // REQUIRED, no serde default, no alias: `sequence` is only ordered within
    // one lineage, so a document that does not say which lineage it counts in
    // is not a document this render plane can order. A pre-lineage file on
    // disk reads malformed too — and malformed heals on the next valid push
    // (`apply_state_file_heals_a_malformed_file`'s established precedent).
    let home = TempHome::new("state-no-lineage");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "sequence": 3,
        "harnesses": []
    }));
    let error = load_state_file(home.path()).expect_err("missing lineage");
    assert!(matches!(error, RouteAuthError::MalformedStateFile { .. }));
}

#[test]
fn issuing_server_origin_round_trips_and_is_absent_by_default() {
    let json = r#"{ "version": 2, "sequence": 0, "lineage": "lineage-origin-rt", "issuing_server_origin": "https://proliferate.corp.example" }"#;
    let state: AgentAuthState = serde_json::from_str(json).expect("parse");
    assert_eq!(
        state.issuing_server_origin,
        Some("https://proliferate.corp.example".to_string())
    );
    let serialized = serde_json::to_string(&state).expect("serialize");
    assert!(serialized.contains("\"issuing_server_origin\":\"https://proliferate.corp.example\""));
}

fn stamped_state(origin: Option<&str>) -> AgentAuthState {
    AgentAuthState {
        version: STATE_VERSION,
        sequence: 1,
        lineage: "lineage-origin".into(),
        user_id: None,
        issuing_server_origin: origin.map(str::to_string),
        harnesses: vec![],
    }
}

#[test]
fn matches_server_origin_when_both_stamps_agree() {
    let state = stamped_state(Some("https://proliferate.corp.example"));
    assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
}

#[test]
fn matches_server_origin_is_case_and_trailing_slash_insensitive() {
    let state = stamped_state(Some("https://Proliferate.Corp.Example/"));
    assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
}

#[test]
fn matches_server_origin_rejects_a_real_mismatch() {
    let state = stamped_state(Some("https://old-server.example"));
    assert!(!state.matches_server_origin(Some("https://new-server.example")));
}

#[test]
fn matches_server_origin_treats_legacy_unstamped_file_as_a_match() {
    // Backward compat (task requirement): a file written before this field
    // existed must not suddenly start losing its gateway credentials.
    let state = stamped_state(None);
    assert!(state.matches_server_origin(Some("https://proliferate.corp.example")));
}

#[test]
fn matches_server_origin_treats_absent_current_origin_signal_as_a_match() {
    // No current-origin signal (e.g. a cloud sandbox launch, which never
    // sets the env var this is sourced from) -> never second-guess the
    // state file.
    let state = stamped_state(Some("https://proliferate.corp.example"));
    assert!(state.matches_server_origin(None));
}

fn state_with_sequence(sequence: i64) -> AgentAuthState {
    state_with_lineage(sequence, "lineage-a")
}

fn state_with_lineage(sequence: i64, lineage: &str) -> AgentAuthState {
    AgentAuthState {
        version: STATE_VERSION,
        sequence,
        lineage: lineage.into(),
        user_id: Some("user-1".into()),
        issuing_server_origin: None,
        harnesses: vec![HarnessAuth {
            harness_kind: "claude".into(),
            sources: vec![api_key_source("ANTHROPIC_API_KEY", "sk-raw")],
            settings: None,
            unsatisfied_reason: None,
        }],
    }
}

#[test]
fn apply_state_file_writes_private_and_round_trips() {
    let home = TempHome::new("apply-write");
    let state = state_with_sequence(7);
    apply_state_file(home.path(), &state).expect("apply");
    let loaded = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!(loaded, state);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(state_file_path(home.path()))
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn apply_state_file_rejects_lower_sequence_and_keeps_file() {
    let home = TempHome::new("apply-stale");
    apply_state_file(home.path(), &state_with_sequence(5)).expect("apply");
    let error = apply_state_file(home.path(), &state_with_sequence(4)).expect_err("stale");
    assert!(matches!(
        error,
        RouteAuthError::StaleStateSequence {
            incoming: 4,
            current: 5
        }
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_STALE");
    let loaded = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!(loaded.sequence, 5);
}

#[test]
fn apply_state_file_accepts_equal_and_higher_sequences() {
    let home = TempHome::new("apply-monotonic");
    apply_state_file(home.path(), &state_with_sequence(5)).expect("apply");
    // Equal sequence: an idempotent re-push of the same document. (Rotated
    // content at an equal sequence is no longer a legal input — the server
    // bumps the sequence on ANY content change, key rotation included.)
    apply_state_file(home.path(), &state_with_sequence(5)).expect("equal sequence re-push");
    apply_state_file(home.path(), &state_with_sequence(6)).expect("higher sequence");
    let loaded = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!(loaded.sequence, 6);
}

#[test]
fn apply_state_file_heals_a_malformed_file() {
    let home = TempHome::new("apply-heal");
    home.write_state_raw(b"{ not json");
    apply_state_file(home.path(), &state_with_sequence(3)).expect("heal");
    let loaded = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!(loaded.sequence, 3);
}

#[test]
fn clear_state_file_resets_sequence_lineage_for_native_then_new_route() {
    let home = TempHome::new("clear-native");
    apply_state_file(home.path(), &state_with_sequence(7)).expect("apply gateway state");

    clear_state_file(home.path()).expect("clear to native");
    assert!(load_state_file(home.path())
        .expect("load cleared state")
        .is_none());

    apply_state_file(home.path(), &state_with_sequence(1)).expect("apply new route lineage");
    assert_eq!(
        load_state_file(home.path())
            .expect("load replacement")
            .expect("replacement state")
            .sequence,
        1
    );

    // The foreign-lineage half of the same truth: after the explicit reset, a
    // push from an entirely NEW lineage adopts cleanly too — the reset is the
    // one recovery action (founder-ruled), and it needs no epoch, no
    // negotiation, just the absence of persisted state.
    clear_state_file(home.path()).expect("clear again");
    apply_state_file(home.path(), &state_with_lineage(1, "lineage-b"))
        .expect("a foreign lineage adopts after an explicit reset");
    let adopted = load_state_file(home.path())
        .expect("load adopted state")
        .expect("adopted state");
    assert_eq!(
        (adopted.sequence, adopted.lineage.as_str()),
        (1, "lineage-b")
    );
}

/// A push from a DIFFERENT lineage is refused with the typed code and leaves
/// the persisted file byte-untouched: the two counters share no order, so a
/// "which sequence is higher" comparison would be meaningless — and silently
/// wedging (the pre-lineage behavior) or silently adopting are both forbidden.
#[test]
fn apply_state_file_rejects_a_foreign_lineage_and_keeps_the_file() {
    let home = TempHome::new("apply-foreign-lineage");
    apply_state_file(home.path(), &state_with_lineage(5, "lineage-a")).expect("apply");

    // Higher sequence, wrong lineage: still refused — sequence comparisons
    // only mean anything within one lineage.
    let error = apply_state_file(home.path(), &state_with_lineage(9, "lineage-b"))
        .expect_err("foreign lineage");
    assert!(matches!(
        &error,
        RouteAuthError::ForeignStateLineage { persisted, incoming }
            if persisted == "lineage-a" && incoming == "lineage-b"
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_LINEAGE");
    // Plain words, naming the one recovery action.
    let words = error.to_string();
    assert!(words.contains("different server database"), "{words}");
    assert!(words.contains("reset this machine's agent auth"), "{words}");

    let kept = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!(kept, state_with_lineage(5, "lineage-a"));
}

/// THE COUNTEREXAMPLE the ruling demands (the reason "different lineage ⇒
/// accept" is forbidden): persisted lineage A@60 → explicit reset → adopt
/// B@1 → a DELAYED A@61 push arrives. Under accept-on-new-lineage it would
/// resurrect the retired A state over the live B state; here it must be
/// REJECTED as foreign, because after the reset the persisted lineage is B.
#[test]
fn a_delayed_push_from_the_retired_lineage_is_rejected_after_reset_adoption() {
    let home = TempHome::new("apply-delayed-old-lineage");
    apply_state_file(home.path(), &state_with_lineage(60, "lineage-a")).expect("apply A@60");

    // The one explicit recovery action: reset this machine.
    clear_state_file(home.path()).expect("reset");
    apply_state_file(home.path(), &state_with_lineage(1, "lineage-b")).expect("adopt B@1");

    // The delayed push from the retired lineage, sequence higher than the
    // live document's: refused, nothing applied.
    let error = apply_state_file(home.path(), &state_with_lineage(61, "lineage-a"))
        .expect_err("a delayed push from the retired lineage must be rejected");
    assert!(matches!(
        &error,
        RouteAuthError::ForeignStateLineage { persisted, incoming }
            if persisted == "lineage-b" && incoming == "lineage-a"
    ));
    let kept = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!((kept.sequence, kept.lineage.as_str()), (1, "lineage-b"));
}

/// Same lineage → the sequence rule, byte-for-byte unchanged: below rejects,
/// equal is the idempotent re-push, higher advances. (The pre-lineage suite
/// above pins the same rule; this pins that the lineage check did not eat it.)
#[test]
fn same_lineage_keeps_the_existing_sequence_rule() {
    let home = TempHome::new("apply-same-lineage");
    apply_state_file(home.path(), &state_with_lineage(5, "lineage-a")).expect("apply");
    let error = apply_state_file(home.path(), &state_with_lineage(4, "lineage-a"))
        .expect_err("below-sequence still rejected");
    assert!(matches!(
        error,
        RouteAuthError::StaleStateSequence {
            incoming: 4,
            current: 5
        }
    ));
    apply_state_file(home.path(), &state_with_lineage(5, "lineage-a"))
        .expect("equal sequence accepted");
    apply_state_file(home.path(), &state_with_lineage(6, "lineage-a"))
        .expect("higher sequence accepted");
}

/// A pre-lineage (or otherwise malformed) on-disk document carries no
/// trustworthy lineage and is healed by any valid push — the same tolerance
/// `apply_state_file_heals_a_malformed_file` pins for broken JSON.
#[test]
fn a_document_missing_lineage_on_disk_is_healed_by_the_next_valid_push() {
    let home = TempHome::new("apply-heal-no-lineage");
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "sequence": 60,
        "harnesses": []
    }));
    assert!(matches!(
        load_state_file(home.path()).expect_err("missing lineage is malformed"),
        RouteAuthError::MalformedStateFile { .. }
    ));

    apply_state_file(home.path(), &state_with_lineage(1, "lineage-b")).expect("heal");
    let healed = load_state_file(home.path()).expect("load").expect("state");
    assert_eq!((healed.sequence, healed.lineage.as_str()), (1, "lineage-b"));
}
