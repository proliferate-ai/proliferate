//! Unit tests for the agent catalog schema (split from schema.rs to keep
//! the module under the repo line-count ceiling).

use super::*;

fn parse_canonical() -> AgentCatalogDocument {
    serde_json::from_str(canonical_catalog_json()).expect("canonical catalog must parse")
}

#[test]
fn canonical_catalog_parses_with_expected_shape() {
    let catalog = parse_canonical();

    assert_eq!(catalog.schema_version, 2);
    assert_eq!(catalog.catalog_version, canonical_catalog_version().as_str());
    let probed_against = catalog.probed_against.as_ref().expect("probedAgainst");
    assert_eq!(
        probed_against.registry_version.as_deref(),
        Some(bundled_registry_version().as_str())
    );
    assert_eq!(catalog.agents.len(), 5);

    let claude = &catalog.agents[0];
    assert_eq!(claude.kind, "claude");
    assert_eq!(
        claude.harness.agent_process.version,
        "0.66.0-proliferate.2"
    );
    assert_eq!(
        claude
            .harness
            .native
            .as_ref()
            .map(|pin| pin.version.as_str()),
        Some("2.1.234")
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
    let first = &claude.session.presentation_models[0];
    assert_eq!(first.id, "default");

    let cursor = &catalog.agents[2];
    assert!(cursor.provenance.attestation.is_none());
    assert!(cursor.harness.native.is_none());
    assert!(!cursor.session.presentation_models.is_empty());

    let opencode = &catalog.agents[4];
    assert!(opencode
        .auth_contexts
        .iter()
        .any(|context| context.id == "baseline" && context.auth_slot_id.is_none()));
    assert!(!opencode.session.presentation_models.is_empty());
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

fn canonical_catalog_version() -> String {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../catalogs/agents/catalog.json"
    ))
    .expect("read canonical catalog");
    serde_json::from_str::<serde_json::Value>(&text).expect("parse catalog")["catalogVersion"]
        .as_str()
        .expect("catalogVersion")
        .to_string()
}

// --------------------------------------------------------------------------
// registry-authority drift guards (agent-auth.md FR-4)
// --------------------------------------------------------------------------
//
// AgentKind is a type (it stays code), but registry.json is the declared
// allow-list authority. These tests fail the moment the enum and the registry
// disagree on which kinds exist or which are gateway-capable, so the Rust
// render plane's per-kind branching (render.rs) can never silently diverge
// from the document every other plane reads.

use crate::domains::agents::model::AgentKind;
use crate::domains::agents::registry::bundled::bundled_agent_registry_document;

#[test]
fn agent_kind_enum_matches_registry_kinds() {
    let enum_kinds: std::collections::BTreeSet<&str> =
        AgentKind::all().iter().map(|kind| kind.as_str()).collect();
    let registry_kinds: std::collections::BTreeSet<&str> = bundled_agent_registry_document()
        .agents
        .iter()
        .map(|agent| agent.kind.as_str())
        .collect();
    assert_eq!(
        enum_kinds, registry_kinds,
        "AgentKind::all() must equal registry.json agents[].kind exactly"
    );
}

#[test]
fn registry_gateway_capability_matches_render_assumption() {
    // Gateway capability = the registry auth block declares a `gateway` slot.
    let gateway_capable: std::collections::BTreeSet<&str> = bundled_agent_registry_document()
        .agents
        .iter()
        .filter(|agent| agent.auth.slots.iter().any(|slot| slot.id == "gateway"))
        .map(|agent| agent.kind.as_str())
        .collect();

    // render.rs::render_gateway serves claude/codex/opencode/grok and returns
    // UnsupportedRoute for cursor. That runtime assumption is exactly: every
    // kind EXCEPT cursor is gateway-capable.
    let expected: std::collections::BTreeSet<&str> = AgentKind::all()
        .iter()
        .map(|kind| kind.as_str())
        .filter(|kind| *kind != "cursor")
        .collect();

    assert_eq!(
        gateway_capable, expected,
        "registry gateway-slot derivation must match render.rs's gateway/UnsupportedRoute split"
    );
    assert!(
        !gateway_capable.contains("cursor"),
        "cursor must never be gateway-capable (render.rs returns UnsupportedRoute)"
    );
}
