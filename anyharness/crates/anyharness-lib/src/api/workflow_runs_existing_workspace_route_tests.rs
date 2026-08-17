//! Tier-2 tests for F-A1's ExistingWorkspace placement: adoption of the
//! caller's workspace (no worktree, no provenance rewrite), the re-scoped
//! one-live-run law (N concurrent runs admitted under this mode only), the
//! stable eligibility errors, and the cardinal-sin negative control — a
//! post-placement acceptance failure must leave the adopted workspace
//! untouched. Shares `workflow_runs_route_tests`' fixture.

use axum::http::{Method, StatusCode};
use serde_json::json;

use super::workflow_runs_route_tests::{fixture, run_uuid, single_node_definition};
use crate::domains::workflows::model::WorkflowRunStatus;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;

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
