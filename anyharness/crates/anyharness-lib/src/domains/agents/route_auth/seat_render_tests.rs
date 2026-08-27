//! claude seat-recipe render tests (seats v1) — split from `render_tests.rs`
//! for the line-count ceiling; nested inside it so its `TempHome` and
//! resolver helpers are in scope.

use super::*;

// --- claude · seat (seats v1) ----------------------------------------------

fn seat_source(seat_id: &str, token: &str) -> Value {
    json!({
        "kind": "seat",
        "env": { "CLAUDE_CODE_OAUTH_TOKEN": token },
        "seat_id": seat_id,
    })
}

/// The seat recipe, exactly (agent_auth spec §4 cell 2, "claude · seat"): env
/// only — `CLAUDE_CODE_OAUTH_TOKEN` + a per-seat `CLAUDE_CONFIG_DIR`
/// (`claude-config-<seat>/`) — plus the full claude strip list:
/// `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` and the
/// rerouting flags. The token var itself is never scheduled for removal — it
/// IS the route.
#[test]
fn claude_seat_sets_token_and_per_seat_dir_and_strips_the_ambient_list() {
    let home = TempHome::new("claude-seat");
    home.write_state_json(&v2_state(
        7,
        vec![harness(
            "claude",
            vec![seat_source(
                "11111111-2222-4333-8444-555555555555",
                "sk-ant-oat01-seat-token",
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("CLAUDE_CODE_OAUTH_TOKEN").unwrap(),
        "sk-ant-oat01-seat-token"
    );
    let config_dir = rendered
        .set
        .get("CLAUDE_CONFIG_DIR")
        .expect("CLAUDE_CONFIG_DIR");
    assert!(
        config_dir.contains("claude-config-11111111-2222-4333-8444-555555555555"),
        "per-seat dir, not the shared claude-config: {config_dir}"
    );
    assert!(
        std::path::Path::new(config_dir).is_dir(),
        "seat home materialized"
    );

    // The strip list: every Anthropic selector this route did not set, plus
    // the rerouting flags — INCLUDING the model-selector family (live incident
    // 2026-08-27: an ambient ANTHROPIC_DEFAULT_SONNET_MODEL=global.anthropic.…
    // from a Bedrock-configured host resolved the seat session's model alias
    // to a Bedrock-format id and every turn failed model-not-found).
    for key in [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_BEDROCK_REGION_PREFIX",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }
    assert!(!rendered
        .remove
        .contains(&"CLAUDE_CODE_OAUTH_TOKEN".to_string()));
    // Env-only recipe: the seat sets exactly the token + the config dir.
    assert_eq!(rendered.set.len(), 2);
}

/// Slice 1 has no rotation: the pool's FIRST seat (vault order) serves, and a
/// later seat's token must not overwrite it. One seat home materializes.
#[test]
fn claude_seat_pool_serves_the_first_seat_without_rotation() {
    let home = TempHome::new("claude-seat-pool");
    home.write_state_json(&v2_state(
        8,
        vec![harness(
            "claude",
            vec![
                seat_source("seat-first", "sk-tok-first"),
                seat_source("seat-second", "sk-tok-second"),
            ],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("CLAUDE_CODE_OAUTH_TOKEN").unwrap(),
        "sk-tok-first"
    );
    let config_dir = rendered.set.get("CLAUDE_CONFIG_DIR").expect("dir");
    assert!(config_dir.contains("claude-config-seat-first"));
    assert_eq!(rendered.files.len(), 1);
    assert_eq!(
        rendered.files[0].path_family,
        PathFamily::ClaudeSeatConfig {
            seat_id: "seat-first".into()
        }
    );
}

/// Seats are claude-only this slice; every other harness refuses in type.
#[test]
fn seat_on_a_seatless_harness_is_unsupported() {
    let home = TempHome::new("codex-seat");
    home.write_state_json(&v2_state(
        1,
        vec![harness("codex", vec![seat_source("seat-a", "sk-tok")])],
    ));

    let error = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver)
        .expect_err("codex has no seat recipe");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

/// Two seats, two isolated homes: the per-seat dir is keyed by the seat id, so
/// switching the pool's head switches the config dir with it — per-seat
/// keychain state never crosses seats.
#[test]
fn per_seat_config_dirs_are_distinct_across_seats() {
    let home = TempHome::new("claude-seat-dirs");
    home.write_state_json(&v2_state(
        9,
        vec![harness("claude", vec![seat_source("seat-a", "sk-tok-a")])],
    ));
    let first =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    home.write_state_json(&v2_state(
        10,
        vec![harness("claude", vec![seat_source("seat-b", "sk-tok-b")])],
    ));
    let second =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    let dir_a = first.set.get("CLAUDE_CONFIG_DIR").expect("dir a");
    let dir_b = second.set.get("CLAUDE_CONFIG_DIR").expect("dir b");
    assert_ne!(dir_a, dir_b);
    // Both seat homes exist: the first seat's dir survives the switch (its
    // keychain material must not be swept by a document revision).
    assert!(std::path::Path::new(dir_a).is_dir());
    assert!(std::path::Path::new(dir_b).is_dir());
}
