//! Adapter render snapshots + native/malformed-file behavior + two-phase
//! purity. Exercises the full loader→profile→render→apply path against a real
//! filesystem (the unit-level live gate for the render plane).

use serde_json::{json, Value};

use super::plan::{GatewayModelPlan, GatewayModelResolve};
use super::render::render_profile;
use super::state::state_file_path;
use super::test_support::TempHome;
use super::{load_state_file, resolve_launch_route_auth, resolve_profile};

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

/// opencode's catalog `gatewayPolicy.seedModels` — the pre-probe fallback list
/// the resolver returns when no live probe row exists (mirrors the values now
/// living in `catalogs/agents/catalog.json`, not a Rust const).
const OPENCODE_SEED_MODELS: &[&str] = &[
    "claude-sonnet-4-5",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20251001",
];

/// Stub resolver mirroring the catalog's gateway curation for the harnesses the
/// render snapshots exercise: claude's small-fast pin, codex's default model,
/// opencode's seed model list. Keeps the byte-snapshot literals flowing through
/// a [`GatewayModelPlan`] exactly as the real catalog resolver would.
struct HarnessPlanResolver;

impl GatewayModelResolve for HarnessPlanResolver {
    fn resolve_gateway_models(&self, harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        match harness_kind {
            "claude" => GatewayModelPlan {
                small_fast_model: Some("claude-haiku-4-5-20251001".to_string()),
                ..Default::default()
            },
            "codex" => GatewayModelPlan {
                default_model: Some("claude-sonnet-4-5-20250929".to_string()),
                ..Default::default()
            },
            "opencode" => GatewayModelPlan {
                models: OPENCODE_SEED_MODELS.iter().map(|m| m.to_string()).collect(),
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
    fn resolve_gateway_models(&self, _harness_kind: &str, _revision: i64) -> GatewayModelPlan {
        self.0.clone()
    }
}

fn v2_state(revision: i64, harnesses: Vec<Value>) -> Value {
    json!({
        "version": 2,
        "revision": revision,
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

/// A single-gateway state for `harness` at revision 42 (keeps the
/// `*-home-42` dir-name assertions stable).
fn gateway_state(kind: &str) -> Value {
    v2_state(42, vec![harness(kind, vec![gateway_source()])])
}

// --- claude ----------------------------------------------------------------

#[test]
fn claude_gateway_sets_base_url_token_and_sanitizes_ambient() {
    let home = TempHome::new("claude-gw");
    home.write_state_json(&gateway_state("claude"));

    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("ANTHROPIC_BASE_URL").unwrap(),
        GATEWAY_BASE_URL
    );
    assert_eq!(rendered.set.get("ANTHROPIC_AUTH_TOKEN").unwrap(), VK);
    assert_eq!(
        rendered.set.get("ANTHROPIC_SMALL_FAST_MODEL").unwrap(),
        "claude-haiku-4-5-20251001"
    );
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

#[test]
fn claude_api_key_sets_exactly_its_var() {
    // An api_key source is fully generic: it sets EXACTLY the requested env var
    // and nothing else — no config-dir, no ambient sanitization (contract §4).
    let home = TempHome::new("claude-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![api_key_source("ANTHROPIC_API_KEY", "sk-raw")],
        )],
    ));

    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("ANTHROPIC_API_KEY").unwrap(), "sk-raw");
    assert_eq!(rendered.set.len(), 1);
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
}

#[test]
fn claude_gateway_sanitize_only_strips_vars_it_did_not_set() {
    // The sanitize keys off which vars this render set: base-url + auth-token are
    // set → kept; ANTHROPIC_API_KEY is not set → removed.
    let home = TempHome::new("claude-sanitize");
    home.write_state_json(&gateway_state("claude"));
    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
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

    let rendered = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");

    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert!(codex_home.contains("codex-home-42"));
    assert_eq!(rendered.set.get("PROLIFERATE_GATEWAY_KEY").unwrap(), VK);
    assert!(rendered.remove.contains(&"OPENAI_API_KEY".to_string()));
    assert!(rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));

    let config = std::fs::read_to_string(std::path::Path::new(codex_home).join("config.toml"))
        .expect("read config.toml");
    assert!(config.contains("model_provider = \"proliferate\""));
    // Explicit default model line: codex otherwise falls back to a codex-native
    // model id the gateway cannot serve (HARNESS-MATRIX codex recipe).
    assert!(
        config.contains("model = \"claude-sonnet-4-5-20250929\""),
        "config.toml must pin a gateway-served default model, got:\n{config}"
    );
    assert!(config.contains("base_url = \"https://llm.proliferate.ai/v1\""));
    assert!(config.contains("env_key = \"PROLIFERATE_GATEWAY_KEY\""));
    assert!(config.contains("wire_api = \"responses\""));
}

#[test]
fn codex_api_key_sets_var_and_writes_codex_local_auth() {
    let home = TempHome::new("codex-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness("codex", vec![api_key_source("OPENAI_API_KEY", "sk-openai")])],
    ));

    let rendered = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("OPENAI_API_KEY").unwrap(), "sk-openai");
    // The api_key route does NOT repoint CODEX_HOME (it stays the session-layer
    // codex-local home) and removes nothing.
    assert!(!rendered.set.contains_key("CODEX_HOME"));
    assert!(rendered.remove.is_empty());
    // But it MUST also write codex-local/auth.json so a route-authed resume
    // (session/load) can authenticate — the bare OPENAI_API_KEY env is ignored
    // on that path. This is the credential half of migrated-codex-session
    // portability.
    assert_eq!(rendered.files.len(), 1);
    let auth_path = home
        .path()
        .join("agent-auth")
        .join("codex-local")
        .join("auth.json");
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&auth_path).expect("read codex auth.json"))
            .expect("codex auth.json is valid json");
    assert_eq!(written["OPENAI_API_KEY"], "sk-openai");
}

// --- opencode --------------------------------------------------------------

#[test]
fn opencode_gateway_writes_config_with_static_models() {
    let home = TempHome::new("opencode-gw");
    home.write_state_json(&gateway_state("opencode"));

    let rendered = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");
    let config_path = rendered
        .set
        .get("OPENCODE_CONFIG")
        .expect("OPENCODE_CONFIG");
    assert_eq!(rendered.set.get("PROLIFERATE_GATEWAY_KEY").unwrap(), VK);

    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).expect("read config")).expect("json");
    let provider = &config["provider"]["proliferate"];
    assert_eq!(provider["npm"], "@ai-sdk/openai-compatible");
    assert_eq!(
        provider["options"]["baseURL"],
        "https://llm.proliferate.ai/v1"
    );
    assert_eq!(
        provider["options"]["apiKey"],
        "{env:PROLIFERATE_GATEWAY_KEY}"
    );
    // P1 always uses the static fallback model list (catalog lands in P3).
    let models = provider["models"].as_object().unwrap();
    assert!(!models.is_empty());
    assert!(models.contains_key("claude-haiku-4-5-20251001"));

    // The injected config must contain ONLY our provider so opencode's
    // config-layer merge ADDS it to the user's own local providers.
    let top_level: Vec<&String> = config.as_object().unwrap().keys().collect();
    assert_eq!(top_level, vec!["provider"]);
    let providers: Vec<&String> = config["provider"].as_object().unwrap().keys().collect();
    assert_eq!(providers, vec!["proliferate"]);

    // XDG isolation: opencode must not reach the user's global config/auth.
    let xdg_config = rendered
        .set
        .get("XDG_CONFIG_HOME")
        .expect("XDG_CONFIG_HOME");
    let xdg_data = rendered.set.get("XDG_DATA_HOME").expect("XDG_DATA_HOME");
    assert!(std::path::Path::new(xdg_config).is_dir());
    assert!(std::path::Path::new(xdg_data).is_dir());
    assert!(xdg_config.contains("opencode-config"));
    assert!(xdg_data.contains("opencode-config"));
}

#[test]
fn opencode_api_key_sets_exactly_its_var() {
    let home = TempHome::new("opencode-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "opencode",
            vec![api_key_source("ANTHROPIC_API_KEY", "sk-a")],
        )],
    ));
    let rendered = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("ANTHROPIC_API_KEY").unwrap(), "sk-a");
    assert_eq!(rendered.set.len(), 1);
    assert!(!rendered.set.contains_key("OPENCODE_CONFIG"));
    assert!(rendered.files.is_empty());
}

#[test]
fn opencode_gateway_plus_api_keys_merge_into_one_additive_delta() {
    // Gateway + two direct api_key rows (opencode composes them): one injected
    // config for the gateway plus plain env keys for the direct providers, all
    // in a single launch delta with no removals.
    let home = TempHome::new("opencode-multi");
    home.write_state_json(&v2_state(
        11,
        vec![harness(
            "opencode",
            vec![
                gateway_source(),
                api_key_source("ANTHROPIC_API_KEY", "sk-ant-direct"),
                api_key_source("XAI_API_KEY", "xai-direct"),
            ],
        )],
    ));

    let rendered = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");

    // Gateway source: injected config + virtual key env.
    let config_path = rendered
        .set
        .get("OPENCODE_CONFIG")
        .expect("OPENCODE_CONFIG");
    assert_eq!(rendered.set.get("PROLIFERATE_GATEWAY_KEY").unwrap(), VK);
    // Direct api_key sources: additive plain env keys, no removals.
    assert_eq!(
        rendered.set.get("ANTHROPIC_API_KEY").unwrap(),
        "sk-ant-direct"
    );
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), "xai-direct");
    assert!(rendered.remove.is_empty());

    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).expect("read config")).expect("json");
    let providers: Vec<&String> = config["provider"].as_object().unwrap().keys().collect();
    assert_eq!(providers, vec!["proliferate"]);
}

#[test]
fn opencode_api_keys_without_gateway_render_env_only() {
    let home = TempHome::new("opencode-direct-only");
    home.write_state_json(&v2_state(
        2,
        vec![harness(
            "opencode",
            vec![api_key_source("OPENAI_API_KEY", "sk-openai-direct")],
        )],
    ));
    let rendered = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");
    assert_eq!(
        rendered.set.get("OPENAI_API_KEY").unwrap(),
        "sk-openai-direct"
    );
    assert!(!rendered.set.contains_key("OPENCODE_CONFIG"));
    assert!(!rendered.set.contains_key("PROLIFERATE_GATEWAY_KEY"));
}

#[test]
fn opencode_gateway_uses_plan_models_not_state() {
    // The models map comes from the resolved plan (spec §3), not the state
    // source: pin an exact single-model plan and assert it lands in-config.
    let home = TempHome::new("opencode-plan-models");
    home.write_state_json(&gateway_state("opencode"));
    let resolver = FixedResolver(GatewayModelPlan {
        models: vec!["claude-haiku-4-5-20251001".to_string()],
        ..Default::default()
    });
    let rendered =
        resolve_launch_route_auth(home.path(), "opencode", &resolver).expect("render");
    let config_path = rendered
        .set
        .get("OPENCODE_CONFIG")
        .expect("OPENCODE_CONFIG");
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).expect("read config")).expect("json");
    let models = config["provider"]["proliferate"]["models"]
        .as_object()
        .unwrap();
    assert_eq!(models.len(), 1);
    assert!(models.contains_key("claude-haiku-4-5-20251001"));
}

#[test]
fn opencode_gateway_errors_when_plan_has_no_models() {
    // An empty plan (no seed, no probe) is a launch-blocking error (spec §3):
    // opencode cannot render a config with an empty provider models map.
    let home = TempHome::new("opencode-empty-plan");
    home.write_state_json(&gateway_state("opencode"));
    let resolver = FixedResolver(GatewayModelPlan::default());
    let error =
        resolve_launch_route_auth(home.path(), "opencode", &resolver).expect_err("empty models");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_INCOMPLETE");
}

#[test]
fn codex_gateway_errors_when_plan_has_no_default_model() {
    // Codex refuses to launch without a model; an empty plan must fail the
    // launch rather than write a config codex rejects (spec §3).
    let home = TempHome::new("codex-empty-plan");
    home.write_state_json(&gateway_state("codex"));
    let resolver = FixedResolver(GatewayModelPlan::default());
    let error =
        resolve_launch_route_auth(home.path(), "codex", &resolver).expect_err("no default model");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_INCOMPLETE");
}

// --- grok ------------------------------------------------------------------

#[test]
fn grok_gateway_sets_models_base_url_and_isolated_home() {
    let home = TempHome::new("grok-gw");
    home.write_state_json(&gateway_state("grok"));

    let rendered = resolve_launch_route_auth(home.path(), "grok", &HarnessPlanResolver).expect("render");
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
        vec![harness("grok", vec![api_key_source("XAI_API_KEY", "xai-raw")])],
    ));
    let rendered = resolve_launch_route_auth(home.path(), "grok", &HarnessPlanResolver).expect("render");
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), "xai-raw");
    assert!(!rendered.set.contains_key("HOME"));
}

// --- native / missing / malformed ------------------------------------------

#[test]
fn absent_harness_renders_native_delta() {
    // codex configured (revision bumped) must NOT block claude, which the user
    // never configured — claude renders an empty (native) delta.
    let home = TempHome::new("absent-native");
    home.write_state_json(&gateway_state("codex")); // no claude entry

    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
    assert!(rendered.files.is_empty());
}

#[test]
fn empty_sources_render_native_delta() {
    let home = TempHome::new("empty-sources");
    home.write_state_json(&v2_state(4, vec![harness("claude", vec![])]));
    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
}

#[test]
fn missing_state_file_is_native_empty_delta() {
    let home = TempHome::new("missing");
    let rendered = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
}

#[test]
fn malformed_state_file_is_typed_error() {
    let home = TempHome::new("broken");
    home.write_state_raw(b"{{{ not json");
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect_err("malformed");
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_MALFORMED");
}

#[test]
fn v1_state_file_is_rejected_as_malformed() {
    let home = TempHome::new("v1");
    home.write_state_raw(
        br#"{ "revision": 3, "selections": [ { "harness": "claude", "route": "native" } ] }"#,
    );
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect_err("v1 malformed");
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_MALFORMED");
}

#[test]
fn unknown_source_kind_is_typed_error() {
    let home = TempHome::new("unknown-kind");
    home.write_state_json(&v2_state(
        1,
        vec![harness("claude", vec![json!({ "kind": "bogus" })])],
    ));
    let error = resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect_err("unknown kind");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

// --- two-phase purity ------------------------------------------------------

#[test]
fn render_is_pure_and_apply_writes_0600_files() {
    // render_profile must touch NO disk: it emits FileSpecs carrying the exact
    // bytes, and the revision-keyed dir does not exist until the launcher
    // applies them.
    let home = TempHome::new("two-phase");
    home.write_state_json(&gateway_state("codex"));
    let state = load_state_file(home.path()).expect("load").expect("state");
    let profile = resolve_profile(Some(&state), "codex").expect("resolve");
    // Pass the codex plan (default model) directly — render consumes only the plan.
    let plan = HarnessPlanResolver.resolve_gateway_models("codex", 0);
    let rendered = render_profile(&profile, &plan, home.path()).expect("render");

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
    let applied = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("apply");
    let config_file = std::path::Path::new(applied.set.get("CODEX_HOME").unwrap())
        .join("config.toml");
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

// --- revision-keyed materialization + cleanup ------------------------------

#[test]
fn codex_home_keeps_immediately_previous_and_gcs_older_revision_dirs() {
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

    // Revision 2 — the immediately-previous dir (rev 1) MUST be kept, because a
    // session launched under rev 1 may still be running on it.
    let dir2 = render_rev(2);
    assert!(dir2.exists());
    assert_ne!(dir1, dir2);
    assert!(
        dir1.exists(),
        "immediately-previous codex-home-1 must be kept for in-flight rev-1 sessions"
    );

    // Revision 3 — now rev 1 is older than the immediately-previous (rev 2) and
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
    home.write_state_json(&v2_state(
        1,
        vec![harness("bogus", vec![gateway_source()])],
    ));
    let state = load_state_file(home.path()).expect("load").expect("state");
    let profile = resolve_profile(Some(&state), "bogus").expect("resolve");
    let error = render_profile(&profile, &GatewayModelPlan::default(), home.path())
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
