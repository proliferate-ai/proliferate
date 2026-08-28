//! Spec 2b merge-gated proofs over the admission surface: source semantics,
//! the full fenced-route conflict matrix (before any side effect),
//! read/cosmetic availability, and the fail-closed purge/mobility posture.
//! Gen-1 workflows (the durable controller producer) is superseded; production
//! wiring injects `NoControllerPolicy`, so these proofs install a static test
//! controller policy to exercise the sessions-owned conflict mechanics.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::admission::{
    AllSessionsOperable, SessionControllerPolicy, SessionMutationConflict, SessionMutationKind,
    SessionMutationSource,
};
use crate::persistence::Db;

const WS: &str = "20000000-0000-4000-8000-000000000002";

pub(super) fn test_state() -> AppState {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    AppState::new(
        PathBuf::from(format!("/tmp/anyharness-admission-router-{unique}")),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state")
}

/// A controller policy pinning exactly one session to one run id, standing in
/// for gen-1's durable lookup so the admission mechanics stay proven.
struct StaticControllerPolicy {
    session_id: String,
    run_id: String,
}

impl SessionControllerPolicy for StaticControllerPolicy {
    fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        Ok((session_id == self.session_id).then(|| self.run_id.clone()))
    }
}

#[path = "session_admission_lock_order_tests.rs"]
mod lock_order_tests;
#[path = "subagent_http_tests.rs"]
mod subagent_http_tests;
#[path = "session_admission_subagent_tests.rs"]
mod subagent_operability_tests;

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

fn controlled_fixture(state: &mut AppState) -> (String, String) {
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-ws");
    let session_id = insert_session_row(state, WS);
    let run_id = uuid::Uuid::new_v4().to_string();
    state.session_admission = Arc::new(SessionMutationAdmission::new(
        Arc::new(StaticControllerPolicy {
            session_id: session_id.clone(),
            run_id: run_id.clone(),
        }),
        Arc::new(AllSessionsOperable),
    ));
    (run_id, session_id)
}

async fn call(
    state: &AppState,
    method: &str,
    uri: String,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let builder = Request::builder().method(method).uri(uri);
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
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let mut state = test_state();
    let (run_id, session_id) = controlled_fixture(&mut state);

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
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let mut state = test_state();
    let (_run_id, sid) = controlled_fixture(&mut state);

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
    let wake_schedule_count = state
        .db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM session_link_wake_schedules",
                [],
                |row| row.get::<_, i64>(0),
            )
        })
        .expect("count wake schedules");
    assert_eq!(wake_schedule_count, 0);

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
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let mut state = test_state();
    let (_run_id, _sid) = controlled_fixture(&mut state);

    let (status, payload) = call(&state, "DELETE", format!("/v1/workspaces/{WS}"), None).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "purge must fail closed while a workflow controls a session (got {status}: {payload})"
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
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let mut state = test_state();
    let (_run_id, sid) = controlled_fixture(&mut state);

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
    let _lock = test_support::lock_env().await;
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
// RwLock are both held at once by fork/plan/review/purge/mobility
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

/// The permit-then-write camp (models fork/purge): acquire the session
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
    let admission = Arc::new(SessionMutationAdmission::new(
        Arc::new(NoControllerPolicy),
        Arc::new(crate::domains::sessions::admission::AllSessionsOperable),
    ));
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
    let admission = Arc::new(SessionMutationAdmission::new(
        Arc::new(NoControllerPolicy),
        Arc::new(crate::domains::sessions::admission::AllSessionsOperable),
    ));
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
