//! Tests for [`super`] (profile resolution) — split out of `profile.rs` for
//! the line-count ceiling; `#[path]`-included so `super::*` still reaches the
//! module under test.

use super::*;

use crate::domains::agents::route_auth::state::{AuthSource, HarnessAuth, STATE_VERSION};

fn state(sequence: i64, harnesses: Vec<HarnessAuth>) -> AgentAuthState {
    AgentAuthState {
        version: STATE_VERSION,
        sequence,
        lineage: "profile-tests-lineage".into(),
        user_id: None,
        issuing_server_origin: None,
        harnesses,
    }
}

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

fn provider_config_source(config_kind: &str, env: &[(&str, &str)]) -> AuthSource {
    AuthSource {
        kind: SOURCE_KIND_PROVIDER_CONFIG.into(),
        base_url: None,
        key: None,
        env_var_name: None,
        value: None,
        config_kind: Some(config_kind.into()),
        env: Some(
            env.iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        ),
        seat_id: None,
    }
}

fn seat_source(seat_id: &str, token: &str) -> AuthSource {
    AuthSource {
        kind: SOURCE_KIND_SEAT.into(),
        base_url: None,
        key: None,
        env_var_name: None,
        value: None,
        config_kind: None,
        env: Some(
            [("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token.to_string())]
                .into_iter()
                .collect(),
        ),
        seat_id: Some(seat_id.into()),
    }
}

fn harness(kind: &str, sources: Vec<AuthSource>) -> HarnessAuth {
    HarnessAuth {
        harness_kind: kind.into(),
        sources,
        settings: None,
        unsatisfied_reason: None,
    }
}

#[test]
fn no_state_file_is_native() {
    let profile = resolve_profile(None, "claude").expect("resolve");
    assert_eq!(profile, AgentRuntimeAuthProfile::Native);
}

#[test]
fn missing_harness_falls_back_to_native() {
    // codex configured (bumps the global sequence) must NOT block claude,
    // which the user never configured — claude resolves Native.
    let state = state(
        7,
        vec![harness("codex", vec![gateway_source("https://gw", "sk")])],
    );
    let profile = resolve_profile(Some(&state), "claude").expect("resolve");
    assert_eq!(profile, AgentRuntimeAuthProfile::Native);
}

/// THE fail-closed case, and the one this rewrites: an entry the user
/// selected whose every source the renderer dropped as unsatisfiable.
///
/// This test previously asserted `Native` — i.e. it pinned the
/// silent-degradation bug as intended behavior. A desktop user with a native
/// claude login whose gateway budget exhausts would have had the launch
/// silently succeed against their personal Anthropic account. It now asserts
/// the typed refusal, carrying the sequence so the UI can say which document
/// generation was dead.
#[test]
fn empty_sources_fails_closed_with_the_sequence() {
    let state = state(4, vec![harness("claude", vec![])]);

    let error = resolve_profile(Some(&state), "claude").expect_err("must fail closed");

    assert!(matches!(
        error,
        RouteAuthError::SelectionMissing {
            ref harness_kind,
            sequence: 4,
            reason: None,
        } if harness_kind == "claude"
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_MISSING");
}

/// The document's `unsatisfied_reason` rides into the refusal, and the
/// Display speaks it verbatim (no "(state sequence N)" suffix — the sequence
/// stays a struct field for logs only).
#[test]
fn unsatisfied_reason_reaches_the_refusal_and_its_display() {
    let mut entry = harness("claude", vec![]);
    entry.unsatisfied_reason = Some("the credits behind it ran out".to_string());
    let with_reason = state(4, vec![entry]);

    let error = resolve_profile(Some(&with_reason), "claude").expect_err("must fail closed");
    assert!(matches!(
        error,
        RouteAuthError::SelectionMissing { ref reason, .. }
            if reason.as_deref() == Some("the credits behind it ran out")
    ));
    assert_eq!(
        error.to_string(),
        "The auth method selected for claude can't be used right now — \
         the credits behind it ran out. Pick or fix a method in Settings → Agents."
    );

    // Without a carried reason the family sentence stands, still without the
    // sequence suffix.
    let bare = resolve_profile(Some(&state(4, vec![harness("claude", vec![])])), "claude")
        .expect_err("must fail closed");
    assert_eq!(
        bare.to_string(),
        "The auth method selected for claude can't be used right now — \
         its seat or key may have been revoked, or the credits behind it ran out. \
         Pick or fix a method in Settings → Agents."
    );
}

/// The reason a refusal ends up carrying for a raw document value.
fn carried_reason(raw: &str) -> Option<String> {
    let mut entry = harness("claude", vec![]);
    entry.unsatisfied_reason = Some(raw.to_string());
    match resolve_profile(Some(&state(1, vec![entry])), "claude") {
        Err(RouteAuthError::SelectionMissing { reason, .. }) => reason,
        other => panic!("expected SelectionMissing, got {other:?}"),
    }
}

/// The clamp before shipped logs: the frozen vocabulary passes verbatim; an
/// over-long or token-shaped value is treated as absent (family fallback).
#[test]
fn unsatisfied_reason_is_clamped_to_short_plain_words() {
    let words = "its Claude.ai login was removed or signed out";
    assert_eq!(carried_reason(words).as_deref(), Some(words));
    assert_eq!(carried_reason(&"a ".repeat(101)), None); // 202 chars, plain words
    assert_eq!(carried_reason("sk-ant-oat01-leaked"), None); // `sk-` prefix
    assert_eq!(carried_reason(&"A1".repeat(16)), None); // a 32-char token run
    assert!(carried_reason(&"A1".repeat(15)).is_some()); // 30 chars: still words
}

// --- settings["rotate"] parse ------------------------------------------

fn sources_of(state: &AgentAuthState, harness_kind: &str) -> HarnessSources {
    match resolve_profile(Some(state), harness_kind).expect("resolve") {
        AgentRuntimeAuthProfile::Sources(sources) => sources,
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn rotate_defaults_true_when_settings_or_key_absent() {
    let state = state(
        1,
        vec![harness("claude", vec![seat_source("seat-a", "sk-tok")])],
    );
    assert!(sources_of(&state, "claude").rotate);
}

#[test]
fn rotate_false_is_honored() {
    let mut entry = harness("claude", vec![seat_source("seat-a", "sk-tok")]);
    entry.settings = Some(
        [("rotate".to_string(), serde_json::Value::Bool(false))]
            .into_iter()
            .collect(),
    );
    let state = state(1, vec![entry]);
    assert!(!sources_of(&state, "claude").rotate);
}

#[test]
fn a_non_bool_rotate_reads_as_true() {
    let mut entry = harness("claude", vec![seat_source("seat-a", "sk-tok")]);
    entry.settings = Some(
        [(
            "rotate".to_string(),
            serde_json::Value::String("off".to_string()),
        )]
        .into_iter()
        .collect(),
    );
    let state = state(1, vec![entry]);
    assert!(sources_of(&state, "claude").rotate);
}

/// The distinction the whole change rests on, asserted as one comparison:
/// the same document, two harnesses, opposite answers. Absent → native;
/// present-but-empty → refused.
#[test]
fn absent_is_native_while_present_but_empty_is_refused() {
    let state = state(
        9,
        vec![
            harness("claude", vec![]),
            harness("codex", vec![gateway_source("https://gw", "sk")]),
        ],
    );

    // claude: selected, unsatisfiable → refuse.
    assert!(matches!(
        resolve_profile(Some(&state), "claude"),
        Err(RouteAuthError::SelectionMissing { .. })
    ));
    // opencode: never configured → native. Same document.
    assert_eq!(
        resolve_profile(Some(&state), "opencode").expect("resolve"),
        AgentRuntimeAuthProfile::Native
    );
    // codex: satisfiable → sources.
    assert!(matches!(
        resolve_profile(Some(&state), "codex").expect("resolve"),
        AgentRuntimeAuthProfile::Sources(_)
    ));
}

/// An empty entry for ANOTHER harness must not contaminate this one: the
/// refusal is per-harness, not per-document. Without this, one exhausted
/// budget would take every harness on the machine down with it.
#[test]
fn one_harnesss_dead_selection_does_not_refuse_another() {
    let state = state(
        11,
        vec![
            harness("opencode", vec![]),
            harness("claude", vec![gateway_source("https://gw", "sk-vk")]),
        ],
    );

    assert!(matches!(
        resolve_profile(Some(&state), "claude").expect("resolve"),
        AgentRuntimeAuthProfile::Sources(_)
    ));
    assert!(matches!(
        resolve_profile(Some(&state), "opencode"),
        Err(RouteAuthError::SelectionMissing { .. })
    ));
}

/// No state file at all is still native — the fail-closed rule keys on a
/// PRESENT entry, so a machine that has never synced auth is unaffected.
#[test]
fn no_file_is_native_even_though_empty_entries_now_refuse() {
    assert_eq!(
        resolve_profile(None, "claude").expect("resolve"),
        AgentRuntimeAuthProfile::Native
    );
}

#[test]
fn single_gateway_source_resolves() {
    let state = state(
        3,
        vec![harness(
            "claude",
            vec![gateway_source("https://gw", "sk-vk")],
        )],
    );
    let profile = resolve_profile(Some(&state), "claude").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.harness_kind, "claude");
            assert_eq!(sources.sequence, 3);
            assert_eq!(sources.sources.len(), 1);
            assert_eq!(
                sources.sources[0],
                ResolvedSource::Gateway(GatewayProfile {
                    base_url: "https://gw".into(),
                    key: "sk-vk".into(),
                })
            );
        }
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn single_api_key_source_resolves() {
    let state = state(
        1,
        vec![harness(
            "codex",
            vec![api_key_source("OPENAI_API_KEY", "sk-raw")],
        )],
    );
    let profile = resolve_profile(Some(&state), "codex").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(
                sources.sources[0],
                ResolvedSource::ApiKey(ApiKeyProfile {
                    env_var_name: "OPENAI_API_KEY".into(),
                    value: "sk-raw".into(),
                })
            );
        }
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn multiple_sources_compose_in_order() {
    // OpenCode: a gateway plus two direct api_key rows, all enabled.
    let state = state(
        6,
        vec![harness(
            "opencode",
            vec![
                gateway_source("https://gw", "sk-vk"),
                api_key_source("ANTHROPIC_API_KEY", "sk-ant"),
                api_key_source("XAI_API_KEY", "xai-raw"),
            ],
        )],
    );
    let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.sources.len(), 3);
            assert!(matches!(sources.sources[0], ResolvedSource::Gateway(_)));
            assert!(matches!(sources.sources[1], ResolvedSource::ApiKey(_)));
            assert!(matches!(sources.sources[2], ResolvedSource::ApiKey(_)));
        }
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn unknown_source_kind_is_typed_error() {
    let state = state(
        1,
        vec![harness(
            "claude",
            vec![AuthSource {
                kind: "bogus".into(),
                base_url: None,
                key: None,
                env_var_name: None,
                value: None,
                config_kind: None,
                env: None,
                seat_id: None,
            }],
        )],
    );
    let error = resolve_profile(Some(&state), "claude").expect_err("unknown kind");
    assert!(matches!(error, RouteAuthError::UnsupportedRoute { .. }));
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

#[test]
fn gateway_missing_base_url_is_incomplete() {
    let state = state(
        1,
        vec![harness(
            "claude",
            vec![AuthSource {
                kind: SOURCE_KIND_GATEWAY.into(),
                base_url: None,
                key: Some("sk".into()),
                env_var_name: None,
                value: None,
                config_kind: None,
                env: None,
                seat_id: None,
            }],
        )],
    );
    let error = resolve_profile(Some(&state), "claude").expect_err("no base_url");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

#[test]
fn api_key_missing_value_is_incomplete() {
    let state = state(
        1,
        vec![harness(
            "codex",
            vec![AuthSource {
                kind: SOURCE_KIND_API_KEY.into(),
                base_url: None,
                key: None,
                env_var_name: Some("OPENAI_API_KEY".into()),
                value: None,
                config_kind: None,
                env: None,
                seat_id: None,
            }],
        )],
    );
    let error = resolve_profile(Some(&state), "codex").expect_err("no value");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

#[test]
fn blank_field_is_incomplete() {
    let state = state(
        1,
        vec![harness("claude", vec![gateway_source("   ", "sk")])],
    );
    let error = resolve_profile(Some(&state), "claude").expect_err("blank base_url");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

#[path = "profile_source_kind_tests.rs"]
mod source_kind_tests;
