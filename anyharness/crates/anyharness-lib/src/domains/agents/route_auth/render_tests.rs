//! Adapter render snapshots + native/malformed-file behavior + two-phase
//! purity. Exercises the full loader→profile→render→apply path against a real
//! filesystem (the unit-level live gate for the render plane).

use serde_json::{json, Value};

use super::materialize::PathFamily;
use super::plan::{GatewayModelPlan, GatewayModelResolve};
use super::render::render_profile;
use super::state::state_file_path;
use super::test_support::TempHome;
use super::{load_state_file, resolve_launch_route_auth, resolve_profile, RouteAuthError};

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

/// Exact live gateway rows supplied by the test resolver.
const OPENCODE_LIVE_MODELS: &[&str] = &[
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
];

/// Only opencode needs a model list before spawn; the list here represents the
/// target's live gateway response.
struct HarnessPlanResolver;

impl GatewayModelResolve for HarnessPlanResolver {
    fn resolve_gateway_models(&self, harness_kind: &str, _sequence: i64) -> GatewayModelPlan {
        match harness_kind {
            "opencode" => GatewayModelPlan {
                models: OPENCODE_LIVE_MODELS.iter().map(|m| m.to_string()).collect(),
                ..Default::default()
            },
            _ => GatewayModelPlan::default(),
        }
    }
}

/// A resolver that returns a fixed plan for any harness — for tests that pin an
/// exact plan (e.g. a specific gateway model list or an empty plan).
struct FixedResolver(GatewayModelPlan);

impl GatewayModelResolve for FixedResolver {
    fn resolve_gateway_models(&self, _harness_kind: &str, _sequence: i64) -> GatewayModelPlan {
        self.0.clone()
    }
}

fn v2_state(sequence: i64, harnesses: Vec<Value>) -> Value {
    json!({
        "version": 2,
        "lineage": "test-lineage",
        "sequence": sequence,
        "user_id": "user-1",
        "harnesses": harnesses,
    })
}

fn harness(kind: &str, sources: Vec<Value>) -> Value {
    json!({ "harness_kind": kind, "sources": sources })
}

fn gateway_source() -> Value {
    json!({ "kind": "gateway", "base_url": GATEWAY_BASE_URL, "key": VK })
}

fn api_key_source(env_var_name: &str, value: &str) -> Value {
    json!({ "kind": "api_key", "env_var_name": env_var_name, "value": value })
}

/// A single-gateway state for `harness` at sequence 42 (keeps the
/// `*-home-42` dir-name assertions stable).
fn gateway_state(kind: &str) -> Value {
    v2_state(42, vec![harness(kind, vec![gateway_source()])])
}

// --- claude ----------------------------------------------------------------

#[test]
fn claude_gateway_sets_base_url_token_and_sanitizes_ambient() {
    let home = TempHome::new("claude-gw");
    home.write_state_json(&gateway_state("claude"));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("ANTHROPIC_BASE_URL").unwrap(),
        GATEWAY_BASE_URL
    );
    assert_eq!(rendered.set.get("ANTHROPIC_AUTH_TOKEN").unwrap(), VK);
    assert!(!rendered.set.contains_key("ANTHROPIC_SMALL_FAST_MODEL"));
    // Isolated CLAUDE_CONFIG_DIR so ambient ~/.claude cannot defeat sanitization.
    let config_dir = rendered
        .set
        .get("CLAUDE_CONFIG_DIR")
        .expect("CLAUDE_CONFIG_DIR");
    assert!(config_dir.contains("claude-config"));
    assert!(std::path::Path::new(config_dir).is_dir());
    // Ambient Bedrock/Vertex + stale api key removed.
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "AWS_BEARER_TOKEN_BEDROCK",
        "ANTHROPIC_API_KEY",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }
    assert!(!rendered.set.contains_key("ANTHROPIC_API_KEY"));
    // The gateway base-url/token we SET must NOT be scheduled for removal.
    assert!(!rendered.remove.contains(&"ANTHROPIC_BASE_URL".to_string()));
    assert!(!rendered
        .remove
        .contains(&"ANTHROPIC_AUTH_TOKEN".to_string()));
}

/// A claude `api_key` route sets exactly its var AND sanitizes the ambient
/// provider env — the REVERSE-contamination case.
///
/// This test previously asserted `rendered.remove.is_empty()`, i.e. it pinned the
/// gap: on a Bedrock-configured host the ambient `CLAUDE_CODE_USE_BEDROCK=1`
/// survived a BYOK launch, so the CLI routed to Bedrock while the key the user
/// actually selected sat unused in the env. agent-auth.md requires sanitization on
/// every non-native route, not just the gateway one.
///
/// What stays true: the `api_key` recipe itself is still fully generic — one env
/// var set, no config dir, no files. Only the removals are added, and only for
/// claude, whose CLI is the one that reroutes on ambient flags.
#[test]
fn claude_api_key_sets_its_var_and_still_sanitizes_ambient() {
    let home = TempHome::new("claude-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![api_key_source("ANTHROPIC_API_KEY", "sk-raw")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(rendered.set.get("ANTHROPIC_API_KEY").unwrap(), "sk-raw");
    assert_eq!(rendered.set.len(), 1, "the api_key recipe stays generic");
    assert!(
        rendered.files.is_empty(),
        "no config file for an api_key route"
    );

    // The rerouting flags go, so the selected key is what the CLI actually uses.
    for key in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "AWS_BEARER_TOKEN_BEDROCK",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }
    // The var THIS route set is kept; the other selectors it did not set are
    // removed so an ambient value cannot shadow the chosen credential.
    assert!(!rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));
    assert!(rendered
        .remove
        .contains(&"ANTHROPIC_AUTH_TOKEN".to_string()));
    assert!(rendered.remove.contains(&"ANTHROPIC_BASE_URL".to_string()));
}

/// SECURITY REGRESSION GUARD (review B1). The `api_key` arm sets an ARBITRARY,
/// user-chosen env var name — the only server-side gate is a shape regex
/// (`^[A-Z][A-Z0-9_]{0,127}$`), no denylist. So a claude `api_key` row can be
/// named `CLAUDE_CODE_USE_BEDROCK` with value `1`. If sanitization's rerouting-
/// flag exemption keyed off `rendered.set` at large, that row would SURVIVE and
/// silently reroute the launch to Bedrock with no Bedrock credential selected.
/// The exemption is therefore scoped to the keys the `provider_config` arm
/// composed; for `api_key`-named vars the removal stays unconditional.
#[test]
fn claude_api_key_named_like_a_rerouting_flag_is_still_stripped() {
    let home = TempHome::new("claude-key-named-bedrock");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![api_key_source("CLAUDE_CODE_USE_BEDROCK", "1")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert!(
        rendered
            .remove
            .contains(&"CLAUDE_CODE_USE_BEDROCK".to_string()),
        "an api_key-named rerouting flag must still be stripped, got removals {:?}",
        rendered.remove
    );
    // Same shape for the Bedrock bearer token: an api_key row named that was
    // neutralized before Track D and must stay neutralized.
    let home = TempHome::new("claude-key-named-bearer");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![api_key_source(
                "AWS_BEARER_TOKEN_BEDROCK",
                "not-a-real-token",
            )],
        )],
    ));
    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered
        .remove
        .contains(&"AWS_BEARER_TOKEN_BEDROCK".to_string()));
}

/// Sanitization is claude-specific: no other harness's CLI reroutes on those
/// flags, and adding removals for them would be an unexplained env change.
#[test]
fn a_non_claude_api_key_route_adds_no_removals() {
    let home = TempHome::new("codex-key-no-sanitize");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "codex",
            vec![api_key_source("OPENAI_API_KEY", "sk-raw")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");

    assert_eq!(rendered.set.get("OPENAI_API_KEY").unwrap(), "sk-raw");
    assert!(rendered.remove.is_empty());
}

#[test]
fn claude_gateway_sanitize_only_strips_vars_it_did_not_set() {
    // The sanitize keys off which vars this render set: base-url + auth-token are
    // set → kept; ANTHROPIC_API_KEY is not set → removed.
    let home = TempHome::new("claude-sanitize");
    home.write_state_json(&gateway_state("claude"));
    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));
    assert!(!rendered.remove.contains(&"ANTHROPIC_BASE_URL".to_string()));
    assert!(!rendered
        .remove
        .contains(&"ANTHROPIC_AUTH_TOKEN".to_string()));
}

// --- codex -----------------------------------------------------------------

#[test]
fn codex_gateway_materializes_config_toml_and_sets_env() {
    let home = TempHome::new("codex-gw");
    home.write_state_json(&gateway_state("codex"));

    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");

    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert!(codex_home.contains("codex-home-42"));
    assert_eq!(rendered.set.get("PROLIFERATE_GATEWAY_KEY").unwrap(), VK);
    assert!(rendered.remove.contains(&"OPENAI_API_KEY".to_string()));
    assert!(rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));

    let config = std::fs::read_to_string(std::path::Path::new(codex_home).join("config.toml"))
        .expect("read config.toml");
    assert!(config.contains("model_provider = \"proliferate\""));
    assert!(
        !config.contains("model ="),
        "route config must not author a model: {config}"
    );
    assert!(config.contains("base_url = \"https://llm.proliferate.ai/v1\""));
    assert!(config.contains("env_key = \"PROLIFERATE_GATEWAY_KEY\""));
    assert!(config.contains("wire_api = \"responses\""));
}

#[test]
fn codex_api_key_sets_exactly_its_var() {
    let home = TempHome::new("codex-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "codex",
            vec![api_key_source("OPENAI_API_KEY", "sk-openai")],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("OPENAI_API_KEY").unwrap(), "sk-openai");
    assert!(!rendered.set.contains_key("CODEX_HOME"));
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
}

// --- grok ------------------------------------------------------------------

#[test]
fn grok_gateway_sets_models_base_url_and_isolated_home() {
    let home = TempHome::new("grok-gw");
    home.write_state_json(&gateway_state("grok"));

    let rendered =
        resolve_launch_route_auth(home.path(), "grok", &HarnessPlanResolver).expect("render");
    assert_eq!(
        rendered.set.get("GROK_MODELS_BASE_URL").unwrap(),
        "https://llm.proliferate.ai/v1"
    );
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), VK);
    assert!(rendered.set.get("HOME").unwrap().contains("grok-home-42"));
}

#[test]
fn grok_api_key_sets_exactly_its_var() {
    let home = TempHome::new("grok-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "grok",
            vec![api_key_source("XAI_API_KEY", "xai-raw")],
        )],
    ));
    let rendered =
        resolve_launch_route_auth(home.path(), "grok", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), "xai-raw");
    assert!(!rendered.set.contains_key("HOME"));
}

// --- native / missing / malformed ------------------------------------------

#[test]
fn absent_harness_renders_native_delta() {
    // codex configured (sequence bumped) must NOT block claude, which the user
    // never configured — claude renders an empty (native) delta.
    let home = TempHome::new("absent-native");
    home.write_state_json(&gateway_state("codex")); // no claude entry

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
}

/// A present-but-empty entry refuses the launch through the FULL render path,
/// not just at the pure profile layer — the launcher must never receive an empty
/// delta it would interpret as native.
///
/// This test previously asserted an empty (native) delta, which pinned the
/// silent-degradation bug: the user selected the gateway, the renderer could not
/// satisfy it, and the launch proceeded on their personal credentials.
#[test]
fn empty_sources_refuse_the_launch_instead_of_rendering_native() {
    let home = TempHome::new("empty-sources");
    home.write_state_json(&v2_state(4, vec![harness("claude", vec![])]));

    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver)
        .expect_err("a dead selection must refuse the launch");

    assert!(matches!(
        &error,
        RouteAuthError::SelectionMissing { harness_kind, sequence: 4, .. } if harness_kind == "claude"
    ));
    // Nothing was materialized on the way to the refusal.
    assert!(!home.path().join("agent-auth/claude-config").exists());
}

#[test]
fn missing_state_file_is_native_empty_delta() {
    let home = TempHome::new("missing");
    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
}

#[test]
fn native_codex_inherits_its_own_home_without_materialization() {
    let home = TempHome::new("native-codex");
    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");

    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
    assert!(!home.path().join("agent-auth").exists());
}

#[test]
fn malformed_state_file_is_typed_error() {
    let home = TempHome::new("broken");
    home.write_state_raw(b"{{{ not json");
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver)
        .expect_err("malformed");
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_MALFORMED");
}

#[test]
fn v1_state_file_is_rejected_as_malformed() {
    let home = TempHome::new("v1");
    home.write_state_raw(
        br#"{ "sequence": 3, "selections": [ { "harness": "claude", "route": "native" } ] }"#,
    );
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver)
        .expect_err("v1 malformed");
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_MALFORMED");
}

#[test]
fn unknown_source_kind_is_typed_error() {
    let home = TempHome::new("unknown-kind");
    home.write_state_json(&v2_state(
        1,
        vec![harness("claude", vec![json!({ "kind": "bogus" })])],
    ));
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver)
        .expect_err("unknown kind");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

// --- two-phase purity ------------------------------------------------------

#[test]
fn render_is_pure_and_apply_writes_0600_files() {
    // render_profile must touch NO disk: it emits FileSpecs carrying the exact
    // bytes, and the sequence-keyed dir does not exist until the launcher
    // applies them.
    let home = TempHome::new("two-phase");
    home.write_state_json(&gateway_state("codex"));
    let state = load_state_file(home.path()).expect("load").expect("state");
    let profile = resolve_profile(Some(&state), "codex").expect("resolve");
    // Route rendering consumes only the explicit plan (empty for Codex).
    let plan = HarnessPlanResolver.resolve_gateway_models("codex", 0);
    let rendered = render_profile(&profile, "codex", &plan, home.path()).expect("render");

    // The FileSpec carries the config.toml bytes; render wrote nothing.
    assert_eq!(rendered.files.len(), 1);
    let contents = rendered.files[0].contents.as_ref().expect("contents");
    let config = std::str::from_utf8(contents).unwrap();
    assert!(config.contains("model_provider = \"proliferate\""));
    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert!(
        !std::path::Path::new(codex_home).exists(),
        "render must be pure — the isolated dir must not exist before apply"
    );

    // The launcher entry point applies the specs, writing the config file 0600
    // with the exact bytes the render produced.
    let applied =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("apply");
    let config_file =
        std::path::Path::new(applied.set.get("CODEX_HOME").unwrap()).join("config.toml");
    assert!(config_file.is_file());
    assert_eq!(std::fs::read(&config_file).unwrap(), *contents);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&config_file)
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

// --- sequence-keyed materialization + cleanup ------------------------------

#[test]
fn codex_home_keeps_immediately_previous_and_gcs_older_sequence_dirs() {
    let home = TempHome::new("codex-rev");

    let render_rev = |rev: i64| {
        home.write_state_json(&v2_state(
            rev,
            vec![harness("codex", vec![gateway_source()])],
        ));
        std::path::PathBuf::from(
            resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver)
                .expect("render")
                .set
                .get("CODEX_HOME")
                .unwrap(),
        )
    };

    let dir1 = render_rev(1);
    assert!(dir1.exists());

    // Sequence 2 — the immediately-previous dir (rev 1) MUST be kept, because a
    // session launched under rev 1 may still be running on it.
    let dir2 = render_rev(2);
    assert!(dir2.exists());
    assert_ne!(dir1, dir2);
    assert!(
        dir1.exists(),
        "immediately-previous codex-home-1 must be kept for in-flight rev-1 sessions"
    );

    // Sequence 3 — now rev 1 is older than the immediately-previous (rev 2) and
    // is GC'd; rev 2 (immediately-previous) is kept.
    let dir3 = render_rev(3);
    assert!(dir3.exists());
    assert!(
        dir2.exists(),
        "immediately-previous codex-home-2 must be kept"
    );
    assert!(
        !dir1.exists(),
        "stale codex-home-1 should be removed at rev 3"
    );
}

// --- unknown harness --------------------------------------------------------

#[test]
fn unknown_harness_in_state_is_typed_error() {
    // A gateway source under a harness kind AgentKind cannot parse — the gateway
    // recipe needs a known harness, so render rejects it.
    let home = TempHome::new("unknown-harness");
    home.write_state_json(&v2_state(1, vec![harness("bogus", vec![gateway_source()])]));
    let state = load_state_file(home.path()).expect("load").expect("state");
    let profile = resolve_profile(Some(&state), "bogus").expect("resolve");
    let error = render_profile(&profile, "bogus", &GatewayModelPlan::default(), home.path())
        .expect_err("unknown");
    assert_eq!(error.code(), "AGENT_ROUTE_UNKNOWN_HARNESS");
}

#[test]
fn state_file_path_snapshot() {
    let path = state_file_path(std::path::Path::new("/home/u/.proliferate/anyharness"));
    assert_eq!(
        path,
        std::path::PathBuf::from("/home/u/.proliferate/anyharness/agent-auth/state.json")
    );
}

#[path = "seat_render_tests.rs"]
mod seat_render;

#[path = "cursor_render_tests.rs"]
mod cursor_render;

#[path = "contract_fixture_tests.rs"]
mod contract_fixture;

#[path = "opencode_render_tests.rs"]
mod opencode_render;

#[path = "provider_config_render_tests.rs"]
mod provider_config_render;
