//! The per-source-kind arms of profile resolution — `provider_config` (Track D)
//! and `seat` (seats v1) — split out of `profile_tests.rs` for the line-count
//! ceiling, the same reason that file was split out of `profile.rs`.
//!
//! Included as a CHILD of `profile_tests`, not a sibling of it, so the document
//! and source builders there (`state`, `harness`, `provider_config_source`,
//! `seat_source`) are reachable without a second copy of each.

use super::*;

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
                        profile
                            .env
                            .get("AWS_BEARER_TOKEN_BEDROCK")
                            .map(String::as_str),
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
        vec![harness(
            "opencode",
            vec![provider_config_source("aws_bedrock", &[])],
        )],
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
