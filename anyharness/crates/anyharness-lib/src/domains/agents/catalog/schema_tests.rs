//! Unit tests for the agent catalog schema (split from schema.rs to keep
//! the module under the repo line-count ceiling).

use super::*;

fn parse_draft() -> AgentCatalogDocument {
    serde_json::from_str(draft_catalog_json()).expect("draft catalog must parse")
}

#[test]
fn draft_catalog_parses_with_expected_shape() {
    let catalog = parse_draft();

    assert_eq!(catalog.schema_version, 2);
    assert_eq!(catalog.default_agent_kind.as_deref(), Some("claude"));
    assert_eq!(catalog.catalog_version, draft_catalog_version().as_str());
    let probed_against = catalog.probed_against.as_ref().expect("probedAgainst");
    assert_eq!(
        probed_against.registry_version.as_deref(),
        Some(bundled_registry_version().as_str())
    );
    assert_eq!(catalog.agents.len(), 5);

    let claude = &catalog.agents[0];
    assert_eq!(claude.kind, "claude");
    assert_eq!(claude.harness.agent_process.version, "0.44.0");
    assert_eq!(
        claude
            .harness
            .native
            .as_ref()
            .map(|pin| pin.version.as_str()),
        Some("2.1.181")
    );
    assert_eq!(
        claude
            .auth_contexts
            .iter()
            .map(|context| context.id.as_str())
            .collect::<Vec<_>>(),
        vec!["bedrock", "anthropic-api", "anthropic-oauth", "gateway"]
    );
    // The gateway context is route-engaged: it references the registry gateway
    // slot and carries a `route` signal so the classifier activates it on a
    // workspace-derived `Route` fact.
    let gateway_context = claude
        .auth_contexts
        .iter()
        .find(|context| context.id == "gateway")
        .expect("claude gateway auth context");
    assert_eq!(gateway_context.auth_slot_id.as_deref(), Some("gateway"));
    assert_eq!(
        gateway_context.signals,
        Some(AgentCatalogAuthSignal::Route("gateway".to_string()))
    );
    // gatewayPolicy carries the small-fast role pin that used to be a Rust const.
    let policy = claude
        .session
        .gateway_policy
        .as_ref()
        .expect("claude gatewayPolicy");
    assert_eq!(policy.providers, vec!["anthropic"]);
    assert_eq!(
        policy.roles.get("small_fast").map(String::as_str),
        Some("claude-haiku-4-5-20251001")
    );
    let first = &claude.session.models[0];
    assert_eq!(first.id, "default");
    // Bare ids are never Bedrock-servable (Bedrock takes only us.anthropic.*
    // inference-profile ids), so `default` is api/oauth only — a Bedrock-routed
    // account gets the us.anthropic.* rows, never this bare id.
    assert_eq!(
        first.availability.any_of,
        vec!["anthropic-api", "anthropic-oauth"]
    );
    assert!(first.default_visible);
    let effort = first.controls.get("effort").expect("effort control");
    assert_eq!(
        effort.values,
        vec!["default", "low", "medium", "high", "xhigh", "max"]
    );
    assert_eq!(effort.observed_value.as_deref(), Some("default"));
    assert_eq!(effort.default, None);

    let codex = &catalog.agents[1];
    let model_control = codex
        .session
        .controls
        .iter()
        .find(|control| control.key == "model")
        .expect("model control");
    let mapping = model_control.mapping.as_ref().expect("model mapping");
    assert_eq!(mapping.switch_via.as_deref(), Some("configOption"));
    assert_eq!(mapping.variant_syntax.as_deref(), None);

    let cursor = &catalog.agents[2];
    assert!(cursor.provenance.attestation.is_none());
    assert!(cursor.harness.native.is_none());
    // Cursor is the variant-carrying agent: its model control declares the
    // bracket-params syntax and its models carry probe-observed variant ids.
    let cursor_model_control = cursor
        .session
        .controls
        .iter()
        .find(|control| control.key == "model")
        .expect("cursor model control");
    let cursor_mapping = cursor_model_control
        .mapping
        .as_ref()
        .expect("cursor model mapping");
    assert_eq!(
        cursor_mapping.variant_syntax.as_deref(),
        Some("bracket-params")
    );
    // Variant families are draft data — anchor on the stable shape, not a
    // fixed model id (the probed model list moves between catalog runs).
    let with_variants = cursor
        .session
        .models
        .iter()
        .find(|model| {
            model
                .provenance
                .as_ref()
                .is_some_and(|provenance| !provenance.variant_ids.is_empty())
        })
        .expect("some cursor model carries variant ids");
    let provenance = with_variants.provenance.as_ref().expect("provenance");
    assert!(provenance
        .variant_ids
        .iter()
        .any(|variant| variant.starts_with(&format!("{}[", with_variants.id))));

    let opencode = &catalog.agents[4];
    assert!(opencode
        .auth_contexts
        .iter()
        .any(|context| context.id == "baseline" && context.auth_slot_id.is_none()));
    assert_eq!(
        opencode
            .session
            .observed_defaults
            .get("baseline")
            .map(String::as_str),
        Some("opencode/big-pickle")
    );
}

#[test]
fn auth_signals_round_trip_bedrock_all_of_example() {
    // The signal algebra supports a flag-plus-discovery `allOf` signature even
    // though the bundled Bedrock context currently routes on the flag alone.
    let json = serde_json::json!({
        "allOf": [
            { "envFlag": "CLAUDE_CODE_USE_BEDROCK=1" },
            { "discovery": "aws-credential-chain" }
        ]
    });

    let signal: AgentCatalogAuthSignal =
        serde_json::from_value(json.clone()).expect("bedrock signal must parse");

    assert_eq!(
        signal,
        AgentCatalogAuthSignal::AllOf(vec![
            AgentCatalogAuthSignal::EnvFlag("CLAUDE_CODE_USE_BEDROCK=1".to_string()),
            AgentCatalogAuthSignal::Discovery("aws-credential-chain".to_string()),
        ])
    );
    assert_eq!(signal.depth(), 2);
    assert_eq!(serde_json::to_value(&signal).expect("serialize"), json);
}

#[test]
fn auth_signals_round_trip_any_of_and_leaves() {
    let json = serde_json::json!({
        "anyOf": [
            { "env": "CLAUDE_CODE_OAUTH_TOKEN" },
            { "discovery": "claude-oauth-creds" }
        ]
    });

    let signal: AgentCatalogAuthSignal =
        serde_json::from_value(json.clone()).expect("oauth signal must parse");

    assert_eq!(signal.depth(), 2);
    assert_eq!(serde_json::to_value(&signal).expect("serialize"), json);

    let leaf: AgentCatalogAuthSignal =
        serde_json::from_value(serde_json::json!({ "env": "ANTHROPIC_API_KEY" }))
            .expect("leaf signal must parse");
    assert_eq!(
        leaf,
        AgentCatalogAuthSignal::Env("ANTHROPIC_API_KEY".to_string())
    );
    assert_eq!(leaf.depth(), 1);
}

#[test]
fn auth_signal_route_operator_round_trips() {
    let json = serde_json::json!({ "route": "gateway" });
    let signal: AgentCatalogAuthSignal =
        serde_json::from_value(json.clone()).expect("route signal must parse");
    assert_eq!(signal, AgentCatalogAuthSignal::Route("gateway".to_string()));
    assert_eq!(signal.depth(), 1);
    assert_eq!(serde_json::to_value(&signal).expect("serialize"), json);
}

fn bundled_registry_version() -> String {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../catalogs/agents/registry.json"
    ))
    .expect("read bundled registry");
    serde_json::from_str::<serde_json::Value>(&text).expect("parse registry")["registryVersion"]
        .as_str()
        .expect("registryVersion")
        .to_string()
}

fn draft_catalog_version() -> String {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../scripts/agent-catalog/catalog.draft.json"
    ))
    .expect("read draft catalog");
    serde_json::from_str::<serde_json::Value>(&text).expect("parse draft")["catalogVersion"]
        .as_str()
        .expect("catalogVersion")
        .to_string()
}
