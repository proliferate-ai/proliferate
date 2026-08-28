use super::*;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn app_wiring_enforces_reversible_subagent_operability() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-subagent");
    let parent_id = insert_session_row(&state, WS);
    let child_id = insert_session_row(&state, WS);
    state
        .subagent_service
        .link_child(&parent_id, &child_id, None, None, None)
        .expect("link child");
    state
        .session_runtime
        .close_subagent(&parent_id, &child_id)
        .await
        .expect("reversibly close child");

    assert!(matches!(
        state
            .session_admission
            .acquire(
                &child_id,
                SessionMutationKind::Prompt,
                &SessionMutationSource::external(),
            )
            .await,
        Err(SessionMutationConflict::SubagentOpenRequired)
    ));
    for kind in [
        SessionMutationKind::SubagentOpen,
        SessionMutationKind::MobilitySnapshot,
        SessionMutationKind::MobilityTeardown,
    ] {
        assert!(state
            .session_admission
            .acquire(&child_id, kind, &SessionMutationSource::external())
            .await
            .is_ok());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restore_cannot_reopen_a_reversibly_closed_dismissed_subagent() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/restore-subagent");
    let parent_id = insert_session_row(&state, WS);
    let child_id = insert_session_row(&state, WS);
    state
        .subagent_service
        .link_child(&parent_id, &child_id, None, None, None)
        .expect("link child");
    state
        .session_service
        .store()
        .mark_dismissed(&child_id, "2026-08-11T01:00:00Z")
        .expect("dismiss child");
    state
        .session_runtime
        .close_subagent(&parent_id, &child_id)
        .await
        .expect("reversible close");

    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/workspaces/{WS}/sessions/restore"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{payload}");
    assert_eq!(payload["code"], "SUBAGENT_OPEN_REQUIRED");
    assert!(state
        .session_service
        .store()
        .find_by_id(&child_id)
        .unwrap()
        .unwrap()
        .dismissed_at
        .is_some());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mobility_imported_closed_link_stays_closed_until_opened() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/mobility-closed");
    let parent_id = insert_session_row(&state, WS);
    let child_id = insert_session_row(&state, WS);
    let link = SessionLinkRecord {
        id: "mobility-link".into(),
        public_id: Some("mobility-subagent".into()),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent_id,
        child_session_id: child_id.clone(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-08-11T00:00:00Z".into(),
        subagent_closed_at: Some("2026-08-11T01:00:00Z".into()),
        closed_at: None,
    };
    SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    )
    .import_link(&link)
    .expect("install mobility link");

    assert!(matches!(
        state
            .session_admission
            .acquire(
                &child_id,
                SessionMutationKind::Prompt,
                &SessionMutationSource::external(),
            )
            .await,
        Err(SessionMutationConflict::SubagentOpenRequired)
    ));

    let open_permit = state
        .session_admission
        .acquire(
            &child_id,
            SessionMutationKind::SubagentOpen,
            &SessionMutationSource::external(),
        )
        .await
        .expect("Open is allowed while Closed");
    SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    )
    .open_subagent_operability(&link.id)
    .expect("open imported relationship");
    drop(open_permit);
    assert!(state
        .session_admission
        .acquire(
            &child_id,
            SessionMutationKind::Prompt,
            &SessionMutationSource::external(),
        )
        .await
        .is_ok());
}

#[test]
fn emulated_loop_fire_holds_the_session_permit_before_prompt_delivery() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/domains/loops/runtime/fire_executor.rs");
    let source = std::fs::read_to_string(path).expect("read loop fire executor");
    let body = source
        .split_once("async fn fire(")
        .expect("fire implementation")
        .1;
    let permit = body.find(".acquire(").expect("session permit");
    let handle = body.find("get_handle(").expect("live handle lookup");
    let prompt = body
        .find("send_text_prompt_with_provenance_on_existing_handle(")
        .expect("checkpoint-aware prompt delivery");
    let accounting = body.find("run_domain_op(").expect("durable accounting");
    assert!(permit < handle && handle < prompt && prompt < accounting);
}
