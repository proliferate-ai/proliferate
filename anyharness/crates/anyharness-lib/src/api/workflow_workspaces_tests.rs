//! HTTP-level tests for `PUT/GET /v1/workflow-run-workspaces/{runId}` over an
//! in-memory `AppState` and the real router (spec
//! `workflow-workspace-placement`), plus the schema-v2 run-acceptance guard and
//! the generic-retention exclusion, both against real state.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use super::workflow_runs_tests::{get as get_run, put as put_run};
use crate::{
    app::{test_support, AppState},
    domains::agents::installer::seed::AgentSeedStore,
    persistence::Db,
};

/// An `AppState` whose runtime home is nested one level down, so the managed
/// worktrees root (`<parent>/worktrees`) is test-isolated instead of the global
/// temp directory.
fn isolated_state() -> (AppState, PathBuf) {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let base = std::env::temp_dir().join(format!("anyharness-wfws-http-{unique}"));
    let runtime_home = base.join("runtime");
    std::fs::create_dir_all(&runtime_home).expect("runtime home");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    (state, base)
}

fn scratch_body() -> Value {
    json!({ "schemaVersion": 1, "placement": { "kind": "scratch" } })
}

fn assert_strict_placement_union(doc: &Value) -> Result<(), String> {
    let variants = doc["components"]["schemas"]["WorkflowWorkspacePlacementRequest"]["oneOf"]
        .as_array()
        .ok_or_else(|| "placement schema has no oneOf".to_string())?;
    for expected_kind in ["scratch", "repositoryWorktree"] {
        let variant = variants
            .iter()
            .find(|variant| variant["properties"]["kind"]["enum"][0] == expected_kind)
            .ok_or_else(|| format!("missing {expected_kind} placement variant"))?;
        if variant.get("additionalProperties") != Some(&Value::Bool(false)) {
            return Err(format!(
                "{expected_kind} placement must set additionalProperties=false"
            ));
        }
    }
    Ok(())
}

async fn put_workspace(state: &AppState, run_id: &str, body: Value) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/v1/workflow-run-workspaces/{run_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, payload)
}

async fn get_workspace(state: &AppState, run_id: &str) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/workflow-run-workspaces/{run_id}"))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, payload)
}

fn init_repo(path: &Path) {
    for args in [
        vec!["init", "-b", "main"],
        vec!["config", "user.email", "codex@example.com"],
        vec!["config", "user.name", "Codex"],
    ] {
        run_git(path, &args);
    }
    std::fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, &["add", "README.md"]);
    run_git(path, &["commit", "-m", "Initial commit"]);
}

fn run_git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn v2_run_body(workspace_id: &str) -> Value {
    json!({
        "schemaVersion": 2,
        "workspaceId": workspace_id,
        "definition": {
            "inputs": [{ "name": "ticket", "type": "string", "required": true }],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelSelection": {
                        "kind": "exact",
                        "modelId": "definitely-not-a-real-model"
                    },
                    "permissionPolicy": "workflowDefault"
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }]
            }]
        },
        "arguments": { "ticket": "PROL-123" }
    })
}

#[tokio::test]
async fn put_get_replay_conflict_and_not_found_over_http() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let (state, _base) = isolated_state();
    let run_id = uuid::Uuid::new_v4().to_string();

    // New scratch materialization -> 201 with a ready record.
    let (status, body) = put_workspace(&state, &run_id, scratch_body()).await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert_eq!(body["runId"], run_id.as_str());
    assert_eq!(body["status"], "ready");
    assert_eq!(body["placement"]["kind"], "scratch");
    let workspace_id = body["workspaceId"]
        .as_str()
        .expect("workspaceId")
        .to_string();
    assert!(body.get("failureCode").is_none());

    // Identical replay -> 200 with the SAME workspaceId.
    let (status, body) = put_workspace(&state, &run_id, scratch_body()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["workspaceId"], workspace_id.as_str());

    // Same ID, different placement -> 409.
    let different = json!({
        "schemaVersion": 1,
        "placement": {
            "kind": "repositoryWorktree",
            "repoRootId": "30000000-0000-4000-8000-000000000001",
            "baseRef": "main"
        }
    });
    let (status, body) = put_workspace(&state, &run_id, different).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "WORKFLOW_WORKSPACE_CONFLICT");

    // Strictness -> coded 400.
    let mut unknown = scratch_body();
    unknown["surprise"] = json!(true);
    let (status, body) = put_workspace(&state, &uuid::Uuid::new_v4().to_string(), unknown).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_WORKSPACE_INVALID");

    // CONTRACT-01: the strict discriminated union rejects NESTED unknown fields
    // and BOTH invalid kind/field pairings at the type boundary (not only a
    // top-level unknown). Each is a coded 400.
    for bad in [
        // Nested unknown field inside the placement.
        json!({ "schemaVersion": 1, "placement": { "kind": "scratch", "extra": 1 } }),
        // scratch carrying repository fields.
        json!({
            "schemaVersion": 1,
            "placement": { "kind": "scratch", "repoRootId": "x", "baseRef": "main" }
        }),
        // repositoryWorktree missing both required repository fields.
        json!({ "schemaVersion": 1, "placement": { "kind": "repositoryWorktree" } }),
        // repositoryWorktree missing baseRef.
        json!({
            "schemaVersion": 1,
            "placement": { "kind": "repositoryWorktree", "repoRootId": "x" }
        }),
        // Arbitrary unknown kind.
        json!({ "schemaVersion": 1, "placement": { "kind": "somethingElse" } }),
    ] {
        let (status, body) = put_workspace(&state, &uuid::Uuid::new_v4().to_string(), bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
        assert_eq!(body["code"], "WORKFLOW_WORKSPACE_INVALID");
    }

    // GET the record -> 200; unknown -> 404; non-canonical -> 400.
    let (status, body) = get_workspace(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["workspaceId"], workspace_id.as_str());
    let (status, body) = get_workspace(&state, &uuid::Uuid::new_v4().to_string()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKFLOW_WORKSPACE_NOT_FOUND");
    let (status, body) = get_workspace(&state, "not-a-uuid").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_WORKSPACE_INVALID");
}

#[tokio::test]
async fn schema_v2_run_acceptance_guard_binds_shared_run_id_to_ready_workspace() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let (state, _base) = isolated_state();

    // (a) No materialization: manual existing-workspace behavior is preserved
    // (an unknown workspace is still a 404, exactly as before this slice).
    let no_mat_run = uuid::Uuid::new_v4().to_string();
    let (status, body) = put_run(
        &state,
        &no_mat_run,
        v2_run_body("39999999-9999-4999-8999-999999999999"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKSPACE_NOT_FOUND");

    // (b) A same-ID materialization that is not ready (terminal failed) blocks
    // run acceptance with the dedicated 409 and creates zero run rows.
    let failed_run = uuid::Uuid::new_v4().to_string();
    let (status, body) = put_workspace(
        &state,
        &failed_run,
        json!({
            "schemaVersion": 1,
            "placement": {
                "kind": "repositoryWorktree",
                "repoRootId": "00000000-0000-4000-8000-00000000dead",
                "baseRef": "main"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["status"], "failed");
    let (status, body) = put_run(
        &state,
        &failed_run,
        v2_run_body("39999999-9999-4999-8999-999999999999"),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "body: {body}");
    assert_eq!(body["code"], "workflow_workspace_not_ready");
    let (status, _) = get_run(&state, &failed_run).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "guard 409 stored a run row");

    // (c) A ready materialization with a DIFFERENT workspace in the run request
    // conflicts with the dedicated mismatch code and zero run effects.
    let ready_run = uuid::Uuid::new_v4().to_string();
    let (status, body) = put_workspace(&state, &ready_run, scratch_body()).await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert_eq!(body["status"], "ready");
    let materialized_workspace = body["workspaceId"]
        .as_str()
        .expect("workspaceId")
        .to_string();
    let (status, body) = put_run(
        &state,
        &ready_run,
        v2_run_body("39999999-9999-4999-8999-999999999999"),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "body: {body}");
    assert_eq!(body["code"], "workflow_workspace_mismatch");
    let (status, _) = get_run(&state, &ready_run).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "mismatch 409 stored a run row"
    );

    // (d) The exact ready workspace passes the guard and continues NORMAL run
    // acceptance: with an unresolvable model the request reaches target
    // resolution (422), proving the guard admitted it rather than 409ing.
    let (status, body) = put_run(&state, &ready_run, v2_run_body(&materialized_workspace)).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "body: {body}");
    assert_eq!(body["code"], "WORKFLOW_RUN_TARGET_UNRESOLVABLE");

    // Schema v1 behavior is unchanged: same run id via v1 accepts without any
    // workspace-materialization coupling (v1 acceptance does not check the
    // workspace at all).
    let v1_run = uuid::Uuid::new_v4().to_string();
    let (status, _body) = put_workspace(&state, &v1_run, scratch_body()).await;
    assert_eq!(status, StatusCode::CREATED);
    let v1_body = json!({
        "schemaVersion": 1,
        "workspaceId": "20000000-0000-4000-8000-000000000002",
        "definition": {
            "inputs": [{ "name": "ticket", "type": "string", "required": true }],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": "claude-sonnet-4-5",
                    "modeId": "bypassPermissions"
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }]
            }]
        },
        "arguments": { "ticket": "PROL-123" }
    });
    let (status, _body) = put_run(&state, &v1_run, v1_body).await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn placement_put_after_run_acceptance_returns_stable_binding_conflict() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let (state, _base) = isolated_state();
    let run_id = uuid::Uuid::new_v4().to_string();
    let run_body = json!({
        "schemaVersion": 1,
        "workspaceId": "20000000-0000-4000-8000-000000000002",
        "definition": {
            "inputs": [],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": "claude-sonnet-4-5",
                    "modeId": "bypassPermissions"
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Return ok" }]
            }]
        },
        "arguments": {}
    });
    let (status, _body) = put_run(&state, &run_id, run_body).await;
    assert_eq!(status, StatusCode::CREATED);

    for _ in 0..2 {
        let (status, body) = put_workspace(&state, &run_id, scratch_body()).await;
        assert_eq!(status, StatusCode::CONFLICT, "body: {body}");
        assert_eq!(body["code"], "workflow_run_already_accepted");
    }
    let (status, body) = get_workspace(&state, &run_id).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "body: {body}");
}

#[tokio::test]
async fn generic_retention_pass_excludes_workflow_creator_context() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let (state, base) = isolated_state();

    // A real source repository.
    let source = base.join("source");
    std::fs::create_dir_all(&source).expect("source dir");
    init_repo(&source);
    let repo_root = state
        .workspace_runtime
        .resolve_repo_root_from_path(source.to_str().expect("utf8"))
        .expect("repo root");

    // One Workflow-materialized worktree in the managed root, created FIRST so
    // it is the oldest-activity worktree — the prime retirement candidate if
    // the exclusion were missing.
    let run_id = uuid::Uuid::new_v4().to_string();
    let (status, body) = put_workspace(
        &state,
        &run_id,
        json!({
            "schemaVersion": 1,
            "placement": {
                "kind": "repositoryWorktree",
                "repoRootId": repo_root.id,
                "baseRef": "main"
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert_eq!(body["status"], "ready", "body: {body}");
    let workflow_workspace_id = body["workspaceId"].as_str().expect("id").to_string();
    let workflow_path = PathBuf::from(
        state
            .workspace_runtime
            .get_workspace(&workflow_workspace_id)
            .expect("lookup")
            .expect("workspace")
            .path,
    );

    // Eleven ORDINARY worktrees in the managed root. With the minimum policy of
    // 10, exactly one eligible worktree is beyond the keep budget.
    let managed_root = base.join("worktrees");
    let mut ordinary_ids = Vec::new();
    for index in 0..11 {
        let control_path = managed_root.join(format!("control-worktree-{index}"));
        let control = state
            .workspace_runtime
            .create_worktree(
                &repo_root.id,
                control_path.to_str().expect("utf8"),
                &format!("control-branch-{index}"),
                Some("main"),
                None,
            )
            .expect("control worktree");
        ordinary_ids.push(control.workspace.id);
    }

    state
        .workspace_retention_service
        .update_policy(10)
        .expect("policy");
    let result = state
        .workspace_retention_service
        .run_pass(None)
        .await
        .expect("retention pass");

    // The pass ran and retired exactly one ORDINARY worktree (the oldest
    // eligible one) — the excluded workflow worktree did not consume a slot and
    // was not the candidate despite being the oldest of all.
    assert!(
        result.rows.iter().any(|row| {
            ordinary_ids.contains(&row.workspace_id)
                && matches!(
                    row.outcome,
                    anyharness_contract::v1::WorktreeRetentionRowOutcome::Retired
                )
        }),
        "no ordinary worktree was retired: {:?}",
        result.rows
    );
    // ...while the Workflow-created workspace was never even considered.
    assert!(
        result
            .rows
            .iter()
            .all(|row| row.workspace_id != workflow_workspace_id),
        "workflow workspace appeared in the retention pass: {:?}",
        result.rows
    );
    let survivor = state
        .workspace_runtime
        .get_workspace(&workflow_workspace_id)
        .expect("lookup")
        .expect("workflow workspace row survives");
    assert_eq!(
        survivor.lifecycle_state,
        crate::domains::workspaces::model::WorkspaceLifecycleState::Active
    );
    assert!(workflow_path.is_dir(), "workflow artifact was pruned");
}

#[test]
fn openapi_documents_workspace_routes_and_guard_conflict_codes() {
    let doc: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("parse openapi document");

    let path = &doc["paths"]["/v1/workflow-run-workspaces/{run_id}"];
    for (method, statuses) in [
        ("put", vec!["200", "201", "400", "409", "500"]),
        ("get", vec!["200", "400", "404"]),
    ] {
        let operation = &path[method];
        assert!(!operation.is_null(), "missing {method} operation");
        for status in statuses {
            assert!(
                operation["responses"].get(status).is_some(),
                "missing {method} {status}"
            );
        }
    }
    assert_eq!(
        path["put"]["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/PutWorkflowRunWorkspaceRequest"
    );

    let schemas = doc["components"]["schemas"]
        .as_object()
        .expect("schemas object");
    for name in [
        "PutWorkflowRunWorkspaceRequest",
        "WorkflowWorkspacePlacementRequest",
        "WorkflowWorkspaceStatus",
        "WorkflowWorkspaceResolvedPlacement",
        "WorkflowRunWorkspaceResponse",
    ] {
        assert!(schemas.contains_key(name), "missing component {name}");
    }

    assert_strict_placement_union(&doc).expect("strict placement union");
    for variant_index in 0..2 {
        let mut mutated = doc.clone();
        mutated["components"]["schemas"]["WorkflowWorkspacePlacementRequest"]["oneOf"]
            [variant_index]
            .as_object_mut()
            .expect("placement variant object")
            .remove("additionalProperties");
        assert!(
            assert_strict_placement_union(&mutated).is_err(),
            "removing strictness from placement variant {variant_index} must fail the ratchet"
        );
    }

    // The run-acceptance guard's two 409 codes are documented on the run PUT.
    let run_put_409 = doc["paths"]["/v1/workflow-runs/{run_id}"]["put"]["responses"]["409"]
        ["description"]
        .as_str()
        .expect("run PUT 409 description");
    assert!(
        run_put_409.contains("workflow_workspace_not_ready")
            && run_put_409.contains("workflow_workspace_mismatch"),
        "run PUT 409 must document the guard codes: {run_put_409}"
    );

    // The Workflow creator-context variant is part of the workspace schema.
    let creator = serde_json::to_string(&schemas["WorkspaceCreatorContext"])
        .expect("serialize creator context schema");
    assert!(
        creator.contains("runId"),
        "missing Workflow runId provenance"
    );
}

#[test]
fn checked_in_openapi_document_matches_runtime_generation() {
    let runtime: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("runtime OpenAPI");
    let checked_in: Value =
        serde_json::from_str(include_str!("../../../../sdk/generated/openapi.json"))
            .expect("checked-in OpenAPI");
    assert_eq!(runtime, checked_in, "checked-in OpenAPI document drifted");
}
