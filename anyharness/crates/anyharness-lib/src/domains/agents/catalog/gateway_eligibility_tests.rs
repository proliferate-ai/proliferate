//! Catalog eligibility on a gateway-only route (Task 02). Split from
//! `service_tests.rs` to stay under the 600-line source cap.

use std::sync::Arc;

use super::service::{ActiveCatalog, SelectionUnsupported};
use super::sync::CatalogSyncService;
use crate::domains::agents::auth::context::ActiveAuthContexts;
use crate::domains::agents::catalog::service::AgentCatalogService;

fn contexts(ids: &[&str]) -> ActiveAuthContexts {
    ActiveAuthContexts::test_from_ids(ids.iter().copied())
}

fn model_ids(models: Vec<&super::schema::AgentCatalogModel>) -> Vec<&str> {
    models.into_iter().map(|model| model.id.as_str()).collect()
}

#[test]
fn gateway_context_gates_native_ids_and_offers_only_gateway_models() {
    // The catalog half of the `model=default` fix (issue evidence): on a
    // gateway-only route the active auth context is `gateway`, so the native
    // selectors (`default`/`sonnet`/`opus`/`haiku`) and the Bedrock ids MUST be
    // gated — LiteLLM cannot serve `default` and 400s — while the menu and the
    // no-request default resolve to the concrete gateway model ids the gateway
    // actually serves. Run against the SHIPPED bundled catalog (the exact
    // document the live bug manifested against), not the probe draft.
    let sync = Arc::new(CatalogSyncService::from_bundled());
    let catalog = AgentCatalogService::new(sync).active_catalog();

    // Every native selector + a Bedrock id is gated under a pure gateway route.
    for ineligible in [
        "default",
        "sonnet",
        "opus",
        "haiku",
        "us.anthropic.claude-sonnet-4-6",
    ] {
        let gated = catalog
            .validate_launch("claude", &contexts(&["gateway"]), Some(ineligible), None)
            .unwrap_err();
        assert!(
            matches!(gated, SelectionUnsupported::ModelGated { .. }),
            "{ineligible:?} must be gated under a gateway route, got {gated:?}"
        );
    }

    // A concrete gateway model id launches.
    let ok = catalog
        .validate_launch(
            "claude",
            &contexts(&["gateway"]),
            Some("claude-haiku-4-5"),
            None,
        )
        .expect("a gateway model id must launch under a gateway route");
    assert_eq!(ok.model_id.as_deref(), Some("claude-haiku-4-5"));

    // The menu is gateway model ids only — never a bare selector or a Bedrock
    // (`us.anthropic.*`) id (both would 400 at LiteLLM).
    let menu = model_ids(catalog.visible_models("claude", &contexts(&["gateway"])));
    assert!(!menu.is_empty(), "gateway menu must not be empty");
    for id in &menu {
        assert!(
            id.starts_with("claude-") && !id.contains(".anthropic."),
            "gateway menu must be concrete gateway ids only, saw {id:?}"
        );
    }

    // No requested model resolves to the curated gateway default, not a native
    // selector — this is the exact `model=default` failure path, now correct.
    let claude_default = catalog
        .validate_launch("claude", &contexts(&["gateway"]), None, None)
        .expect("claude gateway default resolves");
    assert_eq!(
        claude_default.model_id.as_deref(),
        Some("claude-sonnet-4-5")
    );

    // Codex, same story: the curated gateway default is chosen, not a native id.
    let codex_default = catalog
        .validate_launch("codex", &contexts(&["gateway"]), None, None)
        .expect("codex gateway default resolves");
    assert_eq!(codex_default.model_id.as_deref(), Some("gpt-5.2"));
}
