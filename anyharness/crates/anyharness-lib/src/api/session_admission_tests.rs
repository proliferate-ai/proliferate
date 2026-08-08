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
    let session_id = uuid::Uuid::new_v4().to_string();
    test_support::insert_session_row(
        state.session_service.store(),
        workspace_id,
        &session_id,
        "starting",
    );
    session_id
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
async fn destroy_source_fails_closed_while_controlled() {
    // PR1227-MOBILITY-DESTROY-01: destroy-source deletes every source session +
    // materialization. With a workflow controlling a workspace session it must
    // fail closed with the stable 409 before ANY effect — the session row and
    // materialization survive. (Remove the admit/re-check fence and destroy-source
    // 200s with the controlled session deleted.)
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (_run_id, sid) = controlled_fixture(&state);

    // destroy-source requires RemoteOwned mode; set it directly so the mode
    // assert would pass and only the session-admission fence stands in the way.
    state
        .workspace_access_gate
        .set_runtime_state(
            WS,
            crate::domains::workspaces::access_model::WorkspaceAccessMode::RemoteOwned,
            None,
        )
        .expect("set remote_owned mode");

    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/workspaces/{WS}/mobility/destroy-source"),
        Some(json!({})),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "destroy-source must fail closed while a workflow controls a session (got {status}: {payload})"
    );
    assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    // No effect: the controlled session row survives.
    assert!(
        state
            .session_service
            .store()
            .find_by_id(&sid)
            .expect("find session")
            .is_some(),
        "destroy-source must not delete the workflow-controlled session"
    );
    // No effect: the workspace still exists.
    assert!(
        state
            .workspace_runtime
            .get_workspace(WS)
            .expect("get workspace")
            .is_some(),
        "destroy-source must not destroy the workspace holding a controlled session"
    );
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

/// Assert `first` textually precedes `second` within one function's body. Both
/// tokens must be BODY-resident: a token that appears in the signature (a
/// parameter name, say) precedes every statement and makes the check vacuous.
fn assert_source_order(rel_path: &str, fn_name: &str, first: &str, second: &str, why: &str) {
    let body = handler_body(rel_path, fn_name);
    let first_at = body
        .find(first)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: token '{first}' missing"));
    let second_at = body
        .find(second)
        .unwrap_or_else(|| panic!("{rel_path}::{fn_name}: token '{second}' missing"));
    assert!(
        first_at < second_at,
        "{rel_path}::{fn_name}: '{first}' must come BEFORE '{second}' — {why}"
    );
}

/// Collapse every run of whitespace to a single space, so a source needle can
/// span a `let` binding and its call without a rustfmt line wrap breaking it.
fn squash_whitespace(source: &str) -> String {
    source.split_whitespace().collect::<Vec<_>>().join(" ")
}

const LOCK_01_ORDER: &str =
    "canonical LOCK-01 order: session mutation permit -> workspace operation lease";

fn assert_admit_before_lease(rel_path: &str, fn_name: &str, admit: &str, lease: &str) {
    assert_source_order(rel_path, fn_name, admit, lease, LOCK_01_ORDER);
}

#[test]
fn every_dual_lock_handler_takes_the_permit_before_the_operation_lease() {
    // Per-handler source-order guard for every handler that holds BOTH the
    // session mutation permit and a workspace operation lease. Under the old
    // reversed order (lease first) each row fails; the fix makes the admit_*
    // call outermost. Retire's lease is no longer in its handler (see below).
    const ADMIT: &str = "admit_session_mutation(";
    const ADMIT_ALL: &str = "admit_all_workspace_sessions(";
    const PLAN: &str = "admit_plan_session(";
    const SHARED: &str = ".acquire_shared(";
    const EXCLUSIVE: &str = ".acquire_exclusive(";
    const FORK_LEASE: &str = "acquire_session_exclusive_operation_lease(";
    for (file, handler, admit, lease) in [
        // idempotent create: caller-selected id admission before SessionStart.
        ("sessions.rs", "create_session", ADMIT, SHARED),
        // plans: admit_plan_session before the PlanWrite shared lease.
        ("plans.rs", "approve_plan", PLAN, SHARED),
        ("plans.rs", "reject_plan", PLAN, SHARED),
        ("plans.rs", "handoff_plan", PLAN, SHARED),
        // reviews: admit_session_mutation before the ReviewWrite shared lease.
        ("reviews.rs", "start_plan_review", ADMIT, SHARED),
        ("reviews.rs", "start_code_review", ADMIT, SHARED),
        // fork: admit before the exclusive session operation lease.
        ("sessions_fork.rs", "fork_session", ADMIT, FORK_LEASE),
        // subagent wake: admit before the SubagentWrite shared lease.
        ("subagents.rs", "schedule_subagent_wake", ADMIT, SHARED),
        // session-scoped agent wake: admit before the SubagentWrite shared lease.
        ("sessions_wakes.rs", "schedule_agent_wake", ADMIT, SHARED),
        // retire HALF 1: the handler admits before it calls the facade.
        ("workspaces_lifecycle.rs", "retire_workspace", ADMIT_ALL, ".retire("),
        // mobility export: admit-all before the MobilityWrite shared lease.
        ("mobility.rs", "export_workspace_mobility_archive", ADMIT_ALL, SHARED),
        // mobility destroy-source: admit-all before the exclusive workspace lease.
        ("mobility.rs", "destroy_workspace_mobility_source", ADMIT_ALL, EXCLUSIVE),
    ] {
        assert_admit_before_lease(&format!("src/api/http/{file}"), handler, admit, lease);
    }
    // Retire HALF 2. Grid PR 9 moved the retire state machine (and with it the
    // exclusive lease) into `domains/workspaces/retire.rs`, so the one LOCK-01
    // ordering now spans two files: half 1 above pins admit-before-facade-call,
    // and these two links pin the facade's own chain. BODY-RESIDENT tokens only:
    // an earlier version used the `admitted_session_ids:` PARAMETER, which
    // precedes every statement, so the check was vacuous. Both links are needed
    // — either alone still passes with the lease hoisted to the top of the fn.
    let retire = "src/domains/workspaces/retire.rs";
    assert_source_order(
        retire,
        "retire",
        ".blocked_if_preflight_refuses(",
        EXCLUSIVE,
        "the advisory preflight (and the FENCE-01 proof seam sitting in its gap) \
         must run BEFORE the exclusive lease, or a refused retire serializes on \
         the workspace and the pre-lease proof window disappears",
    );
    assert_source_order(
        retire,
        "retire",
        EXCLUSIVE,
        ".reject_if_workflow_controlled(",
        "PR1227-WORKSPACE-FENCE-01/02: the exclusive lease must be held before \
         the admitted-set re-check runs, or the fence re-enumerates sessions in \
         a window that still admits workflow session creation",
    );
}

#[test]
fn the_peer_tools_take_the_permit_before_the_target_workspace_lease() {
    // The dual-lock sites outside `api/http/`: `send_agent_message` and
    // `configure_agent` are the product-MCP tools that can perturb an ARBITRARY
    // session, so each takes the target session's permit and the TARGET
    // workspace's write lease itself rather than through the route's
    // `MUTATING_TOOL_NAMES` lease (which is the CALLER's workspace, and would be
    // taken before the permit — the reversed order `reversed_order_deadlocks`
    // proves hangs). Same guard as the handler rows above; separate because the
    // functions are private, so they have no `pub async fn` signature for
    // `handler_body` to find.
    let rel_path = "src/domains/sessions/agent_ops/calls.rs";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel_path);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {rel_path}: {error}"));

    for (tool, dispatch) in [
        ("send_agent_message", "send_text_prompt_with_provenance("),
        ("configure_agent", "set_live_session_config_option("),
    ] {
        let signature = format!("async fn {tool}(");
        let start = text
            .find(&signature)
            .unwrap_or_else(|| panic!("{rel_path}: {tool} not found"));
        let rest = &text[start..];
        // Private items follow, so stop at this function's own closing brace
        // rather than at the next `pub` item.
        let end = rest.find("\n}\n").map(|idx| idx + 3).unwrap_or(rest.len());
        // Whitespace runs collapse to one space so a rustfmt wrap of the
        // argument list cannot break a needle, and so the needles can span the
        // `let` binding.
        let body = squash_whitespace(&rest[..end]);
        let body = body.as_str();

        // The needles pin the BINDING, not just the call. Matching
        // `admit_peer_mutation(` alone would pass on `let _ = admit_peer_mutation(..)`,
        // which drops the permit at the end of that statement — textually
        // identical ORDER, no fence at all across the dispatch below. What this
        // test exists to prove is that both guards are still HELD when the work
        // lands, so the named bindings are the thing to ratchet.
        let admit_at = body
            .find("let _admission_permit = admit_peer_mutation(")
            .unwrap_or_else(|| {
                panic!(
                    "{tool} must BIND the target session's mutation permit as \
                     `_admission_permit` — an unbound `let _ =` drops it immediately"
                )
            });
        let lease_at = body
            .find("let _target_workspace_lease = lease_target_workspace_for_peer_write(")
            .unwrap_or_else(|| {
                panic!(
                    "{tool} must BIND the TARGET workspace lease as \
                     `_target_workspace_lease` — an unbound `let _ =` drops it immediately"
                )
            });
        assert!(
            admit_at < lease_at,
            "{tool}: 'admit_peer_mutation' must come BEFORE \
             'lease_target_workspace_for_peer_write' — {LOCK_01_ORDER}"
        );
        // And the dispatch stays inside both: a permit dropped before the work
        // lands fences nothing. Both bindings live to the end of the function,
        // so a dispatch that appears after them is inside both.
        let dispatch_at = body
            .find(dispatch)
            .unwrap_or_else(|| panic!("{tool} must dispatch through {dispatch}"));
        assert!(lease_at < dispatch_at, "{tool}: dispatch escaped the locks");
    }
}

/// One private function's body, squashed to single spaces. Same extraction the
/// peer-tool guard above does inline; the workspace-spawn tools need it too.
fn private_fn_body(rel_path: &str, fn_name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel_path);
    let text =
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {rel_path}: {error}"));
    let signature = format!("async fn {fn_name}(");
    let start = text
        .find(&signature)
        .unwrap_or_else(|| panic!("{rel_path}: {fn_name} not found"));
    let rest = &text[start..];
    let end = rest.find("\n}\n").map(|idx| idx + 3).unwrap_or(rest.len());
    squash_whitespace(&rest[..end])
}

#[test]
fn spawn_agent_holds_the_target_workspace_lease_across_creation() {
    // `spawn_agent` can now create a peer in a workspace that is not the
    // caller's (ADR §3.3), so it left `MUTATING_TOOL_NAMES` for the same reason
    // `send_agent_message` and `configure_agent` did: the route's lease is the
    // CALLER's workspace, which is the wrong one. It takes the TARGET
    // workspace's write lease itself instead.
    //
    // Unlike the peer tools there is no admission permit, and none is possible:
    // the target SESSION does not exist until the call creates it, so there is
    // nothing to admit. With one lease and no permit LOCK-01 has no order to
    // invert — what is left to prove is that the one lease is HELD across the
    // creation, because that is what a concurrent retire preflight on the
    // target workspace has to collide with.
    assert!(
        !crate::domains::sessions::agent_ops::tools::MUTATING_TOOL_NAMES.contains(&"spawn_agent"),
        "spawn_agent must stay OUT of MUTATING_TOOL_NAMES — the route lease is the caller's \
         workspace, and taking it here would both lease the wrong workspace and (were a permit \
         ever added) invert LOCK-01"
    );
    let body = private_fn_body("src/domains/sessions/agent_ops/calls.rs", "spawn_agent");
    let body = body.as_str();
    // The BINDING, not the call: `let _ = lease_..(..)` drops the lease at the
    // end of its own statement, which reads identically in call ORDER and
    // fences nothing.
    let lease_at = body
        .find("let _target_workspace_lease = lease_target_workspace_for_peer_write(")
        .expect(
            "spawn_agent must BIND the TARGET workspace lease as `_target_workspace_lease` — \
             an unbound `let _ =` drops it immediately",
        );
    let create_at = body
        .find("create_agent_session(")
        .expect("spawn_agent must create through the shared create_agent_session routine");
    assert!(
        lease_at < create_at,
        "spawn_agent: the target workspace lease must be taken BEFORE create_agent_session, and \
         it is held to the end of the function, so creation happens inside it"
    );
    // And the lease is on the TARGET, not on the caller's `ctx.workspace_id`.
    assert!(
        body.contains(
            "lease_target_workspace_for_peer_write( &gates.workspace_operation_gate, \
             service.access_gate(), &request.workspace_id,"
        ),
        "spawn_agent must lease `request.workspace_id` (the target), not the caller's workspace"
    );
}

#[test]
fn spawn_workspace_has_nothing_to_lease_and_says_so() {
    // `spawn_workspace` creates a workspace, so at call time the thing a
    // workspace operation lease would name does not exist. The human worktree
    // route has the same problem and solves it the same way: no operation
    // lease, an ACCESS-gate assertion on the repo root instead. Recording it
    // here so a later reader does not "fix" the missing lease.
    assert!(
        !crate::domains::sessions::agent_ops::tools::MUTATING_TOOL_NAMES
            .contains(&"spawn_workspace"),
        "spawn_workspace must stay OUT of MUTATING_TOOL_NAMES — the route would lease the \
         CALLER's workspace, which is not what the call mutates"
    );
    let body = private_fn_body(
        "src/domains/sessions/agent_ops/workspace_ops.rs",
        "spawn_workspace",
    );
    let body = body.as_str();
    assert!(
        !body.contains("acquire_shared(") && !body.contains("acquire_exclusive("),
        "spawn_workspace must not take a workspace operation lease — there is no workspace to \
         lease until it returns"
    );
    let gate_at = body
        .find("assert_can_mutate_for_repo_root(")
        .expect("spawn_workspace must gate on the repo root, as the human worktree route does");
    let create_at = body
        .find("spawn_worktree_workspace(")
        .expect("spawn_workspace must delegate creation to the worktree path");
    assert!(
        gate_at < create_at,
        "spawn_workspace: the repo-root access gate must run before anything is created"
    );
}
