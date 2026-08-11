use std::sync::Arc;

use super::*;
use crate::domains::agent_operations::model::{AgentRole, ListAgentsInput};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reversible_open_cold_starts_the_same_native_conversation_without_replay() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("subagent-open");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), false);
    let workspace = runtime_home.join("workspace-a");
    std::fs::create_dir_all(&workspace).expect("workspace");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-a",
        "local",
        &workspace.to_string_lossy(),
    );
    let mut target = session("target", "workspace-a", "idle", "Target");
    target.last_prompt_at = Some("2026-08-11T00:01:00Z".into());
    for record in [session("caller", "workspace-a", "idle", "Caller"), target] {
        state
            .session_service
            .store()
            .insert(&record)
            .expect("session");
    }
    state
        .subagent_service
        .link_child("caller", "target", None, None, None)
        .expect("relationship");
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("initial actor");
    state
        .session_service
        .store()
        .insert_pending_prompt("target", "discarded on Close", Some("discarded"))
        .expect("queued prompt");

    let closed = state
        .session_runtime
        .close_subagent("caller", "target")
        .await
        .expect("reversible close");
    wait_for_actor_gone(&state).await;
    assert_eq!(closed.native_session_id.as_deref(), Some("native-target"));
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("target")
        .unwrap()
        .is_empty());

    let opened = state
        .session_runtime
        .open_subagent("caller", "target")
        .await
        .expect("cold open");
    wait_for_actor_idle(&state).await;
    assert_eq!(opened.native_session_id.as_deref(), Some("native-target"));
    let requests = read_requests(&script.request_log);
    let loads = requests
        .iter()
        .filter(|request| request["method"] == "session/load")
        .collect::<Vec<_>>();
    assert_eq!(loads.len(), 2);
    assert!(loads
        .iter()
        .all(|request| request["params"]["sessionId"] == "native-target"));
    assert!(prompt_texts(&script.request_log).is_empty());

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_promotion_preserves_the_running_turn_and_removes_all_parent_behavior() {
    let _env_lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("subagent-promote");
    let script = write_scripted_agent(&runtime_home);
    let (_program, _args) = install_scripted_agent_env(&script);
    let state = build_state(&runtime_home, Db::open_in_memory().expect("db"), false);
    let workspace = runtime_home.join("workspace-a");
    std::fs::create_dir_all(&workspace).expect("workspace");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-a",
        "local",
        &workspace.to_string_lossy(),
    );
    for record in [
        session("caller", "workspace-a", "idle", "Caller"),
        session("target", "workspace-a", "idle", "Target"),
    ] {
        state
            .session_service
            .store()
            .insert(&record)
            .expect("session");
    }
    let link = state
        .subagent_service
        .link_child("caller", "target", None, None, None)
        .expect("relationship");
    state
        .session_runtime
        .ensure_live_session("target", None)
        .await
        .expect("actor");
    send_direct_prompt(&state, "blocking turn").await;
    wait_for_path(&script.control_dir.join("turn-seen")).await;
    let before = state
        .acp_manager
        .get_handle("target")
        .await
        .expect("running actor");
    assert!(before.is_busy());

    let promoted = state
        .session_runtime
        .promote_subagent("caller", "target")
        .await
        .expect("promote running child");
    let after = state
        .acp_manager
        .get_handle("target")
        .await
        .expect("same actor");
    assert!(Arc::ptr_eq(&before, &after));
    assert!(after.is_busy());
    assert_eq!(promoted.native_session_id.as_deref(), Some("native-target"));
    assert!(state
        .subagent_service
        .list_subagents("caller")
        .unwrap()
        .is_empty());
    assert!(state
        .session_runtime
        .session_link_service
        .find_subagent_link("caller", "target")
        .unwrap()
        .is_none());
    let page = state
        .agent_operations
        .list_agents(
            &state.agent_operations.authenticated_caller("caller"),
            ListAgentsInput::default(),
        )
        .await
        .expect("ordinary roster");
    assert!(page.agents.iter().any(|agent| {
        agent.identity.session_id == "target"
            && agent.role == AgentRole::Ordinary
            && agent.parent.is_none()
    }));

    std::fs::write(script.control_dir.join("release-turn"), b"").expect("release turn");
    wait_for_actor_idle(&state).await;
    assert_eq!(prompt_texts(&script.request_log), ["blocking turn"]);
    assert!(
        crate::domains::sessions::subagents::store::SubagentStore::new(state.db.clone())
            .list_completions_for_links(&[link.id])
            .unwrap()
            .is_empty()
    );
    assert!(state
        .session_service
        .store()
        .list_pending_prompts("caller")
        .unwrap()
        .is_empty());
    assert!(!state
        .session_service
        .store()
        .list_events("caller")
        .unwrap()
        .iter()
        .any(|event| event.event_type == "subagent_turn_completed"));

    stop_target_actor(&state).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
