//! Tests for [`super`] (profile resolution) — split out of `profile.rs` for
//! the line-count ceiling; `#[path]`-included so `super::*` still reaches the
//! module under test.

use super::*;

use crate::domains::agents::route_auth::state::{AuthSource, HarnessAuth, STATE_VERSION};

fn state(revision: i64, harnesses: Vec<HarnessAuth>) -> AgentAuthState {
    AgentAuthState {
        version: STATE_VERSION,
        revision,
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
    }
}

#[test]
fn no_state_file_is_native() {
    let profile = resolve_profile(None, "claude").expect("resolve");
    assert_eq!(profile, AgentRuntimeAuthProfile::Native);
}

#[test]
fn missing_harness_falls_back_to_native() {
    // codex configured (bumps the global revision) must NOT block claude,
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
/// the typed refusal, carrying the revision so the UI can say which document
/// generation was dead.
#[test]
fn empty_sources_fails_closed_with_the_revision() {
    let state = state(4, vec![harness("claude", vec![])]);

    let error = resolve_profile(Some(&state), "claude").expect_err("must fail closed");

    assert!(matches!(
        error,
        RouteAuthError::SelectionMissing {
            ref harness_kind,
            revision: 4,
        } if harness_kind == "claude"
    ));
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_MISSING");
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
        vec![harness("claude", vec![gateway_source("https://gw", "sk-vk")])],
    );
    let profile = resolve_profile(Some(&state), "claude").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.harness_kind, "claude");
            assert_eq!(sources.revision, 3);
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

// --- provider_config (Track D) ---------------------------------------

#[test]
fn provider_config_source_resolves_with_its_already_resolved_env_map() {
    let state = state(
        2,
        vec![harness(
            "opencode",
            vec![provider_config_source(
                "aws_bedrock",
                &[
                    ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ("AWS_REGION", "us-east-1"),
                ],
            )],
        )],
    );
    let profile = resolve_profile(Some(&state), "opencode").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            assert_eq!(sources.sources.len(), 1);
            match &sources.sources[0] {
                ResolvedSource::ProviderConfig(profile) => {
                    assert_eq!(profile.config_kind, "aws_bedrock");
                    assert_eq!(
                        profile.env.get("AWS_BEARER_TOKEN_BEDROCK").map(String::as_str),
                        Some("bedrock-raw")
                    );
                    assert_eq!(
                        profile.env.get("AWS_REGION").map(String::as_str),
                        Some("us-east-1")
                    );
                }
                other => panic!("expected ProviderConfig, got {other:?}"),
            }
        }
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn provider_config_with_empty_env_is_selection_incomplete() {
    let state = state(
        1,
        vec![harness("opencode", vec![provider_config_source("aws_bedrock", &[])])],
    );
    let error = resolve_profile(Some(&state), "opencode").expect_err("empty env");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

#[test]
fn provider_config_missing_config_kind_is_selection_incomplete() {
    let state = state(
        1,
        vec![harness(
            "opencode",
            vec![AuthSource {
                kind: SOURCE_KIND_PROVIDER_CONFIG.into(),
                base_url: None,
                key: None,
                env_var_name: None,
                value: None,
                config_kind: None,
                env: Some(
                    [("AWS_REGION".to_string(), "us-east-1".to_string())]
                        .into_iter()
                        .collect(),
                ),
                seat_id: None,
            }],
        )],
    );
    let error = resolve_profile(Some(&state), "opencode").expect_err("missing config_kind");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

// --- seat (seats v1) --------------------------------------------------

#[test]
fn seat_source_resolves_with_its_env_map_and_seat_id() {
    let state = state(
        3,
        vec![harness(
            "claude",
            vec![seat_source("seat-uuid-1", "sk-ant-oat01-token")],
        )],
    );
    let profile = resolve_profile(Some(&state), "claude").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => match &sources.sources[..] {
            [ResolvedSource::Seat(seat)] => {
                assert_eq!(seat.seat_id, "seat-uuid-1");
                assert_eq!(
                    seat.env.get("CLAUDE_CODE_OAUTH_TOKEN").map(String::as_str),
                    Some("sk-ant-oat01-token")
                );
            }
            other => panic!("expected one Seat source, got {other:?}"),
        },
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn seat_pool_resolves_every_seat_in_document_order() {
    // The producer expands the pool in vault order; resolution preserves it
    // (which seat SERVES is render's call — first, until rotation lands).
    let state = state(
        4,
        vec![harness(
            "claude",
            vec![
                seat_source("seat-a", "sk-tok-a"),
                seat_source("seat-b", "sk-tok-b"),
            ],
        )],
    );
    let profile = resolve_profile(Some(&state), "claude").expect("resolve");
    match profile {
        AgentRuntimeAuthProfile::Sources(sources) => {
            let ids: Vec<&str> = sources
                .sources
                .iter()
                .map(|source| match source {
                    ResolvedSource::Seat(seat) => seat.seat_id.as_str(),
                    other => panic!("expected Seat, got {other:?}"),
                })
                .collect();
            assert_eq!(ids, ["seat-a", "seat-b"]);
        }
        other => panic!("expected sources, got {other:?}"),
    }
}

#[test]
fn seat_missing_seat_id_is_selection_incomplete() {
    let mut source = seat_source("seat-a", "sk-tok");
    source.seat_id = None;
    let state = state(1, vec![harness("claude", vec![source])]);
    let error = resolve_profile(Some(&state), "claude").expect_err("missing seat_id");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}

#[test]
fn seat_with_empty_env_is_selection_incomplete() {
    let mut source = seat_source("seat-a", "sk-tok");
    source.env = Some(BTreeMap::new());
    let state = state(1, vec![harness("claude", vec![source])]);
    let error = resolve_profile(Some(&state), "claude").expect_err("empty env");
    assert!(matches!(error, RouteAuthError::SelectionIncomplete { .. }));
}
