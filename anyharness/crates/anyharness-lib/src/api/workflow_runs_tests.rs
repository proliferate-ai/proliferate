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

    let extension = WorkflowRunSessionExtension::new(
        service.clone(),
        Arc::new(crate::domains::workflows::control::WorkflowRunGates::new()),
        tokio::runtime::Handle::current(),
    );
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

// ---------------------------------------------------------------------------
// Run-control HTTP tests (spec workflow-run-control §3/§5/§6, proof §11):
// the cancel route matrix, truthful snapshots, wire field pinning,
// direct-attach exclusion, the dropped-awaiter handoff, and the live
// cancel/execution race over the real router and real SQLite.
// ---------------------------------------------------------------------------

use crate::domains::workflows::service::WorkflowRunService as ControlWorkflowRunService;
use crate::domains::workflows::store::WorkflowRunStore as ControlWorkflowRunStore;

async fn post_cancel(state: &AppState, run_id: &str) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/workflow-runs/{run_id}/cancel"))
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

/// A service handle over the SAME database as the state, for driving durable
/// rows without scheduling execution.
fn control_service(state: &AppState) -> Arc<ControlWorkflowRunService> {
    Arc::new(ControlWorkflowRunService::new(
        ControlWorkflowRunStore::new(state.db.clone()),
    ))
}

#[tokio::test]
async fn cancel_route_matrix_and_truthful_snapshots() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    // Noncanonical UUID -> coded 400.
    let (status, body) = post_cancel(&state, "not-a-uuid").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Unknown run -> 404.
    let (status, body) = post_cancel(&state, "22222222-2222-4222-8222-222222222222").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKFLOW_RUN_NOT_FOUND");

    // Accepted run (no execution scheduled): first cancel terminalizes
    // pre-dispatch as cancelled and acknowledges durable intent.
    let service = control_service(&state);
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(
            &run_id,
            domain_input_for_workspace("99999999-9999-4999-8999-999999999997"),
        )
        .expect("accept");
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "cancelled");
    assert_eq!(body["steps"][0]["status"], "cancelled");
    assert_eq!(body["run"]["stateVersion"], 2);
    assert!(body["run"]["cancelRequestedAt"].is_string());
    assert!(body["run"].get("failureCode").is_none());
    assert!(body["run"].get("interruptionCode").is_none());
    assert!(body["steps"][0].get("failureCode").is_none());
    let first_requested_at = body["run"]["cancelRequestedAt"].clone();
    let first_updated_at = body["run"]["updatedAt"].clone();

    // Terminal repeat: unchanged 200 with the same version and timestamps.
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "cancelled");
    assert_eq!(body["run"]["stateVersion"], 2);
    assert_eq!(body["run"]["cancelRequestedAt"], first_requested_at);
    assert_eq!(body["run"]["updatedAt"], first_updated_at);

    // GET mirrors the truthful snapshot.
    let (status, body) = get(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "cancelled");
}

#[tokio::test]
async fn cancel_of_a_running_null_turn_step_is_intent_only_over_http() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let service = control_service(&state);
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(
            &run_id,
            domain_input_for_workspace("99999999-9999-4999-8999-999999999996"),
        )
        .expect("accept");
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, "sess-http-null")
        .expect("bind"));
    assert!(service.begin_step(&run_id).expect("begin_step"));

    // The bound session is not live: the live-cancel attempt reports NotLive
    // internally and the snapshot stays truthfully running + requested.
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert_eq!(body["steps"][0]["status"], "running");
    assert!(body["run"]["cancelRequestedAt"].is_string());
    let version = body["run"]["stateVersion"].as_i64().expect("version");

    // Repeat re-attempts the live cancel but does not increment.
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["run"]["stateVersion"].as_i64().expect("version"),
        version
    );
}

#[test]
fn cancel_route_is_excluded_from_direct_attach() {
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
    let path = format!("/v1/workflow-runs/{RUN_ID}/cancel");
    assert!(matches!(
        user_route_allowed(&Method::POST, &path, &claim),
        Err(AuthError::UnsupportedRoute)
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropped_cancel_awaiter_never_orphans_the_handoff() {
    // Same one-poll-drop proof as PUT: the intent-CAS -> live-request ->
    // final-snapshot sequence rides a detached task.
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let service = control_service(&state);
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(
            &run_id,
            domain_input_for_workspace("99999999-9999-4999-8999-999999999995"),
        )
        .expect("accept");

    {
        let runtime = state.workflow_run_runtime.clone();
        let cancel_run_id = run_id.clone();
        let mut cancel_future = Box::pin(async move { runtime.cancel(cancel_run_id).await });
        let waker = std::task::Waker::noop();
        let mut context = std::task::Context::from_waker(waker);
        let first_poll = std::future::Future::poll(cancel_future.as_mut(), &mut context);
        assert!(
            first_poll.is_pending(),
            "cancel must not complete synchronously on its first poll"
        );
    }

    let body = poll_run_until(&state, &run_id, "detached cancel handoff", |body| {
        body["run"]["status"] == "cancelled"
    })
    .await;
    assert!(body["run"]["cancelRequestedAt"].is_string());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_races_execution_to_exactly_one_truthful_terminal_state() {
    // PUT schedules real execution against a nonexistent workspace while
    // cancel races it through the shared per-run gate: exactly one truthful
    // terminal outcome wins — cancelled (cancel won a pre-dispatch boundary)
    // or failed/workspace_unavailable (execution's classification won).
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let run_id = uuid::Uuid::new_v4().to_string();
    let (status, _) = put(
        &state,
        &run_id,
        body_for_workspace("99999999-9999-4999-8999-999999999994", Value::Null),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (cancel_status, _) = post_cancel(&state, &run_id).await;
    assert_eq!(cancel_status, StatusCode::OK);

    let body = poll_run_until(&state, &run_id, "raced terminal state", |body| {
        body["run"]["status"] == "cancelled" || body["run"]["status"] == "failed"
    })
    .await;
    match body["run"]["status"].as_str().expect("status") {
        "cancelled" => {
            assert!(body["run"].get("failureCode").is_none());
            assert_eq!(body["steps"][0]["status"], "cancelled");
        }
        "failed" => {
            assert_eq!(body["run"]["failureCode"], "workspace_unavailable");
        }
        other => panic!("unexpected terminal status {other}"),
    }
}

#[tokio::test]
async fn live_turn_cancel_seam_reports_not_live_for_a_dead_session() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let outcome = state
        .session_runtime
        .request_live_turn_cancel("no-such-session", "turn-x")
        .await;
    assert_eq!(
        outcome,
        crate::domains::sessions::runtime::LiveTurnCancelOutcome::NotLive
    );
}

#[test]
fn openapi_documents_run_control_fields_and_cancel_route() {
    let doc: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("parse openapi document");
    // stateVersion required on BOTH families; control fields optional.
    for schema_name in ["WorkflowRun", "WorkflowRunV2"] {
        let schema = &doc["components"]["schemas"][schema_name];
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap_or_else(|| panic!("{schema_name} required array"))
            .iter()
            .map(|value| value.as_str().expect("required entry"))
            .collect();
        assert!(
            required.contains(&"stateVersion"),
            "{schema_name}: {required:?}"
        );
        assert!(!required.contains(&"cancelRequestedAt"), "{schema_name}");
        assert!(!required.contains(&"interruptionCode"), "{schema_name}");
    }
    // Widened shared status vocabularies.
    let run_statuses = doc["components"]["schemas"]["WorkflowRunStatus"]["enum"]
        .as_array()
        .expect("run status enum")
        .iter()
        .map(|value| value.as_str().expect("status"))
        .collect::<Vec<_>>();
    for status in [
        "accepted",
        "running",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ] {
        assert!(run_statuses.contains(&status), "{run_statuses:?}");
    }
    let step_statuses = doc["components"]["schemas"]["WorkflowRunStepStatus"]["enum"]
        .as_array()
        .expect("step status enum")
        .iter()
        .map(|value| value.as_str().expect("status"))
        .collect::<Vec<_>>();
    for status in [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ] {
        assert!(step_statuses.contains(&status), "{step_statuses:?}");
    }
    assert_eq!(
        doc["components"]["schemas"]["WorkflowRunInterruptionCode"]["enum"],
        json!(["runtime_restarted"])
    );
    // The cancel route exists with the frozen result matrix.
    let cancel = &doc["paths"]["/v1/workflow-runs/{run_id}/cancel"]["post"];
    assert!(cancel.is_object(), "cancel route documented");
    for code in ["200", "400", "404", "500"] {
        assert!(cancel["responses"][code].is_object(), "cancel {code}");
    }
}

#[tokio::test]
async fn interrupted_fencing_is_visible_on_the_wire() {
    // A nonterminal run in the database at AppState construction is fenced to
    // interrupted/runtime_restarted with one increment, visible via GET.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let db = Db::open_in_memory().expect("in-memory db");
    let seed_service = Arc::new(ControlWorkflowRunService::new(
        ControlWorkflowRunStore::new(db.clone()),
    ));
    let run_id = uuid::Uuid::new_v4().to_string();
    seed_service
        .accept(
            &run_id,
            domain_input_for_workspace("99999999-9999-4999-8999-999999999993"),
        )
        .expect("accept");

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let state = AppState::new(
        PathBuf::from(format!("/tmp/anyharness-workflow-fence-wire-{unique}")),
        "http://127.0.0.1:8457".to_string(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state fences at construction");

    let (status, body) = get(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "interrupted");
    assert_eq!(body["run"]["interruptionCode"], "runtime_restarted");
    assert_eq!(body["run"]["stateVersion"], 2);
    assert_eq!(body["steps"][0]["status"], "interrupted");
    assert!(body["run"].get("failureCode").is_none());
    assert!(body["steps"][0].get("failureCode").is_none());
}

// ── PROOF-01 production-path battery (review PR1196-PROOF-01) ─────────────
//
// The first two tests run the REAL execution task (`execute_for_test` is the
// production `execution::execute`) against a launch-ready grok fixture (the
// same READY-agent pattern as the startup-failure test: stub ACP program +
// runtime-home xai credential) and a scripted live session handle — the
// manager's startup path reuses a pre-registered handle, so session creation,
// startup, v2 effort application, the gated recheck, and prompt acceptance all
// traverse their production seams with no agent process. Narrow keyed
// barriers park the executor at frozen points and observe the exact recheck
// and cancel-gate traversals. Every wait is bounded and dumps the durable run
// snapshot on expiry.

use crate::domains::workflows::{execute_for_test, test_barriers};
use crate::live::sessions::{ScriptedSessionEvent, ScriptedSessionSpec};

const PROOF_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

/// Await with a hard deadline; on expiry, panic with the durable run snapshot
/// so an early executor abort reports its terminal state instead of wedging.
async fn within<T>(
    state: &AppState,
    run_id: &str,
    label: &str,
    fut: impl std::future::Future<Output = T>,
) -> T {
    match tokio::time::timeout(PROOF_WAIT, fut).await {
        Ok(value) => value,
        Err(_elapsed) => {
            let (_, body) = get(state, run_id).await;
            panic!("timed out waiting for {label}; durable run snapshot: {body}");
        }
    }
}

struct GrokProgramEnvGuard {
    previous: Option<std::ffi::OsString>,
}

impl Drop for GrokProgramEnvGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("ANYHARNESS_GROK_AGENT_PROGRAM", value),
            None => std::env::remove_var("ANYHARNESS_GROK_AGENT_PROGRAM"),
        }
    }
}

/// Launch-ready fixture: an isolated runtime home carrying the xai credential
/// and a stub grok ACP program (never actually spawned here — startup reuses
/// the scripted handle), plus a real workspace directory. Returns the state,
/// the seeded workspace id, and guards that restore env/cleanup on drop.
fn grok_launch_fixture(tag: &str) -> (AppState, &'static str, PathBuf, GrokProgramEnvGuard) {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    let runtime_home = PathBuf::from(format!("/tmp/anyharness-proof01-{tag}-{unique}"));
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
    let program_guard = GrokProgramEnvGuard {
        previous: std::env::var_os("ANYHARNESS_GROK_AGENT_PROGRAM"),
    };
    std::env::set_var("ANYHARNESS_GROK_AGENT_PROGRAM", &stub_agent);

    let state = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    const WS: &str = "40000000-0000-4000-8000-000000000044";
    let workspace_dir = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_dir).expect("create workspace dir");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WS,
        "worktree",
        workspace_dir.to_str().expect("utf-8 workspace path"),
    );
    (state, WS, runtime_home, program_guard)
}

/// Accept a grok run over the real service and hand back the production
/// execution plan for `execute_for_test`, with the caller-chosen effort.
fn accepted_grok_plan(
    service: &Arc<ControlWorkflowRunService>,
    workspace_id: &str,
    effort: Option<crate::domains::workflows::model::WorkflowResolvedEffortConfig>,
) -> crate::domains::workflows::service::WorkflowExecutionPlan {
    let run_id = uuid::Uuid::new_v4().to_string();
    let mut input = domain_input_for_workspace(workspace_id);
    input.definition.stages[0].harness_config.agent_kind = "grok".to_string();
    match service.accept(&run_id, input).expect("accept") {
        crate::domains::workflows::service::AcceptOutcome::Created { mut plan, .. } => {
            plan.effort_config = effort;
            plan
        }
        other => panic!("fresh run was not created: {other:?}"),
    }
}

/// Drive a run to the post-`bind_session` boundary — the window in which the
/// execution task is starting the session or applying effort, holding NO run
/// gate (spec §6.2 releases it across startup/effort).
fn run_in_effort_window(
    service: &Arc<ControlWorkflowRunService>,
    workspace_id: &str,
    session_id: &str,
) -> String {
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(&run_id, domain_input_for_workspace(workspace_id))
        .expect("accept");
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, session_id)
        .expect("bind_session"));
    run_id
}

/// Drain any late scripted events for a bounded window and fail on prompts.
async fn assert_no_prompt_dispatched(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<ScriptedSessionEvent>,
) {
    loop {
        match tokio::time::timeout(std::time::Duration::from_millis(200), events.recv()).await {
            Err(_elapsed) => return,
            Ok(None) => return,
            Ok(Some(ScriptedSessionEvent::Prompt { prompt_id })) => {
                panic!("prompt dispatched after cancellation won: {prompt_id:?}")
            }
            Ok(Some(_other)) => continue,
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_during_real_effort_application_prevents_dispatch() {
    // The REAL execution task runs to v2 effort application against the
    // launch-ready fixture; the scripted session holds the SetConfigOption
    // reply, so the cancel request lands while production effort application
    // is in flight. The executor's own post-effort recheck must then observe
    // the cancelled run (pinned via the recheck barrier), and no prompt may
    // ever be dispatched.
    //
    // ENV_MUTEX is held for the WHOLE test (like the startup-failure test):
    // the grok program override is process-global, and another test dropping
    // its guard mid-flight would un-ready the agent under this executor.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("effort");
    let service = control_service(&state);
    let plan = accepted_grok_plan(
        &service,
        ws,
        Some(
            crate::domains::workflows::model::WorkflowResolvedEffortConfig {
                config_id: "effort".to_string(),
                value: "high".to_string(),
            },
        ),
    );
    let run_id = plan.run_id.clone();

    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    let (recheck_tx, recheck_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            recheck_tx: Some(recheck_tx),
            ..Default::default()
        },
    );

    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        plan,
    ));

    // The executor bound a real created session; register the scripted live
    // handle for it BEFORE startup so startup reuses it.
    let session_id = within(&state, &run_id, "session bound", session_bound_rx)
        .await
        .expect("session bound sender retained");
    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-effort-should-never-exist".to_string(),
                hold_config_replies: true,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");

    // Production effort application is now in flight: the scripted session
    // received the real SetConfigOption and is holding its reply.
    match within(
        &state,
        &run_id,
        "effort config event",
        scripted.events.recv(),
    )
    .await
    .expect("config event")
    {
        ScriptedSessionEvent::Config { config_id, value } => {
            assert_eq!(config_id, "effort");
            assert_eq!(value, "high");
        }
        other => panic!("expected effort application first, got {other:?}"),
    }

    // Cancel lands inside the effort window (gate not held by the executor).
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "cancelled");
    assert_eq!(body["steps"][0]["status"], "cancelled");
    assert!(body["run"]["cancelRequestedAt"].is_string());
    let cancelled_version = body["run"]["stateVersion"].as_i64().expect("version");

    // Release the held effort reply: the executor proceeds to ITS OWN
    // post-effort recheck under the reacquired gate. The recheck barrier pins
    // that the exact production check ran and observed the cancelled run;
    // deleting or reordering it fails this wait or its value.
    scripted.release.notify_one();
    let recheck_observed = within(&state, &run_id, "post-effort recheck", recheck_rx)
        .await
        .expect("recheck sender retained");
    assert!(
        !recheck_observed,
        "the post-effort recheck must observe the cancelled run"
    );
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");
    assert_no_prompt_dispatched(&mut scripted.events).await;

    let (status, body) = get(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "cancelled");
    assert_eq!(
        body["run"]["stateVersion"].as_i64(),
        Some(cancelled_version)
    );
    assert_eq!(body["steps"][0]["status"], "cancelled");
    assert!(body["steps"][0].get("turnId").is_none());

    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_races_real_dispatch_and_loses_to_the_held_gate() {
    // The REAL execution task is parked under the final dispatch gate, after
    // its recheck and step CAS, immediately before real prompt acceptance. A
    // concurrent HTTP cancel signals the cancel-gate barrier (it has reached
    // the production gate) BEFORE dispatch is released; the executor then
    // performs the real dispatch (real send_text_prompt_with_id -> scripted
    // Started -> real record_turn) and releases the gate, and the same cancel
    // lands as truthful running + intent against the recorded turn. If real
    // prompt acceptance moved outside the run gate, the parked cancel would
    // complete first and its snapshot would carry a null turn — failing the
    // turn assertions deterministically, with no timing sleeps involved.
    //
    // ENV_MUTEX is held for the WHOLE test (like the startup-failure test):
    // the grok program override is process-global, and another test dropping
    // its guard mid-flight would un-ready the agent under this executor.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("dispatch");
    let service = control_service(&state);
    let plan = accepted_grok_plan(&service, ws, None);
    let run_id = plan.run_id.clone();
    let prompt_id = plan.prompt_id.clone();

    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    let (pre_dispatch_tx, pre_dispatch_rx) = tokio::sync::oneshot::channel();
    let (resume_dispatch_tx, resume_dispatch_rx) = tokio::sync::oneshot::channel();
    let (cancel_gate_tx, cancel_gate_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            recheck_tx: None,
            pre_dispatch_tx: Some(pre_dispatch_tx),
            resume_dispatch_rx: Some(resume_dispatch_rx),
            cancel_gate_tx: Some(cancel_gate_tx),
        },
    );

    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        plan,
    ));

    let session_id = within(&state, &run_id, "session bound", session_bound_rx)
        .await
        .expect("session bound sender retained");
    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-real-dispatch".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");

    // The executor is now parked INSIDE the final gate, past its recheck and
    // begin_step, before real dispatch.
    within(&state, &run_id, "pre-dispatch barrier", pre_dispatch_rx)
        .await
        .expect("pre-dispatch sender retained");

    let state_for_cancel = state.clone();
    let run_for_cancel = run_id.clone();
    let cancel_task =
        tokio::spawn(async move { post_cancel(&state_for_cancel, &run_for_cancel).await });

    // Deterministic handshake: the cancel request has reached the production
    // run gate. With the executor parked under that gate, the cancel cannot
    // have written intent yet — one snapshot proves it.
    within(
        &state,
        &run_id,
        "cancel at the production gate",
        cancel_gate_rx,
    )
    .await
    .expect("cancel gate sender retained");
    let (_, body) = get(&state, &run_id).await;
    assert_eq!(body["run"]["status"], "running");
    assert!(
        body["run"].get("cancelRequestedAt").is_none(),
        "cancel intent landed while the executor held the dispatch gate"
    );

    // Release: the executor performs the REAL dispatch and gate release.
    resume_dispatch_tx.send(()).expect("resume dispatch");
    match within(
        &state,
        &run_id,
        "real prompt dispatch",
        scripted.events.recv(),
    )
    .await
    .expect("prompt event")
    {
        ScriptedSessionEvent::Prompt { prompt_id: sent } => {
            assert_eq!(sent.as_deref(), Some(prompt_id.as_str()));
        }
        other => panic!("expected the real prompt dispatch, got {other:?}"),
    }
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");

    let (status, body) = within(&state, &run_id, "cancel join", cancel_task)
        .await
        .expect("cancel join");
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert_eq!(body["steps"][0]["status"], "running");
    assert_eq!(body["steps"][0]["turnId"], "turn-real-dispatch");
    assert!(body["run"]["cancelRequestedAt"].is_string());
    assert!(body["run"].get("failureCode").is_none());

    // The blocked cancel, once through, re-targeted the exact recorded turn.
    match within(
        &state,
        &run_id,
        "live-cancel request",
        scripted.events.recv(),
    )
    .await
    .expect("cancel event")
    {
        ScriptedSessionEvent::CancelIfActive { expected_turn_id } => {
            assert_eq!(expected_turn_id, "turn-real-dispatch");
        }
        other => panic!("expected the live-cancel request, got {other:?}"),
    }

    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repeated_cancel_recovers_after_a_missing_actor() {
    // First cancel: stored turn but no live handle -> intent only (NotLive).
    // After the actor becomes available, repeating the same cancel re-attempts
    // the live request and delivers the EXACT stored turn id, without any
    // further version increment.
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let service = control_service(&state);
    let run_id = run_in_effort_window(
        &service,
        "99999999-9999-4999-8999-999999999987",
        "sess-recover",
    );
    assert!(service.begin_step(&run_id).expect("begin_step"));
    assert!(service
        .record_turn(&run_id, "turn-recover-42")
        .expect("record_turn"));

    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert!(body["run"]["cancelRequestedAt"].is_string());
    let version = body["run"]["stateVersion"].as_i64().expect("version");

    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            "sess-recover",
            ScriptedSessionSpec {
                prompt_turn_id: "unused".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;

    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert_eq!(body["run"]["stateVersion"].as_i64(), Some(version));
    match within(
        &state,
        &run_id,
        "recovered live cancel",
        scripted.events.recv(),
    )
    .await
    .expect("cancel event")
    {
        ScriptedSessionEvent::CancelIfActive { expected_turn_id } => {
            assert_eq!(
                expected_turn_id, "turn-recover-42",
                "recovered live cancel must target the exact stored turn"
            );
        }
        other => panic!("expected a live-cancel request, got {other:?}"),
    }

    // A third repetition re-attempts again (still no increment).
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["stateVersion"].as_i64(), Some(version));
    match within(
        &state,
        &run_id,
        "repeated live cancel",
        scripted.events.recv(),
    )
    .await
    .expect("second cancel event")
    {
        ScriptedSessionEvent::CancelIfActive { expected_turn_id } => {
            assert_eq!(expected_turn_id, "turn-recover-42");
        }
        other => panic!("expected a live-cancel request, got {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn post_commit_final_read_failure_preserves_durable_intent() {
    // The cancel route's final snapshot read fails AFTER the intent CAS
    // committed: the route surfaces a 500, the durable intent survives, and
    // exact repetition succeeds once reads recover (spec §5.4).
    let state = {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        test_state()
    };
    let service = control_service(&state);
    let run_id = run_in_effort_window(
        &service,
        "99999999-9999-4999-8999-999999999986",
        "sess-read-fail",
    );
    assert!(service.begin_step(&run_id).expect("begin_step"));
    assert!(service
        .record_turn(&run_id, "turn-read-fail")
        .expect("record_turn"));

    // A held scripted handle suspends the cancel between the committed intent
    // CAS and the final read, which is the only honest injection window.
    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            "sess-read-fail",
            ScriptedSessionSpec {
                prompt_turn_id: "unused".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: true,
            },
        )
        .await;

    let state_for_cancel = state.clone();
    let run_for_cancel = run_id.clone();
    let cancel_task =
        tokio::spawn(async move { post_cancel(&state_for_cancel, &run_for_cancel).await });

    // The live-cancel request arriving proves the intent CAS has committed.
    match within(&state, &run_id, "held live cancel", scripted.events.recv())
        .await
        .expect("cancel event")
    {
        ScriptedSessionEvent::CancelIfActive { expected_turn_id } => {
            assert_eq!(expected_turn_id, "turn-read-fail");
        }
        other => panic!("expected a live-cancel request, got {other:?}"),
    }

    // Break every subsequent read, then release the held reply.
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch("ALTER TABLE workflow_runs RENAME TO workflow_runs_broken")?;
            Ok(())
        })
        .expect("hide table");
    scripted.release.notify_one();

    let (status, _body) = within(&state, &run_id, "cancel join", cancel_task)
        .await
        .expect("cancel join");
    assert_eq!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "post-commit read failure must surface as a 500, not a fabricated snapshot"
    );

    // Restore reads: the committed intent is durable and repetition is safe.
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch("ALTER TABLE workflow_runs_broken RENAME TO workflow_runs")?;
            Ok(())
        })
        .expect("restore table");

    let (status, body) = get(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert!(
        body["run"]["cancelRequestedAt"].is_string(),
        "durable intent must survive the failed final read"
    );
    let version = body["run"]["stateVersion"].as_i64().expect("version");

    scripted.release.notify_one();
    let (status, body) = post_cancel(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["status"], "running");
    assert_eq!(body["run"]["stateVersion"].as_i64(), Some(version));
    match within(
        &state,
        &run_id,
        "repeat cancel event",
        scripted.events.recv(),
    )
    .await
    .expect("repeat cancel event")
    {
        ScriptedSessionEvent::CancelIfActive { expected_turn_id } => {
            assert_eq!(expected_turn_id, "turn-read-fail");
        }
        other => panic!("expected a live-cancel request, got {other:?}"),
    }
}
