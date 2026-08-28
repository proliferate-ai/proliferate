//! The `surface` argument's journey, end to end: `start_with_admission` →
//! `run_reconcile_job` → `auto_install_decision`.
//!
//! Split from `execution_tests.rs` for the line-count ceiling; nested inside it so
//! the service/registry/`RuntimeSurface` imports are in scope through
//! `use super::*`.
//!
//! Both tests run a full-scope pass to COMPLETION with **no network**: a `None`
//! catalog means no pin resolves, so the installer's `require_source` fence fails
//! every agent deterministically before any download. That is what makes an
//! end-to-end assertion affordable here — the poke test in the parent module
//! deliberately stops at job registration for exactly this reason.

use super::*;

/// The surface threading, exercised END TO END rather than at the seam.
///
/// `start_with_admission` → `run_reconcile_job` → `auto_install_decision` is three
/// hops of plumbing, and the poke test above deliberately stops at job
/// REGISTRATION (completing a full-scope pass against the real catalog would
/// download every harness). So nothing there proves the `surface` argument
/// actually reaches the predicate, nor that a full-scope pass admits agents an
/// installed-only pass would have skipped.
///
/// This runs a full-scope pass to COMPLETION with **no network**, by passing a
/// `None` catalog: every agent then passes the predicate (admitted, not skipped)
/// and fails at the installer's pin fence with a deterministic message. The
/// admitted-then-failed pair is the assertion — it is the shape only a threaded
/// surface plus a full scope can produce, and it is the exact inverse of
/// `installed_only_skips_uninstalled_agents`, which shows the same `None`-catalog
/// setup yielding `Skipped` for every agent.
///
/// A managed launcher is seeded for every agent first, and that is what makes the
/// test hermetic rather than developer-machine-dependent: with a managed artifact
/// present, the drift planner sees every agent as already converged, so the pass
/// is a no-op regardless of what the host happens to have on PATH (post-R2.0 a
/// PATH copy no longer skips — it would trigger an install, which is exactly the
/// host dependency the seeding avoids without touching process-global `PATH`,
/// which other tests in this crate shell out through).
#[tokio::test]
async fn full_scope_pass_admits_every_absent_agent_instead_of_skipping_it() {
    let service = AgentReconcileService::new();
    let home = std::env::temp_dir().join(format!("anyharness-full-scope-{}", Uuid::new_v4()));
    let registry = crate::domains::agents::registry::built_in_registry();
    assert!(!registry.is_empty(), "built-in registry must have agents");
    let registry_kinds: Vec<AgentKind> = registry
        .iter()
        .map(|descriptor| descriptor.kind.clone())
        .collect();
    seed_managed_launchers(&home, &registry_kinds);

    service
        .start_with_admission(
            registry,
            home.clone(),
            false,
            // FULL scope — the startup pass's shape after A6.
            false,
            Vec::new(),
            None,
            // No catalog: no pins resolve, so the installer fences every role
            // before it can reach the network.
            None,
            // Local: cursor is NOT carved out here, so it must be admitted too.
            None,
            // No status service: this asserts the surface predicate only.
            None,
            RuntimeSurface::Local,
            AgentReconcileAdmission::ReuseCompatible,
        )
        .await
        .expect("start full-scope reconcile");

    let completed = timeout(Duration::from_secs(20), async {
        loop {
            let snapshot = service.snapshot().await;
            if snapshot.status == AgentReconcileJobStatus::Completed
                || snapshot.status == AgentReconcileJobStatus::Failed
            {
                return snapshot;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a pin-fenced full-scope pass must terminate without network installs");

    let by_kind: Vec<(&str, AgentReconcileOutcome)> = completed
        .results
        .iter()
        .map(|result| (result.kind.as_str(), result.outcome.clone()))
        .collect();
    assert_eq!(
        completed.results.len(),
        registry_kinds.len(),
        "every registry agent must be reported on: {by_kind:?}"
    );
    for result in &completed.results {
        // ADMITTED: the predicate said "reconcile this", so the pass reached the
        // installer. A `Skipped` here would mean the full-scope pass is still
        // behaving like an installed-only one.
        assert_eq!(
            result.outcome,
            AgentReconcileOutcome::Failed,
            "{} must be admitted by the predicate and then fail at the pin fence, \
             not skipped; got {by_kind:?}",
            result.kind.as_str()
        );
        let message = result
            .message
            .as_deref()
            .unwrap_or_else(|| panic!("{} must carry a failure message", result.kind.as_str()));
        assert!(
            message.contains("has no resolved source pin in the catalog lockfile"),
            "{}'s failure must be the deterministic pin fence (proving the pass got \
             past the predicate and into the installer, offline), got {message:?}",
            result.kind.as_str()
        );
    }

    let _ = std::fs::remove_dir_all(&home);
}

/// The same pass on the CLOUD surface skips exactly one agent — cursor — which is
/// the only observable difference the threaded `surface` makes. Paired with the
/// test above (same inputs, `RuntimeSurface::Local`, cursor admitted), this is a
/// single-variable comparison: only the surface argument differs, so a surface
/// that failed to reach the predicate could not produce both results.
#[tokio::test]
async fn the_cloud_surface_reaches_the_predicate_and_carves_out_only_cursor() {
    let service = AgentReconcileService::new();
    let home = std::env::temp_dir().join(format!("anyharness-cloud-scope-{}", Uuid::new_v4()));
    let registry = crate::domains::agents::registry::built_in_registry();
    let registry_kinds: Vec<AgentKind> = registry
        .iter()
        .map(|descriptor| descriptor.kind.clone())
        .collect();
    seed_managed_launchers(&home, &registry_kinds);

    service
        .start_with_admission(
            crate::domains::agents::registry::built_in_registry(),
            home.clone(),
            false,
            false,
            Vec::new(),
            None,
            None,
            None,
            None,
            RuntimeSurface::Cloud,
            AgentReconcileAdmission::ReuseCompatible,
        )
        .await
        .expect("start full-scope cloud reconcile");

    let completed = timeout(Duration::from_secs(20), async {
        loop {
            let snapshot = service.snapshot().await;
            if snapshot.status == AgentReconcileJobStatus::Completed
                || snapshot.status == AgentReconcileJobStatus::Failed
            {
                return snapshot;
            }
            sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("a pin-fenced full-scope cloud pass must terminate without network installs");

    let skipped: Vec<(&str, Option<&str>)> = completed
        .results
        .iter()
        .filter(|result| result.outcome == AgentReconcileOutcome::Skipped)
        .map(|result| (result.kind.as_str(), result.message.as_deref()))
        .collect();
    assert_eq!(
        skipped.len(),
        1,
        "cursor must be the only cloud carve-out, got {skipped:?}"
    );
    assert_eq!(skipped[0].0, AgentKind::Cursor.as_str());
    assert_eq!(
        skipped[0].1,
        Some(
            crate::domains::agents::installer::auto_install::AutoInstallSkip::CursorUnsupportedInCloud
                .message()
        ),
        "the skip must carry the named reason, not a generic one"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// Seed managed artifacts for every agent, so `has_managed_artifact` is true and
/// the pass has nothing to install for an agent the host happens to have on PATH
/// (post-R2.0 a PATH copy would otherwise trigger a real managed install here).
///
/// Both roles are seeded: `<kind>-launcher` under `agent_process` (the name
/// `managed_launcher_candidates` looks for) and `<kind>` under `native` (what
/// `resolve_native_artifact` checks before falling back to PATH). Claude and codex
/// need the native one — that is the artifact a developer machine resolves from
/// PATH.
///
/// A filesystem-only fixture on purpose: readiness stamps what it finds under the
/// runtime home `"managed"`, so no process-global state is touched. Narrowing
/// `PATH` instead would break every other test in this crate that shells out to
/// `git`/`npm`.
fn seed_managed_launchers(runtime_home: &std::path::Path, kinds: &[AgentKind]) {
    let write_executable = |path: &std::path::Path| {
        std::fs::create_dir_all(path.parent().expect("artifact parent"))
            .expect("create managed artifact dir");
        std::fs::write(path, "#!/bin/sh\nexit 0\n").expect("write managed artifact");
        crate::integrations::agent_cli::executable::make_executable(path)
            .expect("make managed artifact executable");
    };
    for kind in kinds {
        let agent_dir = runtime_home.join("agents").join(kind.as_str());
        write_executable(
            &agent_dir
                .join("agent_process")
                .join(format!("{}-launcher", kind.as_str())),
        );
        write_executable(&agent_dir.join("native").join(
            crate::integrations::agent_cli::executable::platform_binary_filename(kind.as_str()),
        ));
    }
}
