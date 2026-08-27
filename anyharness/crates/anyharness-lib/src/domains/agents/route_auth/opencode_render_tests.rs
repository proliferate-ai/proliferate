//! opencode's gateway recipe: the isolated XDG config, the generated
//! `opencode.json`, and its additive composition with direct provider keys.
//!
//! Split out of `render_tests.rs` (line-count ceiling) as its own harness
//! section; nested inside it so the shared `TempHome`/resolver helpers are in
//! scope.

use super::*;

#[test]
fn opencode_gateway_writes_config_with_live_models() {
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
    // The resolver supplies the target gateway's exact live model list.
    let models = provider["models"].as_object().unwrap();
    assert!(!models.is_empty());
    assert!(models.contains_key("claude-haiku-4-5-20251001"));

    // The injected config must contain ONLY our provider so opencode's
    // config-layer merge ADDS it to the user's own local providers.
    let top_level: Vec<&String> = config.as_object().unwrap().keys().collect();
    assert_eq!(top_level, vec!["provider"]);
    let providers: Vec<&String> = config["provider"].as_object().unwrap().keys().collect();
    assert_eq!(providers, vec!["proliferate"]);

    // XDG_CONFIG_HOME is isolated (our injected provider config stays
    // sequence-keyed and deterministic). XDG_DATA_HOME is NOT overridden —
    // opencode resolves auth at the real ~/.local/share/opencode/auth.json so
    // natively-logged-in providers coexist with the gateway provider.
    let xdg_config = rendered
        .set
        .get("XDG_CONFIG_HOME")
        .expect("XDG_CONFIG_HOME");
    assert!(std::path::Path::new(xdg_config).is_dir());
    assert!(xdg_config.contains("opencode-config"));
    assert!(
        !rendered.set.contains_key("XDG_DATA_HOME"),
        "XDG_DATA_HOME must NOT be overridden — native auth coexistence"
    );
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
fn codex_gateway_render_does_not_author_a_default_model() {
    // Route materialization owns provider/auth configuration only. Model
    // selection comes from target-observed launch options and the immutable
    // launch intent, so an empty gateway model plan must not author one here.
    let home = TempHome::new("codex-empty-plan");
    home.write_state_json(&gateway_state("codex"));
    let resolver = FixedResolver(GatewayModelPlan::default());
    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &resolver).expect("render auth route");
    let config = rendered
        .files
        .iter()
        .find(|file| file.path_family == PathFamily::CodexHome)
        .and_then(|file| file.contents.as_ref())
        .expect("codex config");
    let config = std::str::from_utf8(config).expect("utf8 config");
    assert!(!config.lines().any(|line| line.starts_with("model = ")));
}
