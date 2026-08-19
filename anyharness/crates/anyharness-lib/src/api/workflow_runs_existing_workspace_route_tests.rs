//! Tier-1 tests for F-A1's ExistingWorkspace placement: adoption of the
//! caller's workspace (no worktree, no provenance rewrite), the re-scoped
//! one-live-run law (N concurrent runs admitted under this mode only), the
//! stable eligibility errors, and the cardinal-sin negative control — a
//! post-placement acceptance failure must leave the adopted workspace
//! untouched. Shares `workflow_runs_route_tests`' fixture.

use axum::http::{Method, StatusCode};
use serde_json::json;
use tokio::sync::oneshot;

use super::http::workspaces_purge::purge_barriers::{self, PurgeBarrier};
use super::http::workflow_runs_lease_barriers::{self, ExistingWorkspaceLeaseBarrier};
use super::workflow_runs_route_tests::{fixture, run_uuid, single_node_definition};
use crate::domains::workflows::model::WorkflowRunStatus;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::domains::workspaces::store::WorkspaceStore;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn destructive_lifecycle_wins_before_adoption_reads_the_workspace() {
    let fixture = fixture("wf-route-existing-lifecycle-first");
    let store = WorkspaceStore::new(fixture.state.db.clone());

    // Archive wins the exclusive gate before PUT. The queued adoption must
    // read only after that gate releases, observe archived, and touch neither
    // rows nor the run-scoped context directory.
    let archived = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register archived candidate")
        .workspace;
    let archive_lease = fixture
        .state
        .workspace_operation_gate
        .acquire_exclusive(&archived.id)
        .await;
    let archived_run = run_uuid(0x28);
    let archived_uri = format!("/v1/workflow-runs/{archived_run}");
    let mut archived_body = fixture.snapshot(single_node_definition("wrap up"));
    archived_body["placement"]["mode"] = json!("existing_workspace");
    archived_body["placement"]["workspaceId"] = json!(archived.id);
    let (archived_reached_tx, mut archived_reached_rx) = oneshot::channel();
    let (archived_resume_tx, archived_resume_rx) = oneshot::channel();
    workflow_runs_lease_barriers::install(
        &archived.id,
        ExistingWorkspaceLeaseBarrier {
            reached_tx: Some(archived_reached_tx),
            resume_rx: Some(archived_resume_rx),
        },
    );
    let archived_request = fixture.request(Method::PUT, &archived_uri, Some(archived_body));
    tokio::pin!(archived_request);
    tokio::select! {
        result = &mut archived_request => panic!("PUT escaped pre-acquire barrier: {result:?}"),
        result = &mut archived_reached_rx => result.expect("PUT reaches pre-acquire barrier"),
    }
    store
        .mark_archived(
            &archived.id,
            None,
            None,
            "2026-08-19T00:00:00Z",
            None,
        )
        .expect("archive row while holding exclusive gate");
    archived_resume_tx.send(()).expect("release archive barrier");
    drop(archive_lease);
    let (status, problem) = archived_request.await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_NOT_ELIGIBLE");
    assert!(!fixture
        .repo_dir()
        .join(format!(".proliferate/context/{archived_run}"))
        .exists());
    let (status, _) = fixture.request(Method::GET, &archived_uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero run rows");

    // Purge has the same ordering law. Use a second repository so deleting
    // its workspace row does not disturb the archived-case checkout.
    let purged_dir = fixture.runtime_home.join("purged-checkout");
    std::fs::create_dir_all(&purged_dir).expect("purged dir");
    super::workflow_runs_route_tests::git(&purged_dir, &["init", "-b", "main"]);
    std::fs::write(purged_dir.join("README.md"), "purged\n").expect("seed");
    super::workflow_runs_route_tests::git(&purged_dir, &["add", "."]);
    super::workflow_runs_route_tests::git(&purged_dir, &["commit", "-m", "seed"]);
    let purged = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&purged_dir.to_string_lossy())
        .expect("register purge candidate")
        .workspace;
    let purge_lease = fixture
        .state
        .workspace_operation_gate
        .acquire_exclusive(&purged.id)
        .await;
    let purged_run = run_uuid(0x29);
    let purged_uri = format!("/v1/workflow-runs/{purged_run}");
    let mut purged_body = fixture.snapshot(single_node_definition("wrap up"));
    purged_body["placement"]["mode"] = json!("existing_workspace");
    purged_body["placement"]["workspaceId"] = json!(purged.id);
    let (purged_reached_tx, mut purged_reached_rx) = oneshot::channel();
    let (purged_resume_tx, purged_resume_rx) = oneshot::channel();
    workflow_runs_lease_barriers::install(
        &purged.id,
        ExistingWorkspaceLeaseBarrier {
            reached_tx: Some(purged_reached_tx),
            resume_rx: Some(purged_resume_rx),
        },
    );
    let purged_request = fixture.request(Method::PUT, &purged_uri, Some(purged_body));
    tokio::pin!(purged_request);
    tokio::select! {
        result = &mut purged_request => panic!("PUT escaped pre-acquire barrier: {result:?}"),
        result = &mut purged_reached_rx => result.expect("PUT reaches pre-acquire barrier"),
    }
    store
        .delete_workspace(&purged.id)
        .expect("purge row while holding exclusive gate");
    purged_resume_tx.send(()).expect("release purge barrier");
    drop(purge_lease);
    let (status, problem) = purged_request.await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_NOT_FOUND");
    assert!(!purged_dir
        .join(format!(".proliferate/context/{purged_run}"))
        .exists());
    let (status, _) = fixture.request(Method::GET, &purged_uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero run rows");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn adoption_holds_session_start_through_initial_and_later_launches() {
    let fixture = fixture("wf-route-existing-lifecycle-held");
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register user workspace")
        .workspace;

    // Hold the scripted agent inside fresh-session startup. The PUT already
    // materialized and inserted by this point, and must still own the same
    // shared SessionStart lease it acquired before adoption's first read.
    fixture.touch_control("hold-new");
    let run_id = run_uuid(0x2a);
    let uri = format!("/v1/workflow-runs/{run_id}");
    let mut body = fixture.snapshot(single_node_definition("blocking turn"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(existing.id);
    let put = fixture.request(Method::PUT, &uri, Some(body));
    tokio::pin!(put);
    let initial_start = fixture.wait_for_control("new-seen");
    tokio::pin!(initial_start);
    tokio::select! {
        result = &mut put => panic!("PUT escaped held session startup: {result:?}"),
        () = &mut initial_start => {}
    }
    let snapshot = fixture
        .state
        .workspace_operation_gate
        .snapshot(&existing.id)
        .await;
    assert_eq!(snapshot.count(WorkspaceOperationKind::SessionStart), 1);
    assert!(fixture
        .state
        .workspace_operation_gate
        .try_acquire_exclusive(&existing.id)
        .await
        .is_none());
    fixture.touch_control("release-new");
    let (status, projection) = put.await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let first_node_id = projection["nodes"][0]["id"]
        .as_str()
        .expect("first node id")
        .to_string();
    fixture.wait_for_control("turn-seen").await;

    // Redo converges on the actor's central StartNode seam after the initial
    // route lease is long gone. Hold its fresh session startup and prove the
    // actor independently reacquires the same lease kind.
    std::fs::remove_file(fixture.script.control_dir.join("new-seen"))
        .expect("clear initial new marker");
    std::fs::remove_file(fixture.script.control_dir.join("release-new"))
        .expect("re-arm session/new hold");
    let redo_uri = format!("/v1/workflow-runs/{run_id}/nodes/{first_node_id}/fail-redo");
    let redo = fixture.request(
        Method::POST,
        &redo_uri,
        Some(json!({ "prompt": "redo it" })),
    );
    tokio::pin!(redo);
    let later_start = fixture.wait_for_control("new-seen");
    tokio::pin!(later_start);
    tokio::select! {
        result = &mut redo => panic!("redo escaped held session startup: {result:?}"),
        () = &mut later_start => {}
    }
    let snapshot = fixture
        .state
        .workspace_operation_gate
        .snapshot(&existing.id)
        .await;
    assert_eq!(snapshot.count(WorkspaceOperationKind::SessionStart), 1);
    assert!(fixture
        .state
        .workspace_operation_gate
        .try_acquire_exclusive(&existing.id)
        .await
        .is_none());
    fixture.touch_control("release-new");
    let (status, projection) = redo.await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    fixture
        .wait_for_run(&run_id, "redo run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_waits_for_acceptance_then_fails_closed_on_the_new_session() {
    let fixture = fixture("wf-route-existing-purge-fence");
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register user workspace")
        .workspace;

    // Park purge after its up-front session snapshot but before its exclusive
    // gate. A workflow that wins now must complete prompt acceptance under the
    // shared lease; purge then rechecks under exclusive and refuses the new
    // workflow-controlled session instead of deleting underneath it.
    let (reached_tx, mut reached_rx) = oneshot::channel();
    let (resume_tx, resume_rx) = oneshot::channel();
    purge_barriers::install(
        &existing.id,
        PurgeBarrier {
            reached_tx: Some(reached_tx),
            resume_rx: Some(resume_rx),
        },
    );
    let purge_uri = format!("/v1/workspaces/{}", existing.id);
    let purge = fixture.request(Method::DELETE, &purge_uri, None);
    tokio::pin!(purge);
    tokio::select! {
        result = &mut purge => panic!("purge escaped its proof barrier: {result:?}"),
        result = &mut reached_rx => result.expect("purge reaches pre-exclusive barrier"),
    }

    let run_id = run_uuid(0x2b);
    let mut body = fixture.snapshot(single_node_definition("blocking turn"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(existing.id);
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{run_id}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    fixture.wait_for_control("turn-seen").await;

    resume_tx.send(()).expect("release purge barrier");
    let (status, problem) = purge.await;
    purge_barriers::clear(&existing.id);
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "SESSION_CONTROLLED_BY_WORKFLOW");
    assert!(fixture
        .state
        .workspace_runtime
        .get_workspace(&existing.id)
        .expect("workspace lookup")
        .is_some());

    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&run_id, "run completes after refused purge", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn existing_workspace_mode_adopts_the_workspace_and_admits_concurrent_runs() {
    let fixture = fixture("wf-route-existing");
    // The user's own workspace, registered before any workflow ran — with no
    // creator context, exactly as an ordinary opened checkout has none.
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register user workspace")
        .workspace;
    assert!(existing.creator_context.is_none(), "precondition");

    let first_run = run_uuid(0x20);
    let mut body = fixture.snapshot(single_node_definition("blocking turn"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(existing.id);
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{first_run}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    // R1: the run executes in exactly the caller's workspace...
    assert_eq!(projection["run"]["workspaceId"], json!(existing.id));
    // ...creates no worktree...
    let managed_root = canonical_managed_worktrees_root(&fixture.runtime_home).expect("root");
    assert!(
        !managed_root.join(format!("workflows/{first_run}")).exists(),
        "existing-workspace placement must not cut a worktree"
    );
    // ...and materializes its docs run-scoped inside the adopted checkout.
    assert!(fixture
        .repo_dir()
        .join(format!(".proliferate/context/{first_run}/00-notes.md"))
        .is_file());

    // F-A1: a second concurrent run is ADMITTED under this mode while the
    // first is non-terminal (the re-scoped one-live-run law).
    let second_run = run_uuid(0x21);
    let mut second_body = fixture.snapshot(single_node_definition("wrap up"));
    second_body["placement"]["mode"] = json!("existing_workspace");
    second_body["placement"]["workspaceId"] = json!(existing.id);
    let (status, second_projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{second_run}"),
            Some(second_body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{second_projection}");
    assert_eq!(second_projection["run"]["workspaceId"], json!(existing.id));
    // R3: the concurrent runs' docs live in disjoint run-scoped dirs.
    assert!(fixture
        .repo_dir()
        .join(format!(".proliferate/context/{second_run}/00-notes.md"))
        .is_file());
    fixture
        .wait_for_run(&second_run, "second run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;

    // Adoption never rewrites the workspace's provenance: the run-to-workspace
    // association lives on workflow_runs.workspace_id alone.
    let adopted = fixture
        .state
        .workspace_runtime
        .get_workspace(&existing.id)
        .expect("lookup")
        .expect("workspace row survives");
    assert!(
        adopted.creator_context.is_none(),
        "adoption must not stamp Workflow provenance on a workspace it did not create"
    );

    fixture.wait_for_control("turn-seen").await;
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&first_run, "first run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn existing_workspace_placement_answers_stable_validation_errors() {
    let fixture = fixture("wf-route-existing-errors");

    // Unknown workspace id: 404 with the dedicated code, zero rows.
    let run_id = run_uuid(0x22);
    let uri = format!("/v1/workflow-runs/{run_id}");
    let mut body = fixture.snapshot(single_node_definition("wrap up"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!("ws-ghost");
    let (status, problem) = fixture.request(Method::PUT, &uri, Some(body)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_NOT_FOUND");
    let (status, _) = fixture.request(Method::GET, &uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero rows inserted");

    // Missing workspaceId under existing_workspace: a malformed snapshot.
    let mut body = fixture.snapshot(single_node_definition("wrap up"));
    body["placement"]["mode"] = json!("existing_workspace");
    let (status, problem) = fixture
        .request(Method::PUT, &format!("/v1/workflow-runs/{}", run_uuid(0x23)), Some(body))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_SNAPSHOT_INVALID");

    // workspaceId under any other mode: equally malformed, caught at validate.
    let mut body = fixture.snapshot(single_node_definition("wrap up"));
    body["placement"]["workspaceId"] = json!("ws-anything");
    let (status, problem) = fixture
        .request(Method::PUT, &format!("/v1/workflow-runs/{}", run_uuid(0x24)), Some(body))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_SNAPSHOT_INVALID");

    // A real workspace whose checkout no longer exists on disk: ineligible.
    let side_dir = fixture.runtime_home.join("side-checkout");
    std::fs::create_dir_all(&side_dir).expect("side dir");
    super::workflow_runs_route_tests::git(&side_dir, &["init", "-b", "main"]);
    std::fs::write(side_dir.join("README.md"), "side\n").expect("seed");
    super::workflow_runs_route_tests::git(&side_dir, &["add", "."]);
    super::workflow_runs_route_tests::git(&side_dir, &["commit", "-m", "seed"]);
    let side = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&side_dir.to_string_lossy())
        .expect("register side workspace")
        .workspace;

    // F-A1 erratum: repoConfigId independently names the fixture's primary
    // repo root, while this workspace is a different repository. No equality
    // or path relationship is required, so cross-repository adoption succeeds.
    let cross_repo_run = run_uuid(0x27);
    let mut cross_repo_body = fixture.snapshot(single_node_definition("wrap up"));
    cross_repo_body["placement"]["mode"] = json!("existing_workspace");
    cross_repo_body["placement"]["workspaceId"] = json!(side.id);
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{cross_repo_run}"),
            Some(cross_repo_body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    assert_eq!(projection["run"]["workspaceId"], json!(side.id));
    fixture
        .wait_for_run(&cross_repo_run, "cross-repo run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;

    std::fs::remove_dir_all(&side_dir).expect("delete checkout");
    let mut body = fixture.snapshot(single_node_definition("wrap up"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(side.id);
    let (status, problem) = fixture
        .request(Method::PUT, &format!("/v1/workflow-runs/{}", run_uuid(0x25)), Some(body))
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_NOT_ELIGIBLE");
}

/// The cardinal sin of Feature A: a post-placement acceptance failure under
/// ExistingWorkspace must destroy NOTHING — the workspace was never this
/// run's to tear down. Forces the failure after adoption by planting a
/// regular file where the context dir must go.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_acceptance_never_touches_the_adopted_workspace() {
    let fixture = fixture("wf-route-existing-compensate");
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register user workspace")
        .workspace;
    // The user's own uncommitted work, which teardown must never eat.
    std::fs::write(fixture.repo_dir().join("wip.txt"), "precious\n").expect("wip");
    // Poison: a regular FILE at `.proliferate` fails context materialization
    // AFTER the workspace was adopted.
    std::fs::write(fixture.repo_dir().join(".proliferate"), "not a dir\n").expect("poison");

    let run_id = run_uuid(0x26);
    let uri = format!("/v1/workflow-runs/{run_id}");
    let mut body = fixture.snapshot(single_node_definition("wrap up"));
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(existing.id);
    let (status, problem) = fixture.request(Method::PUT, &uri, Some(body.clone())).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED");

    // Zero rows for the failed PUT...
    let (status, _) = fixture.request(Method::GET, &uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero rows inserted");
    // ...and the adopted workspace is byte-for-byte untouched: directory
    // present, the user's uncommitted file intact, the workspace row alive.
    assert!(fixture.repo_dir().is_dir(), "workspace directory survives");
    assert_eq!(
        std::fs::read_to_string(fixture.repo_dir().join("wip.txt")).expect("wip survives"),
        "precious\n"
    );
    let row = fixture
        .state
        .workspace_runtime
        .get_workspace(&existing.id)
        .expect("lookup")
        .expect("workspace row survives compensation");
    assert!(row.creator_context.is_none(), "no provenance rewrite on failure");

    // Unpoison and retry the same run id: adoption re-resolves and succeeds.
    std::fs::remove_file(fixture.repo_dir().join(".proliferate")).expect("unpoison");
    let (status, projection) = fixture.request(Method::PUT, &uri, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    fixture
        .wait_for_run(&run_id, "retried run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}
