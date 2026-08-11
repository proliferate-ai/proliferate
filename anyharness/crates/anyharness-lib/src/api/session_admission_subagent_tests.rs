use std::sync::Arc;

use super::*;
use crate::domains::agent_operations::model::AgentIdentity;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::subagents::mcp::auth::SubagentMcpAuth;
use crate::domains::sessions::subagents::mcp::context::SubagentMcpContext;
use crate::domains::sessions::subagents::mcp::SubagentProductMcpServer;
use crate::integrations::mcp::product_server::ProductMcpServer;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn app_wiring_enforces_reversible_subagent_operability() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
async fn http_wake_and_close_have_one_child_gate_and_no_late_schedule() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);

    let state = Arc::new(test_state());
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/http-wake-first");
    let parent_id = insert_session_row(&state, WS);
    let child_id = insert_session_row(&state, WS);
    state
        .subagent_service
        .link_child(&parent_id, &child_id, None, None, None)
        .expect("link child");

    let held_child_gate = state
        .session_admission
        .acquire(
            &child_id,
            SessionMutationKind::SubagentClose,
            &SessionMutationSource::external(),
        )
        .await
        .expect("hold child gate");
    let wake_state = state.clone();
    let wake_parent = parent_id.clone();
    let wake_child = child_id.clone();
    let wake = tokio::spawn(async move {
        call(
            &wake_state,
            "POST",
            format!("/v1/sessions/{wake_parent}/subagents/{wake_child}/wake"),
            Some(json!({})),
        )
        .await
    });
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(
        !wake.is_finished(),
        "HTTP wake must wait on the child gate, never the parent gate"
    );
    drop(held_child_gate);
    let (status, payload) = wake.await.expect("wake task");
    assert_eq!(status, StatusCode::OK, "{payload}");

    close_through_agent_operations(&state, &parent_id, &child_id).await;
    assert_no_wake_or_parent_prompt(&state, &parent_id);

    let closed_first = Arc::new(test_state());
    test_support::seed_workspace_with_repo_root(
        &closed_first.db,
        WS,
        "local",
        "/tmp/http-close-first",
    );
    let parent_id = insert_session_row(&closed_first, WS);
    let child_id = insert_session_row(&closed_first, WS);
    closed_first
        .subagent_service
        .link_child(&parent_id, &child_id, None, None, None)
        .expect("link child");
    close_through_agent_operations(&closed_first, &parent_id, &child_id).await;
    let (status, payload) = call(
        &closed_first,
        "POST",
        format!("/v1/sessions/{parent_id}/subagents/{child_id}/wake"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{payload}");
    assert_eq!(payload["code"], "SUBAGENT_OPEN_REQUIRED");
    assert_no_wake_or_parent_prompt(&closed_first, &parent_id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn http_wake_wrong_parent_cannot_probe_child_operability_or_controller() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WS,
        "local",
        "/tmp/http-wake-anti-enumeration",
    );
    let owner_id = insert_session_row(&state, WS);
    let wrong_parent_id = insert_session_row(&state, WS);
    let open_child_id = insert_session_row(&state, WS);
    let closed_child_id = insert_session_row(&state, WS);
    let controlled_child_id = insert_session_row(&state, WS);
    for child_id in [&open_child_id, &closed_child_id, &controlled_child_id] {
        state
            .subagent_service
            .link_child(&owner_id, child_id, None, None, None)
            .expect("link child to its real parent");
    }
    close_through_agent_operations(&state, &owner_id, &closed_child_id).await;

    let workflow_service = WorkflowRunService::new(WorkflowRunStore::new(state.db.clone()));
    let run_id = uuid::Uuid::new_v4().to_string();
    workflow_service
        .accept(
            &run_id,
            super::super::workflow_runs_tests::domain_input_for_workspace(WS),
        )
        .expect("accept workflow run");
    assert!(workflow_service.begin_run(&run_id).expect("begin run"));
    assert!(workflow_service
        .bind_session(&run_id, &controlled_child_id)
        .expect("bind controlled child"));

    let mut public_results = Vec::new();
    for child_id in [&open_child_id, &closed_child_id, &controlled_child_id] {
        public_results.push(
            call(
                &state,
                "POST",
                format!("/v1/sessions/{wrong_parent_id}/subagents/{child_id}/wake"),
                Some(json!({})),
            )
            .await,
        );
    }

    let expected = &public_results[0];
    assert_eq!(expected.0, StatusCode::CONFLICT, "{}", expected.1);
    assert_eq!(expected.1["code"], "SUBAGENT_NOT_OWNED");
    for result in &public_results[1..] {
        assert_eq!(
            result, expected,
            "wrong-parent result must not reveal Closed or workflow-controlled state"
        );
    }
    assert_no_wake_or_parent_prompt(&state, &owner_id);
    assert!(state
        .session_service
        .store()
        .list_pending_prompts(&wrong_parent_id)
        .expect("wrong-parent pending prompts")
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mobility_imported_closed_link_stays_closed_until_opened() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    state
        .subagent_service
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

async fn close_through_agent_operations(state: &AppState, parent_id: &str, child_id: &str) {
    let caller = state.agent_operations.authenticated_caller(parent_id);
    let target = AgentIdentity::new(state.agent_operations.runtime_identity().clone(), child_id);
    state
        .agent_operations
        .close_subagent(&caller, &target)
        .await
        .expect("close subagent");
}

fn assert_no_wake_or_parent_prompt(state: &AppState, parent_id: &str) {
    let context = state
        .subagent_service
        .subagent_context(parent_id)
        .expect("subagent context");
    assert!(context.children.iter().all(|child| !child.wake_scheduled));
    assert!(state
        .session_service
        .store()
        .list_pending_prompts(parent_id)
        .expect("parent pending prompts")
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_subagent_mcp_uses_the_shared_child_gate_and_cannot_bypass_closed() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/legacy-mcp-gate");
    let parent_id = insert_session_row(&state, WS);
    let child_id = insert_session_row(&state, WS);
    let link = state
        .subagent_service
        .link_child(&parent_id, &child_id, Some("worker".into()), None, None)
        .expect("link child");
    let auth_home = std::env::temp_dir().join(format!("legacy-mcp-auth-{}", uuid::Uuid::new_v4()));
    let server = Arc::new(SubagentProductMcpServer::new(
        state.subagent_service.clone(),
        state.session_runtime.clone(),
        state.workspace_runtime.clone(),
        state.session_admission.clone(),
        state.workspace_operation_gate.clone(),
        Arc::new(SubagentMcpAuth::new(auth_home)),
    ));
    let ctx = SubagentMcpContext {
        parent_session_id: parent_id.clone(),
        workspace_id: WS.into(),
        can_create: true,
        create_block_reason: None,
        existing_subagent_count: 1,
        max_subagents_per_parent: 8,
    };

    let held = state
        .session_admission
        .acquire(
            &child_id,
            SessionMutationKind::SubagentClose,
            &SessionMutationSource::external(),
        )
        .await
        .expect("hold child gate");
    let scheduled_server = server.clone();
    let scheduled_ctx = ctx.clone();
    let public_id = link.public_id.clone().expect("public id");
    let scheduled = tokio::spawn(async move {
        scheduled_server
            .call_tool(
                &scheduled_ctx,
                "schedule_subagent_wake",
                Some(json!({"subagentId": public_id})),
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(
        !scheduled.is_finished(),
        "legacy mutation must wait on child gate"
    );
    drop(held);
    scheduled.await.unwrap().expect("wake after gate release");

    state
        .session_runtime
        .close_subagent(&parent_id, &child_id)
        .await
        .expect("reversible close");
    for (tool, args) in [
        (
            "schedule_subagent_wake",
            json!({"subagentId": link.public_id.clone()}),
        ),
        (
            "send_subagent_message",
            json!({"subagentId": link.public_id.clone(), "prompt": "blocked"}),
        ),
        (
            "close_subagent",
            json!({"subagentId": link.public_id.clone()}),
        ),
    ] {
        let error = server
            .call_tool(&ctx, tool, Some(args))
            .await
            .expect_err("Closed child cannot be mutated by legacy MCP");
        assert!(
            error.to_string().contains("must be opened"),
            "{tool}: {error}"
        );
    }
    server
        .call_tool(
            &ctx,
            "get_subagent_status",
            Some(json!({"subagentId": link.public_id.clone()})),
        )
        .await
        .expect("read remains available");
}

#[test]
fn every_legacy_subagent_mutation_takes_the_permit_before_the_workspace_lease() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/domains/sessions/subagents/mcp/calls/mutations.rs");
    let source = std::fs::read_to_string(path).expect("read legacy mutation owner");
    for name in [
        "create_subagent",
        "send_subagent_message",
        "schedule_subagent_wake",
        "close_subagent",
    ] {
        let signature = format!("pub(super) async fn {name}(");
        let body = source
            .split_once(&signature)
            .unwrap_or_else(|| panic!("missing {name}"))
            .1
            .split("\npub(super) async fn ")
            .next()
            .expect("function body");
        let permit = body
            .find("admit_legacy_subagent_mutation(")
            .unwrap_or_else(|| panic!("{name} missing session permit"));
        let lease = body
            .find(".acquire_shared(")
            .unwrap_or_else(|| panic!("{name} missing workspace lease"));
        assert!(permit < lease, "{name} must acquire permit before lease");
    }
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
    let prompt = body.find("send_prompt(").expect("prompt delivery");
    let accounting = body.find("run_domain_op(").expect("durable accounting");
    assert!(permit < handle && handle < prompt && prompt < accounting);
}
