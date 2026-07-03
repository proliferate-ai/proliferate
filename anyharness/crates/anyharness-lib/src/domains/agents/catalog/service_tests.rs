//! Catalog read-surface tests against the real probe draft
//! (`scripts/agent-catalog/catalog.draft.json`) — the same fixture the
//! schema/loader tests pin.

use std::sync::Arc;

use super::loader::parse_agent_catalog_json;
use super::schema::draft_catalog_json;
use super::service::{ActiveCatalog, ResolvedSelection, SelectionUnsupported};
use super::sync::CatalogSyncService;
use crate::domains::agents::auth::context::ActiveAuthContexts;
use crate::domains::agents::catalog::service::AgentCatalogService;

fn draft_catalog() -> ActiveCatalog {
    let document = parse_agent_catalog_json(draft_catalog_json()).expect("draft must load");
    ActiveCatalog::new(Arc::new(document))
}

fn contexts(ids: &[&str]) -> ActiveAuthContexts {
    ActiveAuthContexts::test_from_ids(ids.iter().copied())
}

fn model_ids(models: Vec<&super::schema::AgentCatalogModel>) -> Vec<&str> {
    models.into_iter().map(|model| model.id.as_str()).collect()
}

#[test]
fn service_reads_the_bundled_catalog_at_boot() {
    let sync = Arc::new(CatalogSyncService::from_bundled());
    let service = AgentCatalogService::new(sync.clone());
    assert!(service.active_catalog().agent("claude").is_some());
}

#[test]
fn bundled_catalog_declares_goal_support_for_claude_and_codex_only() {
    let sync = Arc::new(CatalogSyncService::from_bundled());
    let catalog = AgentCatalogService::new(sync).active_catalog();

    assert!(catalog.supports_goals("claude"));
    assert!(catalog.supports_goals("codex"));
    for kind in ["gemini", "cursor", "opencode", "grok", "unknown"] {
        assert!(!catalog.supports_goals(kind), "kind={kind}");
    }
}

#[test]
fn pins_surface_catalog_harness_versions() {
    let catalog = draft_catalog();

    let claude = catalog.pins("claude").expect("claude pins");
    assert_eq!(claude.agent_process.version, "0.44.0");
    assert_eq!(
        claude.native.as_ref().map(|pin| pin.version.as_str()),
        Some("2.1.181")
    );

    // Cursor has no native pin; unknown kinds have no pins at all.
    assert!(catalog
        .pins("cursor")
        .expect("cursor pins")
        .native
        .is_none());
    assert!(catalog.pins("not-an-agent").is_none());
}

#[test]
fn bundled_catalog_is_a_complete_lockfile() {
    use super::schema::{AgentCatalogArtifactPin, AgentCatalogArtifactSource};

    let sync = Arc::new(CatalogSyncService::from_bundled());
    let catalog = AgentCatalogService::new(sync).active_catalog();

    let check = |kind: &str, role: &str, pin: &AgentCatalogArtifactPin| {
        let source = pin
            .source
            .as_ref()
            .unwrap_or_else(|| panic!("{kind} {role} pin must carry a resolved source (lockfile)"));
        if let AgentCatalogArtifactSource::Binary { targets }
        | AgentCatalogArtifactSource::Archive { targets, .. } = source
        {
            // Every shipped platform must be pinned — otherwise install only
            // hard-fails at runtime (NoPinForPlatform) on that platform.
            for shipped in ["macos_arm64", "macos_x64", "linux_x64"] {
                assert!(
                    targets.contains_key(shipped),
                    "{kind} {role} is missing a pin for shipped platform {shipped}"
                );
            }
            for (platform, target) in targets {
                assert_eq!(
                    target.sha256.len(),
                    64,
                    "{kind} {role} {platform} sha256 must be a full hash"
                );
            }
        }
    };

    for agent in catalog.agents() {
        check(&agent.kind, "agentProcess", &agent.harness.agent_process);
        if let Some(native) = &agent.harness.native {
            check(&agent.kind, "native", native);
        }
    }
}

#[test]
fn models_intersect_availability_with_active_contexts() {
    let catalog = draft_catalog();

    assert_eq!(
        model_ids(catalog.models("claude", &contexts(&["anthropic-api"]))),
        vec![
            "default",
            "opus[1m]",
            "sonnet",
            "sonnet[1m]",
            "haiku",
            "opus",
            "claude-fable-5",
            "claude-opus-4-8"
        ]
    );
    assert_eq!(
        model_ids(catalog.models("claude", &contexts(&["anthropic-oauth"]))),
        vec![
            "default",
            "sonnet",
            "haiku",
            "opus",
            "claude-fable-5",
            "claude-opus-4-8"
        ]
    );
    // No matching context, no models; unknown kind, no models.
    assert!(catalog
        .models("claude", &contexts(&["baseline"]))
        .is_empty());
    assert!(catalog
        .models("not-an-agent", &contexts(&["anthropic-api"]))
        .is_empty());
}

#[test]
fn baseline_counts_as_a_context_when_active() {
    let catalog = draft_catalog();

    let baseline_models = model_ids(catalog.models("opencode", &contexts(&["baseline"])));
    assert_eq!(
        baseline_models,
        vec![
            "opencode/big-pickle",
            "opencode/deepseek-v4-flash-free",
            "opencode/mimo-v2.5-free",
            "opencode/nemotron-3-ultra-free",
            "opencode/north-mini-code-free"
        ]
    );
}

#[test]
fn visible_models_are_the_default_visible_subset_of_available() {
    let catalog = draft_catalog();

    // claude-opus-4-8 is available under oauth (trial-proven) but not
    // defaultVisible: in models(), out of visible_models(). Fable 5 is the
    // counter-case — trial-proven AND curation-advertised.
    let available = model_ids(catalog.models("claude", &contexts(&["anthropic-oauth"])));
    assert!(available.contains(&"claude-opus-4-8"));
    assert_eq!(
        model_ids(catalog.visible_models("claude", &contexts(&["anthropic-oauth"]))),
        vec!["default", "sonnet", "haiku", "opus", "claude-fable-5"]
    );
}

#[test]
fn controls_return_the_per_model_matrix() {
    let catalog = draft_catalog();

    let opus = catalog.controls("claude", "opus").expect("opus controls");
    assert_eq!(
        opus.get("effort").expect("effort control").values,
        vec!["default", "low", "medium", "high", "xhigh", "max"]
    );
    assert!(opus.contains_key("mode"));
    assert!(catalog.controls("claude", "not-a-model").is_none());
}

#[test]
fn validate_launch_accepts_an_available_model_and_mode() {
    let catalog = draft_catalog();

    let selection = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-oauth"]),
            Some("opus"),
            Some("plan"),
        )
        .expect("opus is available under oauth");

    assert_eq!(
        selection,
        ResolvedSelection {
            model_id: Some("opus".into()),
            launch_model_id: Some("opus".into()),
            mode_id: Some("plan".into()),
        }
    );
}

#[test]
fn validate_launch_availability_beats_visibility() {
    let catalog = draft_catalog();

    // claude-opus-4-8 is NOT defaultVisible but IS available under oauth:
    // launchable-but-unadvertised must be accepted.
    let selection = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-oauth"]),
            Some("claude-opus-4-8"),
            None,
        )
        .expect("unadvertised but available model must launch");

    assert_eq!(selection.model_id.as_deref(), Some("claude-opus-4-8"));
}

#[test]
fn validate_launch_rejects_gated_and_unknown_models() {
    let catalog = draft_catalog();

    // sonnet[1m] is api-only: gated under oauth, with the unlock condition.
    let gated = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-oauth"]),
            Some("sonnet[1m]"),
            None,
        )
        .expect_err("api-only model must be gated under oauth");
    assert_eq!(
        gated,
        SelectionUnsupported::ModelGated {
            model_id: "sonnet[1m]".into(),
            required_contexts: vec!["anthropic-api".into()],
        }
    );

    let unknown = catalog
        .validate_launch("claude", &contexts(&["anthropic-api"]), Some("nope"), None)
        .expect_err("unknown model must be rejected");
    assert_eq!(
        unknown,
        SelectionUnsupported::UnknownModel {
            model_id: "nope".into()
        }
    );

    let unknown_agent = catalog
        .validate_launch("not-an-agent", &contexts(&["baseline"]), None, None)
        .expect_err("unknown agent must be rejected");
    assert_eq!(
        unknown_agent,
        SelectionUnsupported::UnknownAgent {
            agent_kind: "not-an-agent".into()
        }
    );
}

#[test]
fn validate_launch_defaults_to_the_first_visible_available_model() {
    // Strip the curated defaults: this test pins the FALLBACK rung
    // (first visible available in document order). The curated-default
    // rung is pinned by validate_launch_honors_curation_defaults below.
    let mut raw: serde_json::Value =
        serde_json::from_str(draft_catalog_json()).expect("draft must parse");
    raw["agents"][0]["session"]["defaults"] = serde_json::json!({});
    let document = parse_agent_catalog_json(&serde_json::to_string(&raw).expect("serialize"))
        .expect("doctored draft must load");
    let catalog = ActiveCatalog::new(Arc::new(document));

    let selection = catalog
        .validate_launch("claude", &contexts(&["anthropic-oauth"]), None, None)
        .expect("default resolution never hard-fails");
    assert_eq!(selection.model_id.as_deref(), Some("default"));
    assert_eq!(selection.launch_model_id.as_deref(), Some("default"));

    // No model available at all (claude has no baseline-available models):
    // selection stays empty — the harness default applies, never a block.
    let empty = catalog
        .validate_launch("claude", &contexts(&["baseline"]), None, None)
        .expect("no-availability default must not fail");
    assert_eq!(empty.model_id, None);
    assert_eq!(empty.launch_model_id, None);
}

#[test]
fn validate_launch_honors_curation_defaults_per_context() {
    let mut raw: serde_json::Value =
        serde_json::from_str(draft_catalog_json()).expect("draft must parse");
    raw["agents"][0]["session"]["defaults"] = serde_json::json!({ "anthropic-oauth": "opus" });
    let document = parse_agent_catalog_json(&serde_json::to_string(&raw).expect("serialize"))
        .expect("doctored draft must load");
    let catalog = ActiveCatalog::new(Arc::new(document));

    let selection = catalog
        .validate_launch("claude", &contexts(&["anthropic-oauth"]), None, None)
        .expect("curation default resolves");
    assert_eq!(selection.model_id.as_deref(), Some("opus"));
}

#[test]
fn validate_launch_resolves_probe_observed_variant_ids() {
    let catalog = draft_catalog();

    // The fully-qualified bracket id is a probe-observed variant id of
    // cursor's claude-fable-5: resolution matches it against the model's
    // recorded variantIds and preserves it as the launch id.
    let selection = catalog
        .validate_launch(
            "cursor",
            &contexts(&["cursor-login"]),
            Some("claude-fable-5[thinking=true,context=300k,effort=high]"),
            None,
        )
        .expect("observed variant id must resolve");
    assert_eq!(selection.model_id.as_deref(), Some("claude-fable-5"));
    assert_eq!(
        selection.launch_model_id.as_deref(),
        Some("claude-fable-5[thinking=true,context=300k,effort=high]")
    );
}

#[test]
fn validate_launch_composes_variants_by_declared_syntax() {
    let catalog = draft_catalog();

    // Not in the probe's variantIds list, but composable via bracket-params
    // from claude-fable-5's own controls (thinking: ["true"]).
    let composed = catalog
        .validate_launch(
            "cursor",
            &contexts(&["cursor-login"]),
            Some("claude-fable-5[thinking=true]"),
            None,
        )
        .expect("syntax-composed variant must resolve");
    assert_eq!(composed.model_id.as_deref(), Some("claude-fable-5"));
    assert_eq!(
        composed.launch_model_id.as_deref(),
        Some("claude-fable-5[thinking=true]")
    );

    // A value the base model does not support never composes.
    let unsupported = catalog
        .validate_launch(
            "cursor",
            &contexts(&["cursor-login"]),
            Some("claude-fable-5[thinking=false]"),
            None,
        )
        .expect_err("unsupported control value must not compose");
    assert!(matches!(
        unsupported,
        SelectionUnsupported::UnknownModel { .. }
    ));

    // slash-effort composition validates effort against the base model.
    // No probed agent currently declares slash-effort (codex's fresh probe
    // dropped its variant syntax), so declare it on codex's model control to
    // exercise the composition path: gpt-5.4 carries reasoning_effort
    // ["low","medium","high","xhigh"], so "/medium" composes.
    let mut raw: serde_json::Value =
        serde_json::from_str(draft_catalog_json()).expect("draft must parse");
    raw["agents"][1]["session"]["controls"]
        .as_array_mut()
        .expect("codex controls")
        .iter_mut()
        .find(|control| control["key"] == "model")
        .expect("codex model control")["mapping"]["variantSyntax"] =
        serde_json::json!("slash-effort");
    let slash_document = parse_agent_catalog_json(&serde_json::to_string(&raw).expect("serialize"))
        .expect("doctored draft must load");
    let slash_catalog = ActiveCatalog::new(Arc::new(slash_document));
    let slash = slash_catalog
        .validate_launch(
            "codex",
            &contexts(&["openai-oauth"]),
            Some("gpt-5.4/medium"),
            None,
        )
        .expect("slash-effort variant must resolve");
    assert_eq!(slash.model_id.as_deref(), Some("gpt-5.4"));
    assert_eq!(slash.launch_model_id.as_deref(), Some("gpt-5.4/medium"));

    // claude declares no variantSyntax: composition never applies.
    let no_syntax = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-api"]),
            Some("sonnet/high"),
            None,
        )
        .expect_err("no variantSyntax, no composition");
    assert!(matches!(
        no_syntax,
        SelectionUnsupported::UnknownModel { .. }
    ));
}

#[test]
fn validate_launch_checks_mode_against_the_model_matrix() {
    let catalog = draft_catalog();

    let rejected = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-api"]),
            Some("sonnet"),
            Some("yolo"),
        )
        .expect_err("yolo is not a claude mode");
    assert_eq!(
        rejected,
        SelectionUnsupported::UnsupportedMode {
            mode_id: "yolo".into()
        }
    );

    // Mode is optional: None passes through untouched.
    let none_mode = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-api"]),
            Some("sonnet"),
            None,
        )
        .expect("no mode requested");
    assert_eq!(none_mode.mode_id, None);
}

#[test]
fn validate_launch_rejects_mode_selection_without_mode_vocabulary() {
    // Strip codex's mode controls (model-level and agent-level): with no
    // vocabulary in the document, no mode selection is accepted — the
    // catalog is the only mode authority.
    let mut raw: serde_json::Value =
        serde_json::from_str(draft_catalog_json()).expect("draft must parse");
    let codex = &mut raw["agents"][1];
    let controls = codex["session"]["controls"]
        .as_array_mut()
        .expect("controls array");
    controls.retain(|control| control["key"] != "mode");
    for model in codex["session"]["models"]
        .as_array_mut()
        .expect("models array")
    {
        model["controls"]
            .as_object_mut()
            .expect("model controls")
            .remove("mode");
    }
    let document = parse_agent_catalog_json(&serde_json::to_string(&raw).expect("serialize"))
        .expect("doctored draft must load");
    let catalog = ActiveCatalog::new(Arc::new(document));

    let rejected = catalog
        .validate_launch(
            "codex",
            &contexts(&["openai-api"]),
            Some("gpt-5.5"),
            Some("full-access"),
        )
        .expect_err("mode selection without vocabulary must be rejected");
    assert_eq!(
        rejected,
        SelectionUnsupported::UnsupportedMode {
            mode_id: "full-access".into()
        }
    );

    let none_mode = catalog
        .validate_launch("codex", &contexts(&["openai-api"]), Some("gpt-5.5"), None)
        .expect("no mode selection is always fine");
    assert_eq!(none_mode.mode_id, None);
}
