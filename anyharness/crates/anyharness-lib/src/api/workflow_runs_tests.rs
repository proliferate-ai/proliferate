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

pub(super) fn domain_input_for_workspace(workspace_id: &str) -> PutWorkflowRunInput {
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
    // The checkout must exist on disk: the internal creation seam now refuses
    // a missing checkout as workspace_unavailable before model validation, and
    // this test targets the model-unsupported → session_create_failed path.
    let workspace_dir = std::env::temp_dir().join(format!("wf-model-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&workspace_dir).expect("create workspace dir");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        workspace_id,
        "worktree",
        workspace_dir.to_str().expect("utf-8 workspace path"),
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
        Arc::new(
            crate::domains::sessions::admission::SessionMutationAdmission::new(Arc::new(
                crate::domains::sessions::admission::NoControllerPolicy,
            )),
        ),
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
        state.session_admission.clone(),
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
            pre_dispatch_tx: Some(pre_dispatch_tx),
            resume_dispatch_rx: Some(resume_dispatch_rx),
            cancel_gate_tx: Some(cancel_gate_tx),
            ..Default::default()
        },
    );

    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        state.session_admission.clone(),
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

// ── Spec 2b required proofs: real-executor admission races ────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reservation_create_bind_race_foreign_prompt_waits_then_conflicts() {
    // Spec 2b creation race: the executor holds the reservation permit from
    // BEFORE the session row exists through binding. A foreign prompt racing
    // that window must wait on the permit (never observe an unbound row) and
    // then conflict against the bound controller — no externally writable gap.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("admission-race");
    let service = control_service(&state);
    let plan = accepted_grok_plan(&service, ws, None);
    let run_id = plan.run_id.clone();

    let (reserved_tx, reserved_rx) = tokio::sync::oneshot::channel();
    let (resume_bind_tx, resume_bind_rx) = tokio::sync::oneshot::channel();
    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            reserved_tx: Some(reserved_tx),
            resume_bind_rx: Some(resume_bind_rx),
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            ..Default::default()
        },
    );

    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        state.session_admission.clone(),
        plan,
    ));

    // Executor parked: reservation permit held, durable session row created,
    // controller binding NOT yet visible.
    let session_id = within(&state, &run_id, "reserved barrier", reserved_rx)
        .await
        .expect("reserved sender retained");

    // Foreign prompt arrives inside the window: it must block on the permit.
    let foreign_state = state.clone();
    let foreign_session = session_id.clone();
    let foreign = tokio::spawn(async move {
        let response = build_router(foreign_state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/sessions/{foreign_session}/prompt"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(
                            &json!({"blocks": [{"type": "text", "text": "foreign takeover"}]}),
                        )
                        .expect("body"),
                    ))
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        (
            status,
            serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
        )
    });

    // Bounded negative: while the reservation permit is held, the foreign
    // prompt cannot complete.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !foreign.is_finished(),
        "foreign prompt completed inside the reservation window"
    );

    // Release binding; register the scripted session before startup.
    resume_bind_tx.send(()).expect("resume bind");
    let bound_session = within(&state, &run_id, "session bound", session_bound_rx)
        .await
        .expect("session bound sender retained");
    assert_eq!(bound_session, session_id);
    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-admission-race".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");

    // The foreign prompt, released from the permit, observes the controller.
    let (status, body) = within(&state, &run_id, "foreign prompt join", foreign)
        .await
        .expect("foreign join");
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // Only the OWNING workflow's dispatch reaches the session.
    match within(&state, &run_id, "workflow prompt", scripted.events.recv())
        .await
        .expect("prompt event")
    {
        ScriptedSessionEvent::Prompt { prompt_id } => {
            assert_eq!(
                prompt_id.as_deref(),
                Some(format!("workflow:{run_id}:0:0").as_str())
            );
        }
        other => panic!("expected the workflow prompt, got {other:?}"),
    }
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");

    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_release_restores_ordinary_session_behavior() {
    // Spec 2b terminal race: while the run is nonterminal every foreign
    // execution mutation conflicts; after the REAL workflow cancel
    // terminalizes the run (terminal CAS under run gate + session permit),
    // ordinary session behavior resumes for the same session.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("admission-release");
    let service = control_service(&state);
    let plan = accepted_grok_plan(&service, ws, None);
    let run_id = plan.run_id.clone();

    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            ..Default::default()
        },
    );
    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        state.session_admission.clone(),
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
                prompt_turn_id: "turn-admission-release".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");

    // Consume the workflow's own dispatch.
    match within(&state, &run_id, "workflow prompt", scripted.events.recv())
        .await
        .expect("prompt event")
    {
        ScriptedSessionEvent::Prompt { .. } => {}
        other => panic!("expected the workflow prompt, got {other:?}"),
    }
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");

    // Controlled: foreign config mutation conflicts.
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/sessions/{session_id}/config-options"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"configId": "effort", "value": "low"}))
                        .expect("body"),
                ))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::CONFLICT);

    // REAL workflow cancel terminalizes (cancel-intent under gate + permit;
    // live cancel via the trusted seam; correlated terminal via scripted
    // CancelIfActive -> extension is not in play here, so terminal comes from
    // the pending/running truth: the run stays running+intent until the
    // correlated outcome — instead prove release via the pre-dispatch cancel
    // path on a SECOND run is out of scope; here we terminalize by the
    // documented direct session-cancel evidence path being unavailable, so
    // use fail_nonterminal through the service (a terminal CAS the runtime
    // owns) and assert ordinary behavior resumes.
    service
        .fail_nonterminal(
            &run_id,
            crate::domains::workflows::model::WorkflowRunFailureCode::SessionTurnFailed,
        )
        .expect("terminalize");

    let (status, _body) = get(&state, &run_id).await;
    assert_eq!(status, StatusCode::OK);

    // Released: the same foreign config mutation is admitted and reaches the
    // scripted session.
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/sessions/{session_id}/config-options"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({"configId": "effort", "value": "low"}))
                        .expect("body"),
                ))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_ne!(
        response.status(),
        StatusCode::CONFLICT,
        "terminal workflow must release execution control"
    );
    match within(&state, &run_id, "released config", scripted.events.recv())
        .await
        .expect("config event")
    {
        ScriptedSessionEvent::Config { config_id, value } => {
            assert_eq!(config_id, "effort");
            assert_eq!(value, "low");
        }
        other => panic!("expected released config mutation, got {other:?}"),
    }

    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

// ── PR1227-WORKSPACE-FENCE-01: destruction vs. late-bound workflow session ──
//
// The workspace-wide destructive paths admit the CURRENT session set up front,
// but the real executor creates+binds a FRESH preselected session while holding
// only the shared SessionStart lease (execution.rs step 2 -> step 3). That
// session id is absent from the up-front admission snapshot, so its keyed
// permit is never held. The under-exclusive-lease re-check
// (`find_workflow_controlled_session`) is the fence: after the destructive path
// holds the exclusive workspace lease — which excludes the shared SessionStart
// lease every workflow session creation needs — it re-enumerates and fails
// closed if a workflow now controls a session. These two proofs drive the REAL
// executor and the REAL router (purge) / real handler (retire), placing the
// destructive path deterministically INSIDE the stale-snapshot window with
// barriers (no sleeps for correctness), and assert the destructive path
// conflicts before any effect and the session+workspace survive.

async fn delete_workspace(state: &AppState, workspace_id: &str) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/v1/workspaces/{workspace_id}"))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    (
        status,
        serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn purge_fails_closed_against_session_bound_after_admission_snapshot() {
    // ENV_MUTEX held for the WHOLE body: the grok program override is
    // process-global and a sibling guard-drop would un-ready the agent
    // mid-creation.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("fence-purge");
    let service = control_service(&state);
    let plan = accepted_grok_plan(&service, ws, None);
    let run_id = plan.run_id.clone();

    // Park the executor right after it holds the shared SessionStart lease and
    // BEFORE it creates its session — the exact window the up-front admission
    // snapshot runs in with the workflow session not yet existing.
    let (lease_tx, lease_rx) = tokio::sync::oneshot::channel();
    let (resume_create_tx, resume_create_rx) = tokio::sync::oneshot::channel();
    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            session_start_lease_tx: Some(lease_tx),
            resume_create_rx: Some(resume_create_rx),
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            ..Default::default()
        },
    );
    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        state.session_admission.clone(),
        plan,
    ));

    // Park purge at its pre-exclusive-lease seam: this fires reached_tx once the
    // up-front admit_all_workspace_sessions snapshot has fully returned (empty of
    // the not-yet-created workflow session) and BEFORE the purge service takes
    // the exclusive workspace lease and runs the under-lease fence. This gives us
    // a DETERMINISTIC ordering signal (no sleep) that the snapshot completed
    // before workflow creation resumes.
    use crate::api::http::workspaces_purge::purge_barriers;
    let (purge_reached_tx, purge_reached_rx) = tokio::sync::oneshot::channel();
    let (purge_resume_tx, purge_resume_rx) = tokio::sync::oneshot::channel();
    purge_barriers::install(
        ws,
        purge_barriers::PurgeBarrier {
            reached_tx: Some(purge_reached_tx),
            resume_rx: Some(purge_resume_rx),
        },
    );

    // Executor parked holding the shared SessionStart lease; no workflow
    // session exists yet, so a destructive snapshot here is empty of it.
    within(&state, &run_id, "session start lease", lease_rx)
        .await
        .expect("session start lease sender retained");

    // Fire purge INSIDE the window: it snapshots (empty of the workflow
    // session), admits those permits, then parks at the seam before acquiring
    // the exclusive workspace lease.
    let purge_state = state.clone();
    let purge_ws = ws.to_string();
    let purge = tokio::spawn(async move { delete_workspace(&purge_state, &purge_ws).await });

    // Deterministic ordering: wait for purge to reach its pre-exclusive-lease
    // seam. Reaching it PROVES admit_all_workspace_sessions returned (the
    // snapshot is complete and empty of the workflow session) BEFORE the
    // workflow session is created below. This replaces the false-pass
    // sleep(150ms) + !is_finished() ordering signal.
    within(&state, &run_id, "purge reached seam", purge_reached_rx)
        .await
        .expect("purge reached pre-exclusive-lease seam");

    // Release the executor: it creates+binds the fresh session (now workflow
    // controlled), starts it, dispatches, and drops the shared lease at scope
    // end.
    resume_create_tx.send(()).expect("resume create");
    let session_id = within(&state, &run_id, "session bound", session_bound_rx)
        .await
        .expect("session bound sender retained");

    // The fresh session is now created AND bound under workflow control. Release
    // purge from its seam: it proceeds to acquire the exclusive workspace lease
    // (still blocked behind the executor's shared SessionStart lease until scope
    // end), then runs the under-lease fence against a session that its up-front
    // snapshot could not have seen.
    purge_resume_tx.send(()).expect("resume purge");

    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-fence-purge".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");
    match within(&state, &run_id, "workflow prompt", scripted.events.recv())
        .await
        .expect("prompt event")
    {
        ScriptedSessionEvent::Prompt { .. } => {}
        other => panic!("expected the workflow prompt, got {other:?}"),
    }
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");

    // The destructive path took the exclusive lease, re-enumerated, and found
    // the now workflow-controlled session -> fail closed with the stable 409,
    // BEFORE any destructive effect.
    let (status, body) = within(&state, &run_id, "purge join", purge)
        .await
        .expect("purge join");
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "purge must fail closed against a session bound after its admission snapshot (got {status}: {body})"
    );
    assert_eq!(body["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // No effect: the workflow session row and the workspace both survive.
    assert!(
        state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "purge must not dematerialize the workflow-controlled session"
    );
    assert!(
        state
            .workspace_runtime
            .get_workspace(ws)
            .expect("get workspace")
            .is_some(),
        "purge must not delete the workspace holding a controlled session"
    );

    purge_barriers::clear(ws);
    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retire_fails_closed_against_workflow_control_acquired_after_admission_snapshot() {
    // Retire's ordering is: admit the CURRENT session set -> advisory preflight
    // -> exclusive lease -> under-lease fence. The stale-snapshot window is
    // between the up-front admission (which sees the session UNCONTROLLED, so it
    // is admitted, not conflicted) and the exclusive lease: a workflow can bind
    // control of that session in that gap, exactly mirroring the executor
    // holding the shared SessionStart lease and binding a session the destroyer
    // holds no matching permit for. This proof drives the REAL retire handler
    // and the REAL controller policy: it admits an idle session, parks retire at
    // the pre-exclusive-lease seam, binds a nonterminal workflow controller in
    // that window, then releases. The under-lease fence must fail closed.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    const WS: &str = "40000000-0000-4000-8000-000000000045";
    // A worktree + active workspace whose checkout path does NOT exist is
    // retire-eligible (non-materialized skips managed-root/git checks) so
    // preflight passes and retire reaches the seam.
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WS,
        "worktree",
        "/tmp/anyharness-fence-retire-nonexistent",
    );
    let session_id = uuid::Uuid::new_v4().to_string();
    {
        let now = chrono::Utc::now().to_rfc3339();
        let record = crate::domains::sessions::model::SessionRecord {
            id: session_id.clone(),
            workspace_id: WS.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InternalOnly,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: Some(crate::origin::OriginContext::system_local_runtime()),
        };
        state
            .session_service
            .store()
            .insert(&record)
            .expect("insert idle session");
    }

    // Park retire between its advisory preflight and the exclusive lease.
    use crate::api::http::workspaces_lifecycle::retire_barriers;
    let (reached_tx, reached_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    retire_barriers::install(
        WS,
        retire_barriers::RetireBarrier {
            reached_tx: Some(reached_tx),
            resume_rx: Some(resume_rx),
        },
    );
    let retire_state = state.clone();
    let retire = tokio::spawn(async move {
        let response = build_router(retire_state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/workspaces/{WS}/retire"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        (
            status,
            serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
        )
    });

    // Retire reached the seam: it admitted the idle session up front (no
    // conflict) and passed its advisory preflight. NOW, in the stale-snapshot
    // window, a workflow acquires durable control of that same session.
    tokio::time::timeout(PROOF_WAIT, reached_rx)
        .await
        .expect("retire reached seam")
        .expect("retire seam sender retained");
    let control = control_service(&state);
    let run_id = uuid::Uuid::new_v4().to_string();
    control
        .accept(&run_id, domain_input_for_workspace(WS))
        .expect("accept controller run");
    assert!(control.begin_run(&run_id).expect("begin_run"));
    assert!(control
        .bind_session(&run_id, &session_id)
        .expect("bind controller session"));

    // Release retire: it takes the exclusive lease and runs the fence.
    resume_tx.send(()).expect("resume retire");
    let (status, body) = tokio::time::timeout(PROOF_WAIT, retire)
        .await
        .expect("retire join timeout")
        .expect("retire join");
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "retire must fail closed under the exclusive lease against a session that became controlled after admission (got {status}: {body})"
    );
    assert_eq!(body["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // No effect: the session survives and the workspace is not retired.
    assert!(
        state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "retire must not dematerialize the newly workflow-controlled session's workspace"
    );
    let workspace = state
        .workspace_runtime
        .get_workspace(WS)
        .expect("get workspace")
        .expect("workspace present");
    assert_eq!(
        workspace.lifecycle_state,
        crate::domains::workspaces::model::WorkspaceLifecycleState::Active,
        "retire must not retire the workspace holding a controlled session"
    );

    retire_barriers::clear(WS);
}

// ── PR1227-WORKSPACE-FENCE-02: destruction vs. bind->terminalize race ─────────
//
// FENCE-01's under-lease re-check asks only for a NONTERMINAL controller
// (`find_workflow_controlled_session` -> `find_active_controller_run`, whose SQL
// filters `status NOT IN (completed, failed, cancelled, interrupted)`). That is
// insufficient on its own: a session bound by a workflow AFTER the up-front
// admission snapshot — so NO permit is ever held for it — whose controlling run
// then TERMINALIZES before the destructive path takes the exclusive lease has
// NO nonterminal controller at re-check time, so FENCE-01 provably returns None
// for it, yet it was never admitted. FENCE-02 closes this by carrying the
// originally-admitted session-id set into the destructive owner and failing
// closed (same stable 409) if ANY session id re-enumerated under the exclusive
// lease is absent from that set — even when its workflow already terminalized.
// These two proofs place a fresh workflow-bound session in the stale-snapshot
// window, drive its run to a TERMINAL state (so FENCE-01 is structurally blind),
// and assert the destructive path still 409s before any effect.

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn purge_fails_closed_against_session_bound_then_terminalized_after_admission_snapshot() {
    // ENV_MUTEX held for the WHOLE body: the grok program override is
    // process-global and a sibling guard-drop would un-ready the agent
    // mid-creation.
    let _env_lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let (state, ws, runtime_home, _program_guard) = grok_launch_fixture("fence2-purge");
    let service = control_service(&state);
    let plan = accepted_grok_plan(&service, ws, None);
    let run_id = plan.run_id.clone();

    // Park the executor right after it holds the shared SessionStart lease and
    // BEFORE it creates its session — the exact window the up-front admission
    // snapshot runs in with the workflow session not yet existing.
    let (lease_tx, lease_rx) = tokio::sync::oneshot::channel();
    let (resume_create_tx, resume_create_rx) = tokio::sync::oneshot::channel();
    let (session_bound_tx, session_bound_rx) = tokio::sync::oneshot::channel();
    let (resume_startup_tx, resume_startup_rx) = tokio::sync::oneshot::channel();
    test_barriers::install(
        &run_id,
        test_barriers::ExecutionBarrier {
            session_start_lease_tx: Some(lease_tx),
            resume_create_rx: Some(resume_create_rx),
            session_bound_tx: Some(session_bound_tx),
            resume_startup_rx: Some(resume_startup_rx),
            ..Default::default()
        },
    );
    let executor = tokio::spawn(execute_for_test(
        service.clone(),
        state.session_runtime.clone(),
        state.workspace_operation_gate.clone(),
        state.workflow_run_runtime.gates_for_test(),
        state.session_admission.clone(),
        plan,
    ));

    // Park purge at its pre-exclusive-lease seam: reached_tx fires only after the
    // up-front admit_all_workspace_sessions snapshot has fully returned (empty of
    // the not-yet-created workflow session) and BEFORE the purge service takes
    // the exclusive lease. A DETERMINISTIC ordering signal (no sleep) that the
    // snapshot completed before workflow creation resumes.
    use crate::api::http::workspaces_purge::purge_barriers;
    let (purge_reached_tx, purge_reached_rx) = tokio::sync::oneshot::channel();
    let (purge_resume_tx, purge_resume_rx) = tokio::sync::oneshot::channel();
    purge_barriers::install(
        ws,
        purge_barriers::PurgeBarrier {
            reached_tx: Some(purge_reached_tx),
            resume_rx: Some(purge_resume_rx),
        },
    );

    // Executor parked holding the shared SessionStart lease; no workflow
    // session exists yet, so a destructive snapshot here is empty of it.
    within(&state, &run_id, "session start lease", lease_rx)
        .await
        .expect("session start lease sender retained");

    // Fire purge INSIDE the window: it snapshots (empty of the workflow
    // session), admits those (zero) permits, records the admitted id set, then
    // parks at the seam before acquiring the exclusive workspace lease.
    let purge_state = state.clone();
    let purge_ws = ws.to_string();
    let purge = tokio::spawn(async move { delete_workspace(&purge_state, &purge_ws).await });

    // Deterministic ordering: reaching the seam PROVES the admitted-set snapshot
    // is complete and empty of the workflow session BEFORE it is created below.
    within(&state, &run_id, "purge reached seam", purge_reached_rx)
        .await
        .expect("purge reached pre-exclusive-lease seam");

    // Release the executor: it creates+binds the fresh session (now workflow
    // controlled), starts it, dispatches, and drops the shared lease at scope
    // end.
    resume_create_tx.send(()).expect("resume create");
    let session_id = within(&state, &run_id, "session bound", session_bound_rx)
        .await
        .expect("session bound sender retained");

    let mut scripted = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &session_id,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-fence2-purge".to_string(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    resume_startup_tx.send(()).expect("resume startup");
    match within(&state, &run_id, "workflow prompt", scripted.events.recv())
        .await
        .expect("prompt event")
    {
        ScriptedSessionEvent::Prompt { .. } => {}
        other => panic!("expected the workflow prompt, got {other:?}"),
    }
    // Executor completes and drops the shared SessionStart lease. Purge is still
    // parked at its seam (resume not yet sent), so it holds no lease and cannot
    // run its re-check until we release it below.
    within(&state, &run_id, "executor join", executor)
        .await
        .expect("executor join");

    // Drive the controlling run to a TERMINAL state, then wait for terminality
    // to be durably observable. This is the crux of FENCE-02: once terminal,
    // find_active_controller_run filters this run out, so FENCE-01's
    // find_workflow_controlled_session provably returns None for this session —
    // yet the session was never admitted by purge (its id is absent from the
    // empty admitted set).
    service
        .fail_nonterminal(
            &run_id,
            crate::domains::workflows::model::WorkflowRunFailureCode::SessionTurnFailed,
        )
        .expect("terminalize controlling run");
    assert!(
        !service.run_in_flight(&run_id).expect("run_in_flight"),
        "controlling run must be durably terminal before purge re-checks"
    );

    // Only NOW release purge: it acquires the (now free) exclusive lease and runs
    // the under-lease re-check. FENCE-01 sees no nonterminal controller, but
    // FENCE-02 observes the session id absent from the admitted set and fails
    // closed.
    purge_resume_tx.send(()).expect("resume purge");

    let (status, body) = within(&state, &run_id, "purge join", purge)
        .await
        .expect("purge join");
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "purge must fail closed against a session bound then terminalized after its admission snapshot (got {status}: {body})"
    );
    assert_eq!(body["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // No effect: the workflow session row and the workspace both survive.
    assert!(
        state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "purge must not dematerialize the unadmitted session"
    );
    assert!(
        state
            .workspace_runtime
            .get_workspace(ws)
            .expect("get workspace")
            .is_some(),
        "purge must not delete the workspace holding an unadmitted session"
    );

    purge_barriers::clear(ws);
    test_barriers::clear(&run_id);
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn retire_fails_closed_against_session_bound_then_terminalized_after_admission_snapshot() {
    // Retire analog of the purge FENCE-02 proof, driven through the REAL retire
    // handler and the REAL controller policy. The workspace has NO session at
    // handler start, so the up-front admitted set is empty. In the
    // stale-snapshot window (retire parked at its pre-exclusive-lease seam) a
    // fresh session is inserted, a workflow binds control of it, then that run
    // is driven TERMINAL. The under-lease FENCE-01 re-check therefore sees no
    // nonterminal controller; only FENCE-02's admitted-set membership check
    // catches the never-admitted session id.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    const WS: &str = "40000000-0000-4000-8000-000000000046";
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WS,
        "worktree",
        "/tmp/anyharness-fence2-retire-nonexistent",
    );

    // Park retire between its advisory preflight and the exclusive lease. The
    // up-front admission snapshot is empty (no session yet).
    use crate::api::http::workspaces_lifecycle::retire_barriers;
    let (reached_tx, reached_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    retire_barriers::install(
        WS,
        retire_barriers::RetireBarrier {
            reached_tx: Some(reached_tx),
            resume_rx: Some(resume_rx),
        },
    );
    let retire_state = state.clone();
    let retire = tokio::spawn(async move {
        let response = build_router(retire_state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/v1/workspaces/{WS}/retire"))
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        (
            status,
            serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
        )
    });

    // Retire reached the seam: it admitted the EMPTY session set up front and
    // passed its advisory preflight. NOW, in the stale-snapshot window, a fresh
    // session appears and a workflow binds control of it.
    tokio::time::timeout(PROOF_WAIT, reached_rx)
        .await
        .expect("retire reached seam")
        .expect("retire seam sender retained");

    let session_id = uuid::Uuid::new_v4().to_string();
    {
        let now = chrono::Utc::now().to_rfc3339();
        let record = crate::domains::sessions::model::SessionRecord {
            id: session_id.clone(),
            workspace_id: WS.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            agent_auth_contexts: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: now.clone(),
            updated_at: now,
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InternalOnly,
            system_prompt_append: None,
            subagents_enabled: false,
            action_capabilities_json: None,
            origin: Some(crate::origin::OriginContext::system_local_runtime()),
        };
        state
            .session_service
            .store()
            .insert(&record)
            .expect("insert fresh session after snapshot");
    }
    let control = control_service(&state);
    let run_id = uuid::Uuid::new_v4().to_string();
    control
        .accept(&run_id, domain_input_for_workspace(WS))
        .expect("accept controller run");
    assert!(control.begin_run(&run_id).expect("begin_run"));
    assert!(control
        .bind_session(&run_id, &session_id)
        .expect("bind controller session"));

    // Drive the controlling run TERMINAL and confirm durably: FENCE-01 is now
    // structurally blind to this session (terminal controller -> None).
    control
        .fail_nonterminal(
            &run_id,
            crate::domains::workflows::model::WorkflowRunFailureCode::SessionTurnFailed,
        )
        .expect("terminalize controlling run");
    assert!(
        !control.run_in_flight(&run_id).expect("run_in_flight"),
        "controlling run must be durably terminal before retire re-checks"
    );

    // Release retire: it takes the exclusive lease and runs the fence. Only the
    // FENCE-02 admitted-set membership check can catch the unadmitted session.
    resume_tx.send(()).expect("resume retire");
    let (status, body) = tokio::time::timeout(PROOF_WAIT, retire)
        .await
        .expect("retire join timeout")
        .expect("retire join");
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "retire must fail closed under the exclusive lease against a session bound then terminalized after admission (got {status}: {body})"
    );
    assert_eq!(body["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // No effect: the session survives and the workspace is not retired.
    assert!(
        state
            .session_service
            .store()
            .find_by_id(&session_id)
            .expect("find session")
            .is_some(),
        "retire must not dematerialize the unadmitted session"
    );
    let workspace = state
        .workspace_runtime
        .get_workspace(WS)
        .expect("get workspace")
        .expect("workspace present");
    assert_eq!(
        workspace.lifecycle_state,
        crate::domains::workspaces::model::WorkspaceLifecycleState::Active,
        "retire must not retire the workspace holding an unadmitted session"
    );

    retire_barriers::clear(WS);
}
