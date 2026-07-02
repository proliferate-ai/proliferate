//! Adapter render snapshots + fail-closed + missing/malformed-file behavior.
//! Exercises the full loader→profile→render→spawn-env path against a real
//! filesystem (this is the PR 6 live-gate at unit level, per the brief).

use serde_json::json;

use super::render::render_profile;
use super::state::{state_file_path, AgentAuthState, AuthRoute};
use super::test_support::TempHome;
use super::{resolve_launch_route_auth, resolve_profile, RouteAuthError};

const GATEWAY_BASE_URL: &str = "https://llm.proliferate.ai";
const VK: &str = "sk-virtual-1234";

fn gateway_state(harness: &str, catalog: Option<Vec<&str>>) -> serde_json::Value {
    let mut selection = json!({
        "harness": harness,
        "route": "gateway",
        "base_url": GATEWAY_BASE_URL,
        "key": VK,
    });
    if let Some(models) = catalog {
        selection["model_catalog"] = json!(models);
    }
    json!({ "revision": 42, "user_id": "user-1", "selections": [selection] })
}

// --- claude ----------------------------------------------------------------

#[test]
fn claude_gateway_sets_base_url_token_and_sanitizes_ambient() {
    let home = TempHome::new("claude-gw");
    home.write_state_json(&gateway_state("claude", None));

    let rendered = resolve_launch_route_auth(home.path(), "claude").expect("render");

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
    // Ambient Bedrock/Vertex + stale api key removed (spec §13.3).
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
fn claude_api_key_sets_key_and_removes_reroute_flags_only() {
    let home = TempHome::new("claude-key");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "claude", "route": "api_key", "provider": "anthropic", "key": "sk-raw" } ]
    }));

    let rendered = resolve_launch_route_auth(home.path(), "claude").expect("render");
    assert_eq!(rendered.set.get("ANTHROPIC_API_KEY").unwrap(), "sk-raw");
    // Isolated CLAUDE_CONFIG_DIR on the api_key route too.
    assert!(rendered
        .set
        .get("CLAUDE_CONFIG_DIR")
        .expect("CLAUDE_CONFIG_DIR")
        .contains("claude-config"));
    // Bedrock/Vertex reroute flags still removed, but NOT the key we just set.
    assert!(rendered
        .remove
        .contains(&"CLAUDE_CODE_USE_BEDROCK".to_string()));
    assert!(!rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));
    // Ambient gateway-style creds must be removed so they cannot shadow the key.
    assert!(
        rendered
            .remove
            .contains(&"ANTHROPIC_AUTH_TOKEN".to_string()),
        "api_key route must strip ambient ANTHROPIC_AUTH_TOKEN"
    );
    assert!(
        rendered.remove.contains(&"ANTHROPIC_BASE_URL".to_string()),
        "api_key route must strip ambient ANTHROPIC_BASE_URL"
    );
}

// --- codex -----------------------------------------------------------------

#[test]
fn codex_gateway_materializes_config_toml_and_sets_env() {
    let home = TempHome::new("codex-gw");
    home.write_state_json(&gateway_state("codex", None));

    let rendered = resolve_launch_route_auth(home.path(), "codex").expect("render");

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
fn codex_api_key_openai_sets_only_openai_key() {
    let home = TempHome::new("codex-key");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "codex", "route": "api_key", "provider": "openai", "key": "sk-openai" } ]
    }));

    let rendered = resolve_launch_route_auth(home.path(), "codex").expect("render");
    assert_eq!(rendered.set.get("OPENAI_API_KEY").unwrap(), "sk-openai");
    assert!(!rendered.set.contains_key("CODEX_HOME"));
    assert!(rendered.remove.is_empty());
}

#[test]
fn codex_api_key_anthropic_is_rejected_out_of_scope() {
    let home = TempHome::new("codex-key-anthropic");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "codex", "route": "api_key", "provider": "anthropic", "key": "sk-a" } ]
    }));

    let error = resolve_launch_route_auth(home.path(), "codex").expect_err("rejected");
    assert!(matches!(error, RouteAuthError::UnsupportedRoute { .. }));
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

// --- opencode --------------------------------------------------------------

#[test]
fn opencode_gateway_writes_config_with_explicit_models() {
    let home = TempHome::new("opencode-gw");
    home.write_state_json(&gateway_state(
        "opencode",
        Some(vec!["claude-haiku-4-5-20251001"]),
    ));

    let rendered = resolve_launch_route_auth(home.path(), "opencode").expect("render");
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
    assert!(provider["models"]
        .as_object()
        .unwrap()
        .contains_key("claude-haiku-4-5-20251001"));

    // XDG isolation: opencode must not reach the user's global config/auth.
    let xdg_config = rendered
        .set
        .get("XDG_CONFIG_HOME")
        .expect("XDG_CONFIG_HOME");
    let xdg_data = rendered.set.get("XDG_DATA_HOME").expect("XDG_DATA_HOME");
    assert!(std::path::Path::new(xdg_config).is_dir());
    assert!(std::path::Path::new(xdg_data).is_dir());
    // They live beside the materialized config, inside the isolated route-auth root.
    assert!(xdg_config.contains("opencode-config"));
    assert!(xdg_data.contains("opencode-config"));
}

#[test]
fn opencode_gateway_falls_back_to_static_models_without_catalog() {
    let home = TempHome::new("opencode-fallback");
    home.write_state_json(&gateway_state("opencode", None));

    let rendered = resolve_launch_route_auth(home.path(), "opencode").expect("render");
    let config_path = rendered
        .set
        .get("OPENCODE_CONFIG")
        .expect("OPENCODE_CONFIG");
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).expect("read config")).expect("json");
    let models = config["provider"]["proliferate"]["models"]
        .as_object()
        .unwrap();
    assert!(
        !models.is_empty(),
        "fallback models must be non-empty (PR 7 catalog dependency)"
    );
    assert!(models.contains_key("claude-haiku-4-5-20251001"));
}

#[test]
fn opencode_api_key_passthrough_provider_env() {
    let home = TempHome::new("opencode-key");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "opencode", "route": "api_key", "provider": "anthropic", "key": "sk-a" } ]
    }));
    let rendered = resolve_launch_route_auth(home.path(), "opencode").expect("render");
    assert_eq!(rendered.set.get("ANTHROPIC_API_KEY").unwrap(), "sk-a");
}

#[test]
fn opencode_multi_slot_state_merges_into_one_additive_delta() {
    // Gateway slot + two direct provider slots (spec §3.3): one injected
    // config for the gateway plus plain env keys for the direct providers,
    // all in a single launch delta.
    let home = TempHome::new("opencode-multi-slot");
    home.write_state_json(&json!({
        "revision": 11,
        "user_id": "user-1",
        "selections": [
            { "harness": "opencode", "route": "gateway", "slot": "gateway",
              "base_url": GATEWAY_BASE_URL, "key": VK,
              "model_catalog": ["claude-haiku-4-5-20251001"] },
            { "harness": "opencode", "route": "api_key", "slot": "anthropic",
              "provider": "anthropic", "key": "sk-ant-direct" },
            { "harness": "opencode", "route": "api_key", "slot": "xai",
              "provider": "xai", "key": "xai-direct" }
        ]
    }));

    let rendered = resolve_launch_route_auth(home.path(), "opencode").expect("render");

    // Gateway slot: injected config + virtual key env.
    let config_path = rendered
        .set
        .get("OPENCODE_CONFIG")
        .expect("OPENCODE_CONFIG");
    assert_eq!(rendered.set.get("PROLIFERATE_GATEWAY_KEY").unwrap(), VK);
    // Direct provider slots: additive plain env keys, no removals.
    assert_eq!(
        rendered.set.get("ANTHROPIC_API_KEY").unwrap(),
        "sk-ant-direct"
    );
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), "xai-direct");
    assert!(rendered.remove.is_empty());

    // The injected config must contain ONLY our provider — no top-level
    // model/default keys and no other providers — so opencode's config-layer
    // merge ADDS it to the user's own local providers instead of replacing
    // them (verified against opencode 1.16.2).
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(config_path).expect("read config")).expect("json");
    let top_level: Vec<&String> = config.as_object().unwrap().keys().collect();
    assert_eq!(top_level, vec!["provider"]);
    let providers: Vec<&String> = config["provider"].as_object().unwrap().keys().collect();
    assert_eq!(providers, vec!["proliferate"]);
}

#[test]
fn opencode_provider_slots_without_gateway_render_env_only() {
    let home = TempHome::new("opencode-direct-only");
    home.write_state_json(&json!({
        "revision": 2,
        "selections": [
            { "harness": "opencode", "route": "api_key", "slot": "openai",
              "provider": "openai", "key": "sk-openai-direct" }
        ]
    }));
    let rendered = resolve_launch_route_auth(home.path(), "opencode").expect("render");
    assert_eq!(
        rendered.set.get("OPENAI_API_KEY").unwrap(),
        "sk-openai-direct"
    );
    assert!(!rendered.set.contains_key("OPENCODE_CONFIG"));
    assert!(!rendered.set.contains_key("PROLIFERATE_GATEWAY_KEY"));
}

#[test]
fn single_source_harness_with_multiple_entries_errors_end_to_end() {
    let home = TempHome::new("claude-multi-entry");
    home.write_state_json(&json!({
        "revision": 5,
        "selections": [
            { "harness": "claude", "route": "gateway", "slot": "primary",
              "base_url": GATEWAY_BASE_URL, "key": VK },
            { "harness": "claude", "route": "api_key", "slot": "anthropic",
              "provider": "anthropic", "key": "sk-raw" }
        ]
    }));
    let error = resolve_launch_route_auth(home.path(), "claude").expect_err("conflict");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_CONFLICT");
    assert!(matches!(error, RouteAuthError::SelectionConflict { .. }));
}

// --- grok ------------------------------------------------------------------

#[test]
fn grok_gateway_sets_models_base_url_and_isolated_home() {
    let home = TempHome::new("grok-gw");
    home.write_state_json(&gateway_state("grok", None));

    let rendered = resolve_launch_route_auth(home.path(), "grok").expect("render");
    assert_eq!(
        rendered.set.get("GROK_MODELS_BASE_URL").unwrap(),
        "https://llm.proliferate.ai/v1"
    );
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), VK);
    assert!(rendered.set.get("HOME").unwrap().contains("grok-home-42"));
}

#[test]
fn grok_api_key_sets_only_xai_key() {
    let home = TempHome::new("grok-key");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "grok", "route": "api_key", "key": "xai-raw" } ]
    }));
    let rendered = resolve_launch_route_auth(home.path(), "grok").expect("render");
    assert_eq!(rendered.set.get("XAI_API_KEY").unwrap(), "xai-raw");
    assert!(!rendered.set.contains_key("HOME"));
}

// --- gemini ----------------------------------------------------------------

#[test]
fn gemini_gateway_uses_root_base_url_and_writes_settings() {
    let home = TempHome::new("gemini-gw");
    home.write_state_json(&gateway_state("gemini", None));

    let rendered = resolve_launch_route_auth(home.path(), "gemini").expect("render");
    // ROOT base url, NO /gemini prefix, NO trailing /v1beta (CLI appends it).
    assert_eq!(
        rendered.set.get("GOOGLE_GEMINI_BASE_URL").unwrap(),
        GATEWAY_BASE_URL
    );
    assert_eq!(rendered.set.get("GEMINI_API_KEY").unwrap(), VK);
    assert_eq!(
        rendered.set.get("GEMINI_CLI_TRUST_WORKSPACE").unwrap(),
        "true"
    );
    let gemini_home = rendered.set.get("HOME").expect("HOME");
    assert!(gemini_home.contains("gemini-home-42"));

    let settings: serde_json::Value = serde_json::from_slice(
        &std::fs::read(std::path::Path::new(gemini_home).join(".gemini/settings.json"))
            .expect("read settings"),
    )
    .expect("json");
    assert_eq!(
        settings["security"]["auth"]["selectedType"],
        "gemini-api-key"
    );
}

#[test]
fn gemini_api_key_sets_only_gemini_key() {
    let home = TempHome::new("gemini-key");
    home.write_state_json(&json!({
        "revision": 1,
        "selections": [ { "harness": "gemini", "route": "api_key", "key": "g-raw" } ]
    }));
    let rendered = resolve_launch_route_auth(home.path(), "gemini").expect("render");
    assert_eq!(rendered.set.get("GEMINI_API_KEY").unwrap(), "g-raw");
    assert!(!rendered.set.contains_key("HOME"));
}

// --- fail-closed / missing / malformed / native ----------------------------

#[test]
fn scoped_state_without_selection_fails_closed_with_code() {
    let home = TempHome::new("fail-closed");
    home.write_state_json(&gateway_state("codex", None)); // no claude selection

    let error = resolve_launch_route_auth(home.path(), "claude").expect_err("fail-closed");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_MISSING");
    assert!(matches!(error, RouteAuthError::SelectionMissing { .. }));
}

#[test]
fn missing_state_file_is_legacy_empty_delta() {
    let home = TempHome::new("legacy");
    let rendered = resolve_launch_route_auth(home.path(), "claude").expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
}

#[test]
fn malformed_state_file_is_typed_error() {
    let home = TempHome::new("broken");
    home.write_state_raw(b"{{{ not json");
    let error = resolve_launch_route_auth(home.path(), "claude").expect_err("malformed");
    assert_eq!(error.code(), "AGENT_ROUTE_STATE_MALFORMED");
}

#[test]
fn native_selection_renders_empty_delta() {
    let home = TempHome::new("native");
    home.write_state_json(&json!({
        "revision": 3,
        "selections": [ { "harness": "claude", "route": "native" } ]
    }));
    let rendered = resolve_launch_route_auth(home.path(), "claude").expect("render");
    assert!(rendered.set.is_empty());
    assert!(rendered.remove.is_empty());
}

// --- revision-keyed materialization + cleanup ------------------------------

#[test]
fn codex_home_keeps_immediately_previous_and_gcs_older_revision_dirs() {
    let home = TempHome::new("codex-rev");

    let render_rev = |rev: i64| {
        home.write_state_json(&json!({
            "revision": rev,
            "selections": [ { "harness": "codex", "route": "gateway", "base_url": GATEWAY_BASE_URL, "key": VK } ]
        }));
        std::path::PathBuf::from(
            resolve_launch_route_auth(home.path(), "codex")
                .expect("render")
                .set
                .get("CODEX_HOME")
                .unwrap(),
        )
    };

    let dir1 = render_rev(1);
    assert!(dir1.exists());

    // Revision 2 — the immediately-previous dir (rev 1) MUST be kept, because a
    // session launched under rev 1 may still be running on it (spec §0).
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
    // A profile carrying a harness kind that AgentKind cannot parse.
    let state = AgentAuthState {
        revision: 1,
        user_id: None,
        selections: vec![super::state::AuthSelection {
            harness: "bogus".into(),
            route: AuthRoute::Gateway,
            slot: "primary".into(),
            provider: None,
            base_url: Some(GATEWAY_BASE_URL.into()),
            key: Some(VK.into()),
            model_catalog: None,
        }],
    };
    let profile = resolve_profile(Some(&state), "bogus").expect("resolve");
    let error = render_profile(&profile, std::path::Path::new("/tmp")).expect_err("unknown");
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
