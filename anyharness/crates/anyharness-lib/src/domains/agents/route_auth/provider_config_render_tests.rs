//! Track D: `provider_config` render arms — "use my own cloud provider
//! account" (Bedrock, Azure OpenAI/Foundry). claude/opencode are fully generic
//! env-set arms; codex×aws_bedrock is a real config.toml injection (built-in
//! `amazon-bedrock` upstream, no `[model_providers.*]` table); codex×azure_openai
//! is built but UNVERIFIED and unreachable while the registry keeps it
//! `pending` (D3 brief §5); cursor/grok/unknown kinds are typed
//! `UnsupportedRoute`.
//!
//! Split from `render_tests.rs` for the line-count ceiling; nested inside it so
//! its `TempHome` and resolver helpers are in scope.

use super::*;

fn provider_config_source(config_kind: &str, env: Vec<(&str, &str)>) -> Value {
    json!({
        "kind": "provider_config",
        "config_kind": config_kind,
        "env": env.into_iter().collect::<std::collections::BTreeMap<_, _>>(),
    })
}

// --- claude ------------------------------------------------------------

#[test]
fn claude_provider_config_aws_bedrock_sets_the_already_resolved_env_map() {
    let home = TempHome::new("claude-pc-bedrock");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![provider_config_source(
                "aws_bedrock",
                vec![
                    ("CLAUDE_CODE_USE_BEDROCK", "1"),
                    ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ("AWS_REGION", "us-east-1"),
                ],
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered
            .set
            .get("CLAUDE_CODE_USE_BEDROCK")
            .map(String::as_str),
        Some("1")
    );
    assert_eq!(
        rendered
            .set
            .get("AWS_BEARER_TOKEN_BEDROCK")
            .map(String::as_str),
        Some("bedrock-raw")
    );
    assert_eq!(
        rendered.set.get("AWS_REGION").map(String::as_str),
        Some("us-east-1")
    );
    assert!(
        rendered.files.is_empty(),
        "no config file for claude's env-only arm"
    );
}

/// THE regression this brief's §3.4 calls out by name: a provider_config
/// claude source's mode-switch flag must survive `sanitize_claude_ambient`,
/// which runs AFTER the source composes. Before this arm existed, sanitize's
/// removal list stripped `CLAUDE_CODE_USE_BEDROCK` unconditionally; the arm
/// must `set()` it BEFORE sanitize runs so sanitize's "keep what I explicitly
/// set" rule preserves it.
#[test]
fn claude_provider_config_bedrock_flag_survives_sanitization() {
    let home = TempHome::new("claude-pc-bedrock-sanitize");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![provider_config_source(
                "aws_bedrock",
                vec![
                    ("CLAUDE_CODE_USE_BEDROCK", "1"),
                    ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ("AWS_REGION", "us-east-1"),
                ],
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    // Set, not removed: sanitize must not strip a flag this route explicitly set.
    assert_eq!(
        rendered
            .set
            .get("CLAUDE_CODE_USE_BEDROCK")
            .map(String::as_str),
        Some("1")
    );
    assert!(
        !rendered
            .remove
            .contains(&"CLAUDE_CODE_USE_BEDROCK".to_string()),
        "the flag this route set must survive sanitize_claude_ambient, got removals {:?}",
        rendered.remove
    );
    assert!(
        !rendered
            .remove
            .contains(&"AWS_BEARER_TOKEN_BEDROCK".to_string()),
        "the credential this route set must survive sanitize_claude_ambient"
    );
    // Sanitize still removes the OTHER rerouting flags/selectors this route did
    // not set (e.g. Foundry, ANTHROPIC_*), proving sanitize still ran.
    assert!(rendered
        .remove
        .contains(&"CLAUDE_CODE_USE_FOUNDRY".to_string()));
    assert!(rendered.remove.contains(&"ANTHROPIC_API_KEY".to_string()));
}

#[test]
fn claude_provider_config_azure_openai_foundry_flag_survives_generically() {
    // Per §2's ruling: the claude arm is fully generic across config_kind — no
    // Rust-side `if config_kind == "azure_openai"` branch. The Foundry flag
    // rides through the same env-set loop as Bedrock's.
    let home = TempHome::new("claude-pc-foundry");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![provider_config_source(
                "azure_openai",
                vec![
                    ("CLAUDE_CODE_USE_FOUNDRY", "1"),
                    ("ANTHROPIC_FOUNDRY_RESOURCE", "my-resource"),
                    (
                        "ANTHROPIC_FOUNDRY_BASE_URL",
                        "https://my-resource.openai.azure.com",
                    ),
                    ("ANTHROPIC_FOUNDRY_API_KEY", "foundry-raw"),
                ],
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered
            .set
            .get("CLAUDE_CODE_USE_FOUNDRY")
            .map(String::as_str),
        Some("1")
    );
    assert!(!rendered
        .remove
        .contains(&"CLAUDE_CODE_USE_FOUNDRY".to_string()));
    assert_eq!(
        rendered
            .set
            .get("ANTHROPIC_FOUNDRY_API_KEY")
            .map(String::as_str),
        Some("foundry-raw")
    );
}

/// The scoping proof for review B1: the exemption belongs to the
/// `provider_config` arm's keys ONLY. Here one claude source is a
/// provider_config setting `CLAUDE_CODE_USE_BEDROCK`, and a second is an
/// `api_key` row whose user-chosen name collides with the OTHER rerouting flag.
/// Bedrock (provider_config-composed) must survive; Foundry (api_key-named) must
/// still be stripped. A `rendered.set`-wide exemption keeps both and fails here.
/// (Render trusts the server's cardinality validation, so this composition is a
/// render-layer probe of the sanitizer's scoping, not a claim about legality.)
#[test]
fn a_claude_api_key_named_like_a_flag_is_stripped_even_beside_a_provider_config_source() {
    let home = TempHome::new("claude-pc-plus-flag-named-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "claude",
            vec![
                provider_config_source(
                    "aws_bedrock",
                    vec![
                        ("CLAUDE_CODE_USE_BEDROCK", "1"),
                        ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ],
                ),
                api_key_source("CLAUDE_CODE_USE_FOUNDRY", "1"),
            ],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert!(
        !rendered
            .remove
            .contains(&"CLAUDE_CODE_USE_BEDROCK".to_string()),
        "the provider_config arm's own flag must survive, got removals {:?}",
        rendered.remove
    );
    assert!(
        rendered
            .remove
            .contains(&"CLAUDE_CODE_USE_FOUNDRY".to_string()),
        "an api_key-named rerouting flag must still be stripped, got removals {:?}",
        rendered.remove
    );
}

// --- opencode ------------------------------------------------------------

#[test]
fn opencode_provider_config_aws_bedrock_sets_the_already_resolved_env_map() {
    let home = TempHome::new("opencode-pc-bedrock");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "opencode",
            vec![provider_config_source(
                "aws_bedrock",
                vec![
                    ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ("AWS_REGION", "us-east-1"),
                ],
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered
            .set
            .get("AWS_BEARER_TOKEN_BEDROCK")
            .map(String::as_str),
        Some("bedrock-raw")
    );
    assert_eq!(
        rendered.set.get("AWS_REGION").map(String::as_str),
        Some("us-east-1")
    );
    assert_eq!(
        rendered.set.len(),
        2,
        "opencode's provider_config arm stays generic"
    );
    assert!(rendered.files.is_empty());
}

#[test]
fn opencode_provider_config_composes_with_a_direct_api_key_source() {
    // opencode legitimately carries several sources at once — a provider_config
    // entry composes additively with a direct api_key row, same as gateway does.
    let home = TempHome::new("opencode-pc-plus-api-key");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "opencode",
            vec![
                api_key_source("ANTHROPIC_API_KEY", "sk-ant-direct"),
                provider_config_source(
                    "aws_bedrock",
                    vec![
                        ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                        ("AWS_REGION", "us-east-1"),
                    ],
                ),
            ],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered.set.get("ANTHROPIC_API_KEY").map(String::as_str),
        Some("sk-ant-direct")
    );
    assert_eq!(
        rendered
            .set
            .get("AWS_BEARER_TOKEN_BEDROCK")
            .map(String::as_str),
        Some("bedrock-raw")
    );
    assert!(rendered.remove.is_empty());
}

// --- codex x aws_bedrock (real, config.toml injection) --------------------

#[test]
fn codex_provider_config_aws_bedrock_materializes_config_toml_and_sets_env() {
    let home = TempHome::new("codex-pc-bedrock");
    home.write_state_json(&v2_state(
        7,
        vec![harness(
            "codex",
            vec![provider_config_source(
                "aws_bedrock",
                vec![
                    ("AWS_BEARER_TOKEN_BEDROCK", "bedrock-raw"),
                    ("AWS_REGION", "us-east-1"),
                ],
            )],
        )],
    ));
    let rendered =
        resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver).expect("render");

    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert!(codex_home.contains("codex-home-7"));
    assert_eq!(
        rendered
            .set
            .get("AWS_BEARER_TOKEN_BEDROCK")
            .map(String::as_str),
        Some("bedrock-raw")
    );
    assert_eq!(
        rendered.set.get("AWS_REGION").map(String::as_str),
        Some("us-east-1")
    );
    let config = std::fs::read_to_string(std::path::Path::new(codex_home).join("config.toml"))
        .expect("read config.toml");
    assert_eq!(
        config, "model_provider = \"amazon-bedrock\"\n",
        "codex's built-in amazon-bedrock upstream needs no [model_providers.*] table"
    );
    assert!(
        !config.contains("model_providers"),
        "the ONE variant that adds a provider without adding a table, got:\n{config}"
    );
}

// --- codex x azure_openai (UNVERIFIED, unit-tested only) -------------------

/// codex×azure_openai is NOT reachable through the full state.json pipeline
/// today (D1 keeps the registry kind `pending`; the server's
/// `supported_provider_config_kinds` excludes it, so no real selection should
/// ever construct this profile). This test exercises the render arm DIRECTLY
/// (bypassing profile resolution) to prove the config.toml injection is
/// correct NOW, so flipping the registry's `pending` flag later (once Gate 4
/// passes) is a one-line change, not a code change.
#[test]
fn codex_provider_config_azure_openai_arm_renders_the_expected_toml_when_invoked_directly() {
    use super::super::profile::ProviderConfigProfile;
    use super::super::profile::{AgentRuntimeAuthProfile, HarnessSources, ResolvedSource};
    use super::super::render::render_profile;

    let home = TempHome::new("codex-pc-azure-direct");
    let profile = AgentRuntimeAuthProfile::Sources(HarnessSources {
        harness_kind: "codex".to_string(),
        revision: 3,
        rotate: true,
        sources: vec![ResolvedSource::ProviderConfig(ProviderConfigProfile {
            config_kind: "azure_openai".to_string(),
            env: [
                ("AZURE_OPENAI_API_KEY".to_string(), "azure-raw".to_string()),
                (
                    "AZURE_OPENAI_ENDPOINT".to_string(),
                    "https://my-resource.openai.azure.com".to_string(),
                ),
                (
                    "AZURE_OPENAI_DEPLOYMENT".to_string(),
                    "gpt-5-deployment".to_string(),
                ),
            ]
            .into_iter()
            .collect(),
        })],
    });

    let rendered = render_profile(&profile, "codex", &GatewayModelPlan::default(), home.path())
        .expect("the azure arm must render even though the registry keeps it pending");

    let codex_home = rendered.set.get("CODEX_HOME").expect("CODEX_HOME");
    assert_eq!(
        rendered.set.get("AZURE_OPENAI_API_KEY").map(String::as_str),
        Some("azure-raw")
    );
    let config_bytes = rendered
        .files
        .iter()
        .find(|spec| spec.path_family == PathFamily::CodexHome)
        .and_then(|spec| spec.contents.clone())
        .expect("codex config.toml FileSpec with contents");
    let config = String::from_utf8(config_bytes).expect("utf8 config.toml");
    assert_eq!(
        config,
        "model_provider = \"azure\"\n\
         model = \"gpt-5-deployment\"\n\
         \n\
         [model_providers.azure]\n\
         name = \"Azure OpenAI\"\n\
         base_url = \"https://my-resource.openai.azure.com\"\n\
         env_key = \"AZURE_OPENAI_API_KEY\"\n\
         wire_api = \"responses\"\n",
        "unexpected codex azure config.toml, got:\n{config}"
    );
    let _ = codex_home; // presence already asserted above via rendered.set
}

#[test]
fn codex_provider_config_azure_openai_missing_endpoint_is_selection_incomplete() {
    use super::super::profile::ProviderConfigProfile;
    use super::super::profile::{AgentRuntimeAuthProfile, HarnessSources, ResolvedSource};
    use super::super::render::render_profile;

    let home = TempHome::new("codex-pc-azure-missing-endpoint");
    let profile = AgentRuntimeAuthProfile::Sources(HarnessSources {
        harness_kind: "codex".to_string(),
        revision: 1,
        rotate: true,
        sources: vec![ResolvedSource::ProviderConfig(ProviderConfigProfile {
            config_kind: "azure_openai".to_string(),
            env: [("AZURE_OPENAI_API_KEY".to_string(), "azure-raw".to_string())]
                .into_iter()
                .collect(),
        })],
    });

    let error = render_profile(&profile, "codex", &GatewayModelPlan::default(), home.path())
        .expect_err("missing endpoint/deployment must be a typed error");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_INCOMPLETE");
}

// --- cursor / grok: no provider-config recipe -------------------------------

#[test]
fn cursor_provider_config_is_a_typed_unsupported_route() {
    let home = TempHome::new("cursor-pc-unsupported");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "cursor",
            vec![provider_config_source(
                "aws_bedrock",
                vec![("AWS_REGION", "us-east-1")],
            )],
        )],
    ));
    let error = resolve_launch_route_auth(home.path(), "cursor", &HarnessPlanResolver)
        .expect_err("cursor has no provider-config recipe");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

#[test]
fn grok_provider_config_is_a_typed_unsupported_route() {
    let home = TempHome::new("grok-pc-unsupported");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "grok",
            vec![provider_config_source(
                "aws_bedrock",
                vec![("AWS_REGION", "us-east-1")],
            )],
        )],
    ));
    let error = resolve_launch_route_auth(home.path(), "grok", &HarnessPlanResolver)
        .expect_err("grok has no provider-config recipe");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

// --- unknown config_kind ----------------------------------------------------

// claude/opencode are deliberately generic across config_kind (the arm has no
// per-kind branch, per §2's wire-contract ruling) — an unknown kind for THEM
// just sets whatever env the map carries; it is codex (which must pick a
// concrete config.toml recipe) where an unrecognized kind is a typed error.
#[test]
fn opencode_unknown_config_kind_still_sets_the_generic_env_map() {
    let home = TempHome::new("opencode-pc-unknown-kind");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "opencode",
            vec![provider_config_source(
                "gcp_vertex",
                vec![("SOME_VAR", "x")],
            )],
        )],
    ));
    let rendered = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver)
        .expect("opencode's provider_config arm is generic across config_kind");
    assert_eq!(rendered.set.get("SOME_VAR").map(String::as_str), Some("x"));
}

#[test]
fn codex_unknown_config_kind_is_a_typed_unsupported_route() {
    let home = TempHome::new("codex-pc-unknown-kind");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "codex",
            vec![provider_config_source(
                "gcp_vertex",
                vec![("SOME_VAR", "x")],
            )],
        )],
    ));
    let error = resolve_launch_route_auth(home.path(), "codex", &HarnessPlanResolver)
        .expect_err("codex has no recipe for an unrecognized provider-config kind");
    assert_eq!(error.code(), "AGENT_ROUTE_UNSUPPORTED");
}

// --- empty env at the FULL render path (not just profile.rs unit tests) ----

#[test]
fn provider_config_with_empty_env_refuses_the_launch() {
    let home = TempHome::new("opencode-pc-empty-env");
    home.write_state_json(&v2_state(
        1,
        vec![harness(
            "opencode",
            vec![provider_config_source("aws_bedrock", vec![])],
        )],
    ));
    let error = resolve_launch_route_auth(home.path(), "opencode", &HarnessPlanResolver)
        .expect_err("empty env must refuse the launch");
    assert_eq!(error.code(), "AGENT_ROUTE_SELECTION_INCOMPLETE");
}

/// The model-selector exemption mirrors the rerouting-flag one: a selector the
/// `provider_config` arm ITSELF composed (a Bedrock route naming its model
/// map) is the route, so sanitization must keep it — while the rest of the
/// family is still stripped.
#[test]
fn a_provider_config_model_selector_survives_while_the_rest_are_stripped() {
    let home = TempHome::new("claude-pc-model-selector");
    home.write_state_json(&v2_state(
        11,
        vec![harness(
            "claude",
            vec![provider_config_source(
                "aws_bedrock",
                vec![
                    ("CLAUDE_CODE_USE_BEDROCK", "1"),
                    ("AWS_REGION", "us-east-1"),
                    (
                        "ANTHROPIC_DEFAULT_SONNET_MODEL",
                        "global.anthropic.claude-sonnet-5",
                    ),
                ],
            )],
        )],
    ));

    let rendered =
        resolve_launch_route_auth(home.path(), "claude", &HarnessPlanResolver).expect("render");

    assert_eq!(
        rendered
            .set
            .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
            .map(String::as_str),
        Some("global.anthropic.claude-sonnet-5"),
        "the arm's own selector is the route"
    );
    assert!(
        !rendered
            .remove
            .contains(&"ANTHROPIC_DEFAULT_SONNET_MODEL".to_string()),
        "sanitization must not strip the selector the provider_config arm set"
    );
    // The rest of the family is still stripped.
    for key in [
        "ANTHROPIC_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_BEDROCK_REGION_PREFIX",
    ] {
        assert!(
            rendered.remove.contains(&key.to_string()),
            "missing removal of {key}"
        );
    }
}
