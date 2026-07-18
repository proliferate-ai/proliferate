//! Incident-provenance regressions for catalog-known gated selections.

use std::sync::Arc;

use super::loader::parse_agent_catalog_json;
use super::schema::draft_catalog_json;
use super::service::{ActiveCatalog, SelectionUnsupported};
use crate::domains::agents::auth::context::ActiveAuthContexts;

fn draft_catalog() -> ActiveCatalog {
    let document = parse_agent_catalog_json(draft_catalog_json()).expect("draft must load");
    ActiveCatalog::new(Arc::new(document))
}

fn contexts(ids: &[&str]) -> ActiveAuthContexts {
    ActiveAuthContexts::test_from_ids(ids.iter().copied())
}

#[test]
fn gated_alias_preserves_requested_and_canonical_model_identity() {
    let mut raw: serde_json::Value =
        serde_json::from_str(draft_catalog_json()).expect("draft must parse");
    let claude = raw["agents"]
        .as_array_mut()
        .expect("agents")
        .iter_mut()
        .find(|agent| agent["kind"] == "claude")
        .expect("claude agent");
    let model = claude["session"]["models"]
        .as_array_mut()
        .expect("models")
        .iter_mut()
        .find(|model| model["id"] == "opus[1m]")
        .expect("api-only model");
    model["aliases"] = serde_json::json!(["long-opus"]);
    let document = parse_agent_catalog_json(&serde_json::to_string(&raw).expect("serialize"))
        .expect("catalog with alias must load");
    let expected_version = document.catalog_version.clone();
    let catalog = ActiveCatalog::new(Arc::new(document));

    let gated = catalog
        .validate_launch(
            "claude",
            &contexts(&["anthropic-oauth"]),
            Some("long-opus"),
            None,
        )
        .expect_err("api-only alias must remain gated under oauth");

    assert_eq!(
        gated,
        SelectionUnsupported::ModelGated {
            requested_model_id: "long-opus".into(),
            canonical_model_id: "opus[1m]".into(),
            active_contexts: vec!["anthropic-oauth".into()],
            required_contexts: vec!["anthropic-api".into()],
            catalog_version: expected_version,
        }
    );
}

#[test]
fn gated_variant_preserves_requested_and_canonical_model_identity() {
    let catalog = draft_catalog();
    let requested = "claude-fable-5[thinking=true,context=300k,effort=high]";

    let gated = catalog
        .validate_launch("cursor", &contexts(&[]), Some(requested), None)
        .expect_err("cursor-login variant must be gated without that context");

    assert_eq!(
        gated,
        SelectionUnsupported::ModelGated {
            requested_model_id: requested.to_string(),
            canonical_model_id: "claude-fable-5".to_string(),
            active_contexts: vec![],
            required_contexts: vec!["cursor-login".to_string()],
            catalog_version: catalog.catalog_version().to_string(),
        }
    );
}
