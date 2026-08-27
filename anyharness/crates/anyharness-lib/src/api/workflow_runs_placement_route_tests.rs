//! Tier-1 tests for the PUT's placement laws: Ruling B's repo-root
//! resolve-or-reuse and one-live-run conflict, and Ruling F's compensation —
//! a failed materialization leaves zero rows AND no worktree artifact, so the
//! retry is genuinely fresh. Shares `workflow_runs_route_tests`' fixture.

use std::process::Command;

use axum::http::{Method, StatusCode};
use serde_json::json;

use super::workflow_runs_route_tests::{fixture, git, run_uuid, single_node_definition};
use crate::domains::workflows::model::WorkflowRunStatus;
use crate::domains::workspaces::managed_root::canonical_managed_worktrees_root;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repo_root_mode_reuses_the_workspace_and_enforces_one_live_run() {
    let fixture = fixture("wf-route-reporoot");
    // The repo root's checkout is already a registered workspace, as it would
    // be for any repository the user opened before invoking a workflow.
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register repo-root workspace")
        .workspace;

    let first_run = run_uuid(0x10);
    let mut body = fixture.snapshot(single_node_definition("blocking turn"));
    body["placement"]["mode"] = json!("repo_root");
    let (status, projection) = fixture
        .request(
            Method::PUT,
            &format!("/v1/workflow-runs/{first_run}"),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    // Ruling B: the run adopted the EXISTING workspace row — no duplicate
    // Local registration for the same checkout.
    assert_eq!(projection["run"]["workspaceId"], json!(existing.id));
    // Context docs materialized into the user's checkout.
    assert!(fixture
        .repo_dir()
        .join(format!(".proliferate/context/{first_run}/00-notes.md"))
        .is_file());

    // The one-live-run law: a second run cannot land in the workspace while
    // the first is non-terminal — 409 with the placement-conflict code and
    // zero rows for the loser.
    let second_run = run_uuid(0x11);
    let second_uri = format!("/v1/workflow-runs/{second_run}");
    let mut second_body = fixture.snapshot(single_node_definition("wrap up"));
    second_body["placement"]["mode"] = json!("repo_root");
    let (status, problem) = fixture
        .request(Method::PUT, &second_uri, Some(second_body.clone()))
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_PLACEMENT_CONFLICT");
    let (status, _) = fixture.request(Method::GET, &second_uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero rows for the loser");

    // Once the first run is terminal the workspace frees up.
    fixture.wait_for_control("turn-seen").await;
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&first_run, "first run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
    let (status, projection) = fixture
        .request(Method::PUT, &second_uri, Some(second_body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    assert_eq!(projection["run"]["workspaceId"], json!(existing.id));
    fixture
        .wait_for_run(&second_run, "second run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failed_materialization_compensates_the_worktree_and_the_retry_succeeds() {
    let fixture = fixture("wf-route-compensate");
    // A regular FILE named `.proliferate` committed at the repo root makes
    // context materialization fail (the context dir cannot be created) AFTER
    // the worktree was cut — exactly the crash gap Ruling F compensates.
    std::fs::write(fixture.repo_dir().join(".proliferate"), "not a dir\n").expect("poison file");
    git(&fixture.repo_dir(), &["add", "."]);
    git(&fixture.repo_dir(), &["commit", "-m", "poison"]);

    let run_id = run_uuid(0x12);
    let uri = format!("/v1/workflow-runs/{run_id}");
    let body = fixture.snapshot(single_node_definition("wrap up"));
    let (status, problem) = fixture.request(Method::PUT, &uri, Some(body.clone())).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED");
    // Ruling F: the 503's detail never leaks absolute local paths.
    let detail = problem["detail"].as_str().expect("detail");
    assert!(
        !detail.contains(&*fixture.runtime_home.to_string_lossy()),
        "{detail}"
    );

    // Zero rows, and the compensation removed the artifact it had created:
    // no worktree at the deterministic path, no `workflow/<runId>` branch.
    let (status, _) = fixture.request(Method::GET, &uri, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero rows inserted");
    let managed_root = canonical_managed_worktrees_root(&fixture.runtime_home).expect("root");
    assert!(
        !managed_root.join(format!("workflows/{run_id}")).exists(),
        "worktree compensated"
    );
    let branches = Command::new("git")
        .args(["branch", "--list", &format!("workflow/{run_id}")])
        .current_dir(fixture.repo_dir())
        .output()
        .expect("list branches");
    assert!(
        String::from_utf8_lossy(&branches.stdout).trim().is_empty(),
        "branch compensated"
    );

    // Fix the repository and retry the SAME run id: the retry re-resolves
    // from scratch and succeeds. Without compensation it would wedge forever
    // — the moved base ref mismatches the stale artifact and the stale
    // branch name-conflicts the re-cut.
    git(&fixture.repo_dir(), &["rm", ".proliferate"]);
    git(&fixture.repo_dir(), &["commit", "-m", "unpoison"]);
    let (status, projection) = fixture.request(Method::PUT, &uri, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    fixture
        .wait_for_run(&run_id, "retried run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}
