//! HTTP-level tests for the workflow-runs routes over an in-memory `AppState`
//! and the real router. Workspace existence is not required for acceptance, so
//! these exercise the durable PUT/replay/conflict/GET surface without booting a
//! live agent.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use crate::{
    app::{test_support, AppState},
    domains::agents::installer::seed::AgentSeedStore,
    persistence::Db,
};

const RUN_ID: &str = "11111111-1111-4111-8111-111111111111";

pub(super) fn test_state() -> AppState {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    AppState::new(
        PathBuf::from(format!("/tmp/anyharness-workflow-router-{unique}")),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state")
}

fn valid_body() -> Value {
    json!({
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
    })
}

pub(super) async fn put(state: &AppState, run_id: &str, body: Value) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/v1/workflow-runs/{run_id}"))
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

pub(super) async fn get(state: &AppState, run_id: &str) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/workflow-runs/{run_id}"))
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

#[tokio::test]
async fn put_replay_conflict_get_and_not_found() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    // New acceptance -> 201.
    let (status, body) = put(&state, RUN_ID, valid_body()).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["run"]["id"], RUN_ID);
    assert_eq!(
        body["steps"][0]["promptId"],
        format!("workflow:{RUN_ID}:0:0")
    );
    assert_eq!(body["steps"][0]["stageIndex"], 0);
    assert_eq!(body["steps"][0]["stepIndex"], 0);

    // Identical replay -> 200.
    let (status, _body) = put(&state, RUN_ID, valid_body()).await;
    assert_eq!(status, StatusCode::OK);

    // Same ID, different invocation -> 409.
    let mut different = valid_body();
    different["arguments"]["ticket"] = json!("OTHER");
    let (status, body) = put(&state, RUN_ID, different).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "WORKFLOW_RUN_CONFLICT");

    // GET the run -> 200.
    let (status, body) = get(&state, RUN_ID).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["id"], RUN_ID);
    assert_eq!(body["steps"][0]["stepIndex"], 0);

    // GET a missing run -> 404.
    let (status, body) = get(&state, "22222222-2222-4222-8222-222222222222").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKFLOW_RUN_NOT_FOUND");
}

#[tokio::test]
async fn strict_shape_and_invalid_definitions_return_coded_400() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    // Unknown field -> our coded 400, not axum's 422.
    let mut unknown = valid_body();
    unknown["surprise"] = json!(true);
    let (status, body) = put(&state, RUN_ID, unknown).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Structurally valid but semantically invalid (bad schema version) -> 400.
    let mut bad_version = valid_body();
    bad_version["schemaVersion"] = json!(2);
    let (status, body) = put(&state, RUN_ID, bad_version).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Non-canonical run id in the path -> 400 on PUT...
    let (status, body) = put(&state, "not-a-uuid", valid_body()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // ...and the same coded 400 (not 404) on GET (spec §3).
    let (status, body) = get(&state, "not-a-uuid").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Uppercase (non-canonical) UUID is also a 400 on GET.
    let (status, body) = get(&state, "11111111-1111-4111-8111-11111111111A").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");
}

// ---------------------------------------------------------------------------
// Execution-crossing tests (review C2A-REV-05 / C2A-DEC-01 / C2A-REV-01):
// these cross WorkflowRunRuntime and WorkflowRunSessionExtension against real
// SQLite and real workspace rows. No agent is ever actually launched: every
// path fails deterministically before a live process (bogus model, retired or
// missing workspace, nonexistent workspace path).
// ---------------------------------------------------------------------------

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use axum::http::Method;

use crate::api::auth::{user_route_allowed, AuthError, ClaimPermissions, UserClaimAuth};
use crate::app::AppStateInitError;
use crate::domains::sessions::extensions::{
    SessionExtension, SessionTurnFinishedContext, SessionTurnOutcome,
};
use crate::domains::workflows::model::{
    workflow_prompt_id, PutWorkflowRunInput, VersionedPutWorkflowRunInput, WorkflowDefinition,
    WorkflowHarnessConfig, WorkflowInput, WorkflowInputType, WorkflowPromptStep, WorkflowStage,
};
use crate::domains::workflows::service::WorkflowRunService;
use crate::domains::workflows::session_extension::WorkflowRunSessionExtension;
use crate::domains::workflows::store::WorkflowRunStore;
use crate::domains::workspaces::access_model::{WorkspaceAccessMode, WorkspaceAccessRecord};
use crate::domains::workspaces::access_store::WorkspaceAccessStore;
use crate::domains::workspaces::model::{
    WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};

fn body_for_workspace(workspace_id: &str, model_id: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "workspaceId": workspace_id,
        "definition": {
            "inputs": [{ "name": "ticket", "type": "string", "required": true }],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": model_id,
                    "modeId": null
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }]
            }]
        },
        "arguments": { "ticket": "PROL-123" }
    })
}

fn domain_input_for_workspace(workspace_id: &str) -> PutWorkflowRunInput {
    let mut arguments = BTreeMap::new();
    arguments.insert("ticket".to_string(), json!("PROL-123"));
    PutWorkflowRunInput {
        schema_version: 1,
        workspace_id: workspace_id.to_string(),
        definition: WorkflowDefinition {
            inputs: vec![WorkflowInput {
                name: "ticket".to_string(),
                input_type: WorkflowInputType::String,
                required: true,
            }],
            stages: vec![WorkflowStage {
                harness_config: WorkflowHarnessConfig {
                    agent_kind: "claude".to_string(),
                    model_id: None,
                    mode_id: None,
                },
                steps: vec![WorkflowPromptStep {
                    kind: "agent.prompt".to_string(),
                    prompt: "Investigate {{inputs.ticket}}".to_string(),
                }],
            }],
        },
        arguments,
    }
}

/// Poll GET until the predicate holds or a hard deadline expires. Polling is
/// the proof mechanism; sleeps only pace the polls.
pub(super) async fn poll_run_until(
    state: &AppState,
    run_id: &str,
    what: &str,
    predicate: impl Fn(&Value) -> bool,
) -> Value {
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let mut last = Value::Null;
    loop {
        let (status, body) = get(state, run_id).await;
        if status == StatusCode::OK && predicate(&body) {
            return body;
        }
        last = body;
        if std::time::Instant::now() > deadline {
            panic!("timed out waiting for {what}; last GET body: {last}");
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

pub(super) fn session_count(state: &AppState) -> i64 {
    state
        .db
        .with_conn(|conn| conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0)))
        .expect("count sessions")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn nonexistent_workspace_fails_durably_with_workspace_unavailable() {
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let run_id = uuid::Uuid::new_v4().to_string();

    let (status, _body) = put(
        &state,
        &run_id,
        body_for_workspace("99999999-9999-4999-8999-999999999999", Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let body = poll_run_until(&state, &run_id, "workspace_unavailable failure", |body| {
        body["run"]["status"] == "failed"
    })
    .await;
    assert_eq!(body["run"]["failureCode"], "workspace_unavailable");
    assert_eq!(body["steps"][0]["status"], "failed");
    assert_eq!(body["steps"][0]["failureCode"], "workspace_unavailable");
    // No session was ever created.
    assert!(body["run"].get("sessionId").is_none());
    assert_eq!(session_count(&state), 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retired_and_mutation_blocked_workspaces_fail_workspace_unavailable() {
    // Ruling C2A-DEC-01: access-gate refusals (retired, mutation-blocked) are
    // "unavailable supplied workspace", not generic creation failures.
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };

    // Retired workspace.
    let retired_ws = "30000000-0000-4000-8000-000000000031";
    test_support::seed_workspace_with_repo_root(
        &state.db,
        retired_ws,
        "worktree",
        "/tmp/wf-retired",
    );
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces SET lifecycle_state = 'retired' WHERE id = ?1",
                [retired_ws],
            )
        })
        .expect("retire workspace");
    let retired_run = uuid::Uuid::new_v4().to_string();
    let (status, _) = put(
        &state,
        &retired_run,
        body_for_workspace(retired_ws, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let body = poll_run_until(&state, &retired_run, "retired-workspace failure", |body| {
        body["run"]["status"] == "failed"
    })
    .await;
    assert_eq!(body["run"]["failureCode"], "workspace_unavailable");

    // Mutation-blocked workspace (frozen for handoff).
    let blocked_ws = "30000000-0000-4000-8000-000000000032";
    test_support::seed_workspace_with_repo_root(
        &state.db,
        blocked_ws,
        "worktree",
        "/tmp/wf-blocked",
    );
    WorkspaceAccessStore::new(state.db.clone())
        .upsert(&WorkspaceAccessRecord {
            workspace_id: blocked_ws.to_string(),
            mode: WorkspaceAccessMode::FrozenForHandoff,
            handoff_op_id: None,
            updated_at: "2026-07-13T00:00:00Z".to_string(),
        })
        .expect("block workspace mutation");
    let blocked_run = uuid::Uuid::new_v4().to_string();
    let (status, _) = put(
        &state,
        &blocked_run,
        body_for_workspace(blocked_ws, Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let body = poll_run_until(&state, &blocked_run, "blocked-workspace failure", |body| {
        body["run"]["status"] == "failed"
    })
    .await;
    assert_eq!(body["run"]["failureCode"], "workspace_unavailable");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_workspace_with_unsupported_model_fails_session_create_failed() {
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let workspace_id = "30000000-0000-4000-8000-000000000033";
    test_support::seed_workspace_with_repo_root(
        &state.db,
        workspace_id,
        "worktree",
        "/tmp/wf-model",
    );
    let run_id = uuid::Uuid::new_v4().to_string();

    let (status, _) = put(
        &state,
        &run_id,
        body_for_workspace(workspace_id, json!("definitely-not-a-real-model")),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let body = poll_run_until(&state, &run_id, "session_create_failed", |body| {
        body["run"]["status"] == "failed"
    })
    .await;
    assert_eq!(body["run"]["failureCode"], "session_create_failed");
    assert_eq!(body["steps"][0]["failureCode"], "session_create_failed");
    assert!(body["run"].get("sessionId").is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn startup_failure_keeps_session_checkpoint_and_replay_has_zero_effects() {
    // Creation succeeds against a controlled READY agent fixture (grok: no
    // native binary requirement; the ACP program override points at a stub
    // that exits immediately, and the xai credential rides the runtime-home
    // secret env). Startup then fails deterministically because the stub
    // process dies before the ACP handshake. Spec §6.1: the run keeps
    // workspace_id AND session_id, both rows become session_start_failed, and
    // the session row stays inspectable.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let runtime_home = PathBuf::from(format!("/tmp/anyharness-workflow-startfail-{unique}"));
    std::fs::create_dir_all(runtime_home.join("secrets")).expect("create runtime home");
    std::fs::write(
        runtime_home.join("secrets/global.env"),
        "XAI_API_KEY=test-not-a-real-key\n",
    )
    .expect("write secret env");
    let stub_agent = runtime_home.join("grok-acp-stub");
    std::fs::write(&stub_agent, "#!/bin/sh\nexit 0\n").expect("write stub agent");
    crate::integrations::agent_cli::executable::make_executable(&stub_agent)
        .expect("make stub agent executable");
    struct ProgramEnvGuard {
        previous: Option<std::ffi::OsString>,
    }
    impl Drop for ProgramEnvGuard {
        fn drop(&mut self) {
            match self.previous.take() {
                Some(value) => std::env::set_var("ANYHARNESS_GROK_AGENT_PROGRAM", value),
                None => std::env::remove_var("ANYHARNESS_GROK_AGENT_PROGRAM"),
            }
        }
    }
    let _program_guard = ProgramEnvGuard {
        previous: std::env::var_os("ANYHARNESS_GROK_AGENT_PROGRAM"),
    };
    std::env::set_var("ANYHARNESS_GROK_AGENT_PROGRAM", &stub_agent);

    {
        let state = AppState::new(
            runtime_home.clone(),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("in-memory db"),
            false,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state");
        let workspace_id = "30000000-0000-4000-8000-000000000034";
        let workspace_dir = runtime_home.join("workspace");
        std::fs::create_dir_all(&workspace_dir).expect("create workspace dir");
        test_support::seed_workspace_with_repo_root(
            &state.db,
            workspace_id,
            "worktree",
            workspace_dir.to_str().expect("utf-8 workspace path"),
        );
        let run_id = uuid::Uuid::new_v4().to_string();
        let mut request_body = body_for_workspace(workspace_id, Value::Null);
        request_body["definition"]["stages"][0]["harnessConfig"]["agentKind"] = json!("grok");

        let (status, _) = put(&state, &run_id, request_body.clone()).await;
        assert_eq!(status, StatusCode::CREATED);

        let body = poll_run_until(&state, &run_id, "session_start_failed", |body| {
            body["run"]["status"] == "failed"
        })
        .await;
        assert_eq!(body["run"]["failureCode"], "session_start_failed");
        assert_eq!(body["steps"][0]["failureCode"], "session_start_failed");
        assert_eq!(body["run"]["workspaceId"], workspace_id);

        // The session checkpoint survived the startup failure.
        let session_id = body["run"]["sessionId"]
            .as_str()
            .expect("session_id persisted before startup")
            .to_string();
        let session = state
            .session_service
            .get_session(&session_id)
            .expect("load session")
            .expect("session row inspectable after startup failure");
        assert_eq!(session.workspace_id, workspace_id);

        // Replay of the identical PUT after terminal failure: 200, byte-stable
        // rows, zero new effects (no second session).
        let sessions_before = session_count(&state);
        assert_eq!(sessions_before, 1);
        let (replay_status, replay_body) = put(&state, &run_id, request_body).await;
        assert_eq!(replay_status, StatusCode::OK);
        assert_eq!(replay_body, body, "replay must not mutate durable rows");
        assert_eq!(session_count(&state), sessions_before);
        let (_, after) = get(&state, &run_id).await;
        assert_eq!(after, body);
    }

    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn extension_completion_terminalizes_run_and_step() {
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    // Drive a run to a running step over the same database the extension's
    // service sees, then hand a matching turn completion to the extension.
    let service = Arc::new(WorkflowRunService::new(WorkflowRunStore::new(
        state.db.clone(),
    )));
    let run_id = uuid::Uuid::new_v4().to_string();
    let session_id = "workflow-ext-session-1";
    service
        .accept(
            &run_id,
            domain_input_for_workspace("30000000-0000-4000-8000-000000000035"),
        )
        .expect("accept");
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, session_id)
        .expect("bind_session"));
    assert!(service.begin_step(&run_id).expect("begin_step"));

    let extension =
        WorkflowRunSessionExtension::new(service.clone(), tokio::runtime::Handle::current());
    let workspace = WorkspaceRecord {
        id: "30000000-0000-4000-8000-000000000035".to_string(),
        kind: WorkspaceKind::Worktree,
        repo_root_id: "repo-root-ext".to_string(),
        path: "/tmp/wf-ext".to_string(),
        surface: WorkspaceSurface::Standard,
        original_branch: None,
        current_branch: None,
        display_name: None,
        origin: None,
        creator_context: None,
        lifecycle_state: WorkspaceLifecycleState::Active,
        cleanup_state: WorkspaceCleanupState::None,
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: "2026-07-13T00:00:00Z".to_string(),
        updated_at: "2026-07-13T00:00:00Z".to_string(),
    };
    extension.on_turn_finished(SessionTurnFinishedContext {
        workspace,
        session_id: session_id.to_string(),
        turn_id: "turn-ext-1".to_string(),
        prompt_id: Some(workflow_prompt_id(&run_id)),
        outcome: SessionTurnOutcome::Completed,
        stop_reason: Some("end_turn".to_string()),
        last_event_seq: 7,
        error_details: None,
    });

    let body = poll_run_until(&state, &run_id, "extension-driven completion", |body| {
        body["run"]["status"] == "completed"
    })
    .await;
    assert_eq!(body["steps"][0]["status"], "completed");
    assert_eq!(body["steps"][0]["turnId"], "turn-ext-1");
    assert_eq!(body["run"]["sessionId"], session_id);
    assert!(body["run"].get("failureCode").is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn fencing_failure_aborts_app_state_construction() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let db = Db::open_in_memory().expect("in-memory db");
    // Break the fence's coupled transaction: the steps table no longer exists.
    db.with_conn(|conn| {
        conn.execute(
            "ALTER TABLE workflow_run_steps RENAME TO workflow_run_steps_broken",
            [],
        )
    })
    .expect("break workflow steps table");

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-workflow-fence-fail"),
        "http://127.0.0.1:8457".to_string(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("fencing failure must abort AppState");
    assert!(
        matches!(error, AppStateInitError::WorkflowFencingFailed(_)),
        "unexpected init error: {error}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_put_future_never_orphans_an_accepted_run() {
    // Review C2A-REV-01: the acceptance -> execution handoff must survive the
    // HTTP future being dropped mid-request. The put future is polled exactly
    // once with a no-op waker — enough to detach the accept+schedule handoff
    // onto the main runtime — and then dropped, never polled again (exactly a
    // dropped HTTP request). Under the pre-fix implementation the accept
    // spawn_blocking still committed the run but the dropped future skipped
    // execution scheduling, orphaning the run at `accepted`; this test then
    // times out waiting for a terminal state.
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let run_id = uuid::Uuid::new_v4().to_string();
    let input = domain_input_for_workspace("99999999-9999-4999-8999-999999999998");

    {
        let runtime = state.workflow_run_runtime.clone();
        let put_run_id = run_id.clone();
        let mut put_future = Box::pin(async move {
            runtime
                .put(put_run_id, VersionedPutWorkflowRunInput::V1(input))
                .await
        });
        let waker = std::task::Waker::noop();
        let mut context = std::task::Context::from_waker(waker);
        // One poll spawns the detached handoff; the no-op waker guarantees the
        // future is never polled again before it is dropped below.
        let first_poll = std::future::Future::poll(put_future.as_mut(), &mut context);
        assert!(
            first_poll.is_pending(),
            "put must not complete synchronously on its first poll"
        );
    }

    // The detached handoff must still commit the run AND schedule execution:
    // with a nonexistent workspace it terminalizes as workspace_unavailable.
    let body = poll_run_until(&state, &run_id, "detached handoff completion", |body| {
        body["run"]["status"] == "failed"
    })
    .await;
    assert_eq!(body["run"]["failureCode"], "workspace_unavailable");
}

// ---------------------------------------------------------------------------
// Admission tests (review C2A-REV-06): worker bearer + direct-attach posture.
// ---------------------------------------------------------------------------

async fn request_with_token(
    state: &AppState,
    method: &str,
    uri: &str,
    body: Option<Value>,
    token: Option<&str>,
) -> StatusCode {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let request = builder
        .body(match body {
            Some(body) => Body::from(body.to_string()),
            None => Body::empty(),
        })
        .expect("request");
    build_router(state.clone())
        .oneshot(request)
        .await
        .expect("response")
        .status()
}

#[tokio::test]
async fn workflow_routes_require_worker_bearer_when_configured() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(Some("secret-token"));
    let state = {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("unix timestamp")
            .as_nanos();
        AppState::new(
            PathBuf::from(format!("/tmp/anyharness-workflow-auth-{unique}")),
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("in-memory db"),
            true,
            AgentSeedStore::not_configured_dev(),
        )
        .expect("app state")
    };
    let uri = format!("/v1/workflow-runs/{RUN_ID}");

    // Missing token -> 401 on both methods.
    assert_eq!(
        request_with_token(&state, "GET", &uri, None, None).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request_with_token(&state, "PUT", &uri, Some(valid_body()), None).await,
        StatusCode::UNAUTHORIZED
    );

    // Wrong token -> 401.
    assert_eq!(
        request_with_token(&state, "GET", &uri, None, Some("wrong-token")).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request_with_token(&state, "PUT", &uri, Some(valid_body()), Some("wrong-token")).await,
        StatusCode::UNAUTHORIZED
    );

    // Correct worker bearer is admitted through to the handler: an unknown but
    // canonical run id proves the handler ran (404, not 401/403).
    assert_eq!(
        request_with_token(&state, "GET", &uri, None, Some("secret-token")).await,
        StatusCode::NOT_FOUND
    );
}

#[test]
fn direct_attach_user_claims_cannot_reach_workflow_routes() {
    // user_route_allowed has no workflow-runs arm: any direct-attach user
    // claim is refused with UnsupportedRoute (-> 403
    // DIRECT_ATTACH_ROUTE_FORBIDDEN at the router), even with full
    // permissions. Pins the route out of the direct-attach allowlist.
    let claim = UserClaimAuth {
        user_id: "user-1".to_string(),
        organization_id: "org-1".to_string(),
        target_id: "target-1".to_string(),
        cloud_workspace_id: "cloud-workspace-1".to_string(),
        anyharness_workspace_id: "20000000-0000-4000-8000-000000000002".to_string(),
        cloud_session_id: None,
        anyharness_session_id: None,
        claim_id: "claim-1".to_string(),
        permissions: ClaimPermissions {
            read: true,
            write: true,
            control: true,
        },
        jti: "jti-1".to_string(),
        expires_at: i64::MAX,
    };
    let path = format!("/v1/workflow-runs/{RUN_ID}");
    assert!(matches!(
        user_route_allowed(&Method::PUT, &path, &claim),
        Err(AuthError::UnsupportedRoute)
    ));
    assert!(matches!(
        user_route_allowed(&Method::GET, &path, &claim),
        Err(AuthError::UnsupportedRoute)
    ));
}
