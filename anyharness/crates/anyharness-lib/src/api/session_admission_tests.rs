//! Spec 2b merge-gated proofs over the admission surface: source semantics
//! against the REAL controller policy and durable rows, the full fenced-route
//! conflict matrix (before any side effect), read/cosmetic availability, and
//! the fail-closed purge/mobility posture. The executor-ordering races live
//! with the workflow suite (`workflow_runs_tests`).

use std::sync::Mutex;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use super::workflow_runs_tests::{get as get_run, test_state};
use crate::app::{test_support, AppState};
use crate::domains::sessions::admission::{
    SessionMutationConflict, SessionMutationKind, SessionMutationSource,
};
use crate::domains::workflows::service::WorkflowRunService;
use crate::domains::workflows::store::WorkflowRunStore;

const WS: &str = "20000000-0000-4000-8000-000000000002";

fn insert_session_row(state: &AppState, workspace_id: &str) -> String {
    let now = chrono::Utc::now().to_rfc3339();
    let record = crate::domains::sessions::model::SessionRecord {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
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
        status: "starting".to_string(),
        created_at: now.clone(),
        updated_at: now,
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: crate::domains::sessions::model::SessionMcpBindingPolicy::InternalOnly,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: Some(crate::origin::OriginContext::system_local_runtime()),
    };
    state
        .session_service
        .store()
        .insert(&record)
        .expect("insert session row");
    record.id
}

fn controlled_fixture(state: &AppState) -> (String, String) {
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-ws");
    let session_id = insert_session_row(state, WS);
    let service = WorkflowRunService::new(WorkflowRunStore::new(state.db.clone()));
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(
            &run_id,
            super::workflow_runs_tests::domain_input_for_workspace(WS),
        )
        .expect("accept");
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, &session_id)
        .expect("bind_session"));
    (run_id, session_id)
}

async fn call(
    state: &AppState,
    method: &str,
    uri: String,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    let request = match body {
        Some(value) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&value).expect("body")))
            .expect("request"),
        None => builder.body(Body::empty()).expect("request"),
    };
    let response = build_router(state.clone())
        .oneshot(request)
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("bytes");
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn foreign_and_stale_workflow_sources_denied_owning_admitted() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (run_id, session_id) = controlled_fixture(&state);

    // External denied.
    match state
        .session_admission
        .acquire(
            &session_id,
            SessionMutationKind::Prompt,
            &SessionMutationSource::external(),
        )
        .await
    {
        Err(SessionMutationConflict::ControlledByWorkflow { run_id: owner }) => {
            assert_eq!(owner, run_id);
        }
        Err(other) => panic!("external source must conflict cleanly: {other:?}"),
        Ok(_permit) => panic!("external source must conflict, not be admitted"),
    }

    // A STALE/foreign workflow source (a different run id) is denied exactly
    // like any external caller — no cross-run authority.
    let stale = SessionMutationSource::workflow_run("11111111-1111-4111-8111-111111111111");
    assert!(matches!(
        state
            .session_admission
            .acquire(&session_id, SessionMutationKind::Cancel, &stale)
            .await,
        Err(SessionMutationConflict::ControlledByWorkflow { .. })
    ));

    // The OWNING workflow source is admitted.
    let owning = SessionMutationSource::workflow_run(&run_id);
    assert!(state
        .session_admission
        .acquire(&session_id, SessionMutationKind::Cancel, &owning)
        .await
        .is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_fenced_route_conflicts_before_side_effects_and_reads_stay_available() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (_run_id, sid) = controlled_fixture(&state);

    let prompt_body = json!({"blocks": [{"type": "text", "text": "foreign"}]});
    let cases: Vec<(&str, String, Option<Value>)> = vec![
        (
            "POST",
            format!("/v1/sessions/{sid}/prompt"),
            Some(prompt_body.clone()),
        ),
        (
            "PATCH",
            format!("/v1/sessions/{sid}/pending-prompts/1"),
            Some(prompt_body.clone()),
        ),
        (
            "DELETE",
            format!("/v1/sessions/{sid}/pending-prompts/1"),
            None,
        ),
        (
            "PUT",
            format!("/v1/sessions/{sid}/pending-prompts/order"),
            Some(json!({"expectedSeqs": [], "desiredSeqs": []})),
        ),
        (
            "POST",
            format!("/v1/sessions/{sid}/pending-prompts/1/steer"),
            None,
        ),
        (
            "POST",
            format!("/v1/sessions/{sid}/config-options"),
            Some(json!({"configId": "effort", "value": "low"})),
        ),
        ("POST", format!("/v1/sessions/{sid}/cancel"), None),
        ("POST", format!("/v1/sessions/{sid}/close"), None),
        ("POST", format!("/v1/sessions/{sid}/dismiss"), None),
        (
            "POST",
            format!("/v1/sessions/{sid}/resume"),
            Some(json!({})),
        ),
        ("POST", format!("/v1/sessions/{sid}/fork"), Some(json!({}))),
        (
            "POST",
            format!("/v1/sessions/{sid}/interactions/req-1/resolve"),
            Some(json!({"outcome": "dismissed"})),
        ),
        (
            "PUT",
            format!("/v1/sessions/{sid}/goal"),
            Some(json!({"text": "goal"})),
        ),
        ("DELETE", format!("/v1/sessions/{sid}/goal"), None),
        (
            "PUT",
            format!("/v1/sessions/{sid}/loops"),
            Some(json!({"prompt": "loop", "schedule": {"kind": "interval", "expr": "1h"}})),
        ),
        ("DELETE", format!("/v1/sessions/{sid}/loops"), None),
        (
            "POST",
            format!("/v1/sessions/{sid}/subagents/child-1/wake"),
            Some(json!({})),
        ),
    ];
    for (method, uri, body) in cases {
        let (status, payload) = call(&state, method, uri.clone(), body).await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "{method} {uri} must conflict while controlled (got {status}: {payload})"
        );
        assert_eq!(
            payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW",
            "{method} {uri} stable code"
        );
    }

    // No side effects: the session row is untouched and unqueued.
    let (status, session) = call(&state, "GET", format!("/v1/sessions/{sid}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["status"], "starting");
    assert!(session["lastPromptAt"].is_null());
    assert!(session.get("closedAt").map(|v| v.is_null()).unwrap_or(true));
    assert!(session
        .get("dismissedAt")
        .map(|v| v.is_null())
        .unwrap_or(true));

    // Reads stay available while controlled.
    let (status, _) = call(&state, "GET", format!("/v1/sessions/{sid}/events"), None).await;
    assert_eq!(status, StatusCode::OK);

    // Cosmetic title rename stays allowed (ruling 2).
    let (status, titled) = call(
        &state,
        "PATCH",
        format!("/v1/sessions/{sid}/title"),
        Some(json!({"title": "still mine to name"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(titled["title"], "still mine to name");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_and_mobility_fail_closed_while_controlled() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (_run_id, _sid) = controlled_fixture(&state);

    let (status, payload) = call(&state, "DELETE", format!("/v1/workspaces/{WS}"), None).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "purge must fail closed while a workflow controls a session (got {status}: {payload})"
    );
    assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // RETIRE-01 ruling B: retirement fails closed exactly like purge.
    let (status, payload) = call(&state, "POST", format!("/v1/workspaces/{WS}/retire"), None).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "retire must fail closed while a workflow controls a session (got {status}: {payload})"
    );
    assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/workspaces/{WS}/mobility/export"),
        Some(json!({})),
    )
    .await;
    assert!(
        status == StatusCode::CONFLICT || status == StatusCode::NOT_FOUND,
        "mobility export must not proceed while controlled (got {status}: {payload})"
    );
    if status == StatusCode::CONFLICT {
        assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ordinary_sessions_keep_existing_behavior() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-ord");
    let sid = insert_session_row(&state, WS);

    // Uncontrolled: admission admits External; the mutation proceeds to its
    // ordinary downstream outcome (dismiss succeeds end-to-end).
    let (status, dismissed) =
        call(&state, "POST", format!("/v1/sessions/{sid}/dismiss"), None).await;
    assert_eq!(status, StatusCode::OK, "{dismissed}");
}

// ── PR1227-LOCK-01: permit-vs-operation-gate lock order ───────────────────
//
// The per-session mutation permit and the per-workspace `WorkspaceOperationGate`
// RwLock are both held at once by fork/plan/review/retire/purge/mobility
// handlers. Acquiring them in inconsistent orders is an ABBA deadlock. The
// canonical order (fix) is ALWAYS `permit -> operation lease`. These two proofs
// pin that: a concurrency test that DEADLOCKS under the old reversed order and
// COMPLETES under the canonical order, plus a per-handler source-order guard.

use crate::domains::sessions::admission::{NoControllerPolicy, SessionMutationAdmission};
use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use std::sync::Arc;
use std::time::Duration;

const LOCK_SID: &str = "50000000-0000-4000-8000-000000000050";
const LOCK_WS: &str = "50000000-0000-4000-8000-000000000051";

/// The permit-then-write camp (models fork/retire/purge): acquire the session
/// permit, signal that it is held, wait for the release cue, then reach for the
/// workspace write lease (the second lock in this camp's order).
async fn permit_then_write_camp(
    admission: Arc<SessionMutationAdmission>,
    gate: WorkspaceOperationGate,
    held_tx: tokio::sync::oneshot::Sender<()>,
    proceed_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let _permit = admission
        .acquire(
            LOCK_SID,
            SessionMutationKind::Fork,
            &SessionMutationSource::external(),
        )
        .await
        .expect("permit-then-write camp permit");
    let _ = held_tx.send(());
    let _ = proceed_rx.await;
    let _write = gate.acquire_exclusive(LOCK_WS).await;
}

/// Force the ABBA interleaving on the SAME session+workspace pair: camp A holds
/// the permit and is poised to take the workspace write; camp B (the buggy
/// reversed order) takes the workspace READ first, then reaches for the permit.
/// A then reaches for the write. Under the reversed order this is a cycle — A
/// waits on B's read, B waits on A's permit — and wedges. Returns `Err(())` on
/// the bounded-timeout wedge (deadlock signature), `Ok(())` if it completes.
async fn reversed_order_deadlocks() -> Result<(), ()> {
    let admission = Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy)));
    let gate = WorkspaceOperationGate::new();
    let (a_held_tx, a_held_rx) = tokio::sync::oneshot::channel::<()>();
    let (a_proceed_tx, a_proceed_rx) = tokio::sync::oneshot::channel::<()>();

    let camp_a = tokio::spawn(permit_then_write_camp(
        admission.clone(),
        gate.clone(),
        a_held_tx,
        a_proceed_rx,
    ));
    let camp_b = {
        let admission = admission.clone();
        let gate = gate.clone();
        tokio::spawn(async move {
            // Start only once A holds the permit, then take the workspace READ
            // first (the OLD buggy order plans.rs/reviews.rs used), release A to
            // reach for the write, and only then reach for the permit A holds.
            let _ = a_held_rx.await;
            let _read = gate
                .acquire_shared(LOCK_WS, WorkspaceOperationKind::PlanWrite)
                .await;
            let _ = a_proceed_tx.send(());
            let _permit = admission
                .acquire(
                    LOCK_SID,
                    SessionMutationKind::Plan,
                    &SessionMutationSource::external(),
                )
                .await
                .expect("reversed camp permit");
        })
    };

    let abort_a = camp_a.abort_handle();
    let abort_b = camp_b.abort_handle();
    match tokio::time::timeout(Duration::from_secs(3), async {
        let _ = camp_a.await;
        let _ = camp_b.await;
    })
    .await
    {
        Ok(()) => Ok(()),
        Err(_) => {
            abort_a.abort();
            abort_b.abort();
            Err(())
        }
    }
}

/// Run both camps in their CANONICAL order (permit before the operation lease)
/// concurrently on the same session+workspace pair. Because the permit is a
/// keyed mutex both acquire FIRST, it imposes a single global order — the ABBA
/// cycle is structurally impossible and both camps complete regardless of
/// interleaving. No pathological hold-barrier is needed (and none is possible:
/// under permit-first serialization neither camp can hold the workspace lock
/// while waiting on the permit).
async fn canonical_order_completes() -> Result<(), ()> {
    let admission = Arc::new(SessionMutationAdmission::new(Arc::new(NoControllerPolicy)));
    let gate = WorkspaceOperationGate::new();

    let camp_a = {
        let admission = admission.clone();
        let gate = gate.clone();
        tokio::spawn(async move {
            let _permit = admission
                .acquire(
                    LOCK_SID,
                    SessionMutationKind::Fork,
                    &SessionMutationSource::external(),
                )
                .await
                .expect("camp A permit");
            let _write = gate.acquire_exclusive(LOCK_WS).await;
            tokio::task::yield_now().await;
        })
    };
    let camp_b = {
        let admission = admission.clone();
        let gate = gate.clone();
        tokio::spawn(async move {
            let _permit = admission
                .acquire(
                    LOCK_SID,
                    SessionMutationKind::Plan,
                    &SessionMutationSource::external(),
                )
                .await
                .expect("camp B permit");
            let _read = gate
                .acquire_shared(LOCK_WS, WorkspaceOperationKind::PlanWrite)
                .await;
            tokio::task::yield_now().await;
        })
    };

    match tokio::time::timeout(Duration::from_secs(3), async {
        let _ = camp_a.await;
        let _ = camp_b.await;
    })
    .await
    {
        Ok(()) => Ok(()),
        Err(_) => Err(()),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn permit_before_operation_lease_avoids_abba_deadlock() {
    // Canonical order (the fix): permit acquired before the operation lease in
    // both camps. The permit serializes the two roles, so no ABBA — both
    // complete well within the bound, on every interleaving.
    for _ in 0..8 {
        assert!(
            canonical_order_completes().await.is_ok(),
            "canonical permit-before-lease order must not deadlock"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reversed_read_then_permit_order_deadlocks() {
    // Teeth: the OLD order (one camp takes workspace-read THEN permit) IS an
    // ABBA deadlock against the permit-then-write camp on the same
    // session/workspace pair. It wedges and trips the bounded timeout, proving
    // the reordering fix addresses a real deadlock, not a cosmetic reshuffle.
    // In the pre-fix tree plans.rs/reviews.rs held exactly this reversed order.
    assert!(
        reversed_order_deadlocks().await.is_err(),
        "reversed read-then-permit order must deadlock (bounded timeout must trip)"
    );
}

/// Extract a single handler function body from a source file under the crate,
/// from its `pub async fn <name>(` signature to the next top-level `pub` item.
fn handler_body(rel_path: &str, fn_name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel_path);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {rel_path}: {error}"));
    let signature = format!("pub async fn {fn_name}(");
    let start = text
        .find(&signature)
        .unwrap_or_else(|| panic!("{rel_path}: handler {fn_name} not found"));
    let rest = &text[start..];
    let end = rest[signature.len()..]
        .find("\npub ")
        .map(|idx| idx + signature.len())
        .unwrap_or(rest.len());
    rest[..end].to_string()
}

fn assert_admit_before_lease(rel_path: &str, fn_name: &str, admit: &str, lease: &str) {
    let body = handler_body(rel_path, fn_name);
    let admit_at = body
        .find(admit)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: admit token '{admit}' missing"));
    let lease_at = body
        .find(lease)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: lease token '{lease}' missing"));
    assert!(
        admit_at < lease_at,
        "{rel_path}::{fn_name}: the session mutation permit ('{admit}') must be \
         acquired BEFORE the workspace operation lease ('{lease}') — canonical \
         LOCK-01 order permit -> operation lease"
    );
}

#[test]
fn every_dual_lock_handler_takes_the_permit_before_the_operation_lease() {
    // Per-handler source-order guard for every handler that holds BOTH the
    // session mutation permit and a workspace operation lease. Under the old
    // reversed order (lease first) each assertion fails; the fix makes the
    // admit_* call outermost.
    let http = "src/api/http";
    // plans: admit_plan_session before the PlanWrite shared lease.
    for handler in ["approve_plan", "reject_plan", "handoff_plan"] {
        assert_admit_before_lease(
            &format!("{http}/plans.rs"),
            handler,
            "admit_plan_session(",
            ".acquire_shared(",
        );
    }
    // reviews: admit_session_mutation before the ReviewWrite shared lease.
    for handler in ["start_plan_review", "start_code_review"] {
        assert_admit_before_lease(
            &format!("{http}/reviews.rs"),
            handler,
            "admit_session_mutation(",
            ".acquire_shared(",
        );
    }
    // fork: admit before the exclusive session operation lease.
    assert_admit_before_lease(
        &format!("{http}/sessions_fork.rs"),
        "fork_session",
        "admit_session_mutation(",
        "acquire_session_exclusive_operation_lease(",
    );
    // subagent wake: admit before the SubagentWrite shared lease.
    assert_admit_before_lease(
        &format!("{http}/subagents.rs"),
        "schedule_subagent_wake",
        "admit_session_mutation(",
        ".acquire_shared(",
    );
    // retire: admit-all before the exclusive workspace lease.
    assert_admit_before_lease(
        &format!("{http}/workspaces_lifecycle.rs"),
        "retire_workspace",
        "admit_all_workspace_sessions(",
        ".acquire_exclusive(",
    );
    // mobility export: admit-all before the MobilityWrite shared lease.
    assert_admit_before_lease(
        &format!("{http}/mobility.rs"),
        "export_workspace_mobility_archive",
        "admit_all_workspace_sessions(",
        ".acquire_shared(",
    );
}
