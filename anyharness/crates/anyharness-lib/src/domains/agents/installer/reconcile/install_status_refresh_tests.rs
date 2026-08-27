//! A reconcile-driven install must compose the harness's FIRST status document.
//!
//! The HTTP install door composes one synchronously before it responds; the
//! reconcile executor — the path boot and `POST /v1/agents/reconcile` installs
//! take — only POKED the probe engine, and the poke is refused outright for a
//! manual-refresh-only harness (cursor). So a cursor installed by reconcile had
//! NO status row until the next restart's startup pass: `/status`, `/methods`
//! and `AgentSummary.authStatus` all answered empty ("Waiting for status").
//!
//! Nested inside `execution_tests.rs` (like the surface-threading suite) so the
//! service/registry/`RuntimeSurface` imports arrive through `use super::*`.
//!
//! Hermetic — no network. Cursor's agent_process pin is an `Archive` source,
//! and `install_agent_process_from_pin` returns `Ok(None)` when a valid managed
//! launcher already exists and no reinstall was forced; the manifest is seeded
//! with the bundled catalog's own pinned version so the drift planner sees
//! convergence rather than forcing a download. That yields `AlreadyInstalled`,
//! whose terminal phase is `Completed` — the SAME branch a fresh `Installed`
//! takes, i.e. exactly the refresh gate under test (and itself a real product
//! shape: a boot pass over an installed-but-rowless cursor).

use super::*;
use crate::domains::agents::catalog::service::AgentCatalogService;
use crate::domains::agents::catalog::sync::CatalogSyncService;
use crate::domains::agents::installer::manifest::{record_entries, role_name, ManifestArtifact};
use crate::domains::agents::launch_probe::test_support::FixedTargets;
use crate::domains::agents::route_auth::test_support::TempHome;
use crate::domains::agents::status::AgentStatusService;
use crate::persistence::Db;

#[tokio::test]
async fn a_reconcile_driven_install_composes_a_first_status_document() {
    let home = TempHome::new("reconcile-install-status");
    // An applied document with a cursor api_key source, so the composed row
    // carries a method to assert on rather than an empty shell.
    home.write_state_json(&serde_json::json!({
        "version": 2,
        "sequence": 1,
        "harnesses": [
            { "harness_kind": "cursor", "sources": [
                { "kind": "api_key", "env_var_name": "CURSOR_API_KEY", "value": "cur-raw" }] },
        ],
    }));

    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()));
    let registry: Vec<AgentDescriptor> = crate::domains::agents::registry::built_in_registry()
        .into_iter()
        .filter(|descriptor| descriptor.kind == AgentKind::Cursor)
        .collect();
    assert_eq!(registry.len(), 1, "cursor descriptor exists");
    seed_converged_cursor(home.path(), &catalog);

    let status = Arc::new(AgentStatusService::with_parts(
        Db::open(home.path()).expect("open db"),
        home.path().to_path_buf(),
        Arc::new(FixedTargets {
            harnesses: vec!["cursor".to_string()],
            installed: vec!["cursor".to_string()],
            // The harness whose install poke is REFUSED — the exact shape the
            // regression hid behind.
            manual_refresh_only: vec!["cursor".to_string()],
        }),
        vec!["cursor".to_string()],
        home.path().join("detection-home"),
    ));
    assert!(
        status.read("cursor").is_none(),
        "no row before the reconcile"
    );

    let service = AgentReconcileService::new();
    service
        .start_with_admission(
            registry,
            home.path().to_path_buf(),
            false,
            // Full scope, Local surface: cursor is admitted unconditionally.
            false,
            Vec::new(),
            None,
            Some(catalog),
            // No probe engine — cursor's poke would be refused anyway; the
            // status service alone must produce the row.
            None,
            Some(status.clone()),
            RuntimeSurface::Local,
            AgentReconcileAdmission::ReuseCompatible,
        )
        .await
        .expect("start cursor reconcile");

    let completed = timeout(Duration::from_secs(10), async {
        loop {
            let snapshot = service.snapshot().await;
            if matches!(
                snapshot.status,
                AgentReconcileJobStatus::Completed | AgentReconcileJobStatus::Failed
            ) {
                return snapshot;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a seeded, converged cursor reconcile must terminate offline");
    assert_eq!(
        completed
            .results
            .iter()
            .map(|result| (result.kind.as_str(), result.outcome.clone()))
            .collect::<Vec<_>>(),
        vec![("cursor", AgentReconcileOutcome::AlreadyInstalled)],
        "the seeded launcher must converge without a download (messages: {:?})",
        completed
            .results
            .iter()
            .map(|result| result.message.as_deref())
            .collect::<Vec<_>>()
    );

    // The refresh runs on the blocking pool and is never awaited by the job
    // (reconcile completion must not wait on a status write), so observe it
    // with a bounded poll rather than asserting immediately.
    let doc = timeout(Duration::from_secs(5), async {
        loop {
            if let Some(doc) = status.read("cursor") {
                return doc;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a reconcile-driven install must compose the FIRST status document, GET-able with no restart");
    assert_eq!(doc.harness_kind, "cursor");
    let api_key = doc
        .methods
        .iter()
        .find(|row| row.kind == "api_key")
        .expect("the applied api_key source composes a method row");
    assert_eq!(api_key.available, Some(true));
    assert_eq!(
        doc.applied.expect("applied method").kind,
        "api_key",
        "the row is the real composition, not a placeholder"
    );
}

/// Lay down a cursor managed install the pass sees as CONVERGED with the
/// bundled catalog: a valid launcher at the managed path (the `Archive` pin's
/// idempotence check) and a manifest recording the catalog's own pinned
/// version (so `plan_artifact` reports no drift and forces no reinstall).
fn seed_converged_cursor(runtime_home: &std::path::Path, catalog: &AgentCatalogService) {
    let launcher = runtime_home
        .join("agents")
        .join("cursor")
        .join("agent_process")
        .join("cursor-launcher");
    std::fs::create_dir_all(launcher.parent().expect("launcher parent"))
        .expect("create managed dir");
    std::fs::write(&launcher, "#!/bin/sh\nexit 0\n").expect("write launcher");
    crate::integrations::agent_cli::executable::make_executable(&launcher)
        .expect("make launcher executable");
    let pinned_version = catalog
        .pin_overrides("cursor")
        .and_then(|pins| pins.agent_process)
        .expect("bundled cursor agent_process pin");
    record_entries(
        runtime_home,
        "cursor",
        vec![ManifestArtifact {
            role: role_name(&ArtifactRole::AgentProcess).to_string(),
            version: Some(pinned_version),
            sha256: None,
            source: "pinned_archive".to_string(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            path: launcher.display().to_string(),
        }],
    )
    .expect("seed install manifest");
}
