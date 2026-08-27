//! File-backed restart/recovery coverage for the completion delivery
//! worker, split from `tests.rs` to keep it under the repo line ceiling.

use super::*;

#[tokio::test(flavor = "current_thread")]
async fn file_backed_pending_capture_survives_restart_and_enqueues_once() {
    let _lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = std::env::temp_dir().join(format!(
        "completion-delivery-file-restart-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("workspace");
    let db = Db::open(&runtime_home).expect("file-backed db");
    test_support::seed_workspace_with_repo_root(
        &db,
        WORKSPACE_ID,
        "local",
        &workspace_path.to_string_lossy(),
    );
    let store = SessionStore::new(db.clone());
    let mut parent = session(PARENT_ID);
    parent.agent_kind = "missing-agent".to_string();
    store.insert(&parent).expect("parent");
    store.insert(&session(CHILD_ID)).expect("child");
    SessionLinkStore::new(db.clone())
        .insert(&SessionLinkRecord {
            id: "link-file-restart".into(),
            public_id: Some("subagent-file-restart".into()),
            relation: SessionLinkRelation::Subagent,
            parent_session_id: PARENT_ID.into(),
            child_session_id: CHILD_ID.into(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: Some("worker".into()),
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-08-11T00:00:00Z".into(),
            subagent_closed_at: None,
            closed_at: None,
        })
        .expect("link");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: CHILD_ID.into(),
            seq: 1,
            timestamp: "2026-08-11T00:01:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-before-crash".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("turn start");
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "terminal-before-crash".into(),
            session_id: CHILD_ID.into(),
            turn_id: "turn-before-crash".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("final output".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: CHILD_ID.into(),
                seq: 2,
                timestamp: "2026-08-11T00:02:00Z".into(),
                turn_id: Some("turn-before-crash".into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:02:00Z".into(),
        })
        .expect("atomic terminal capture");
    let captured = CompletionDeliveryStore::new(db.clone())
        .list_all_for_test()
        .expect("captured delivery");
    assert_eq!(captured.len(), 1);
    let delivery_id = captured[0].delivery_id.clone();
    assert_eq!(captured[0].state, CompletionDeliveryState::Pending);
    drop(store);
    drop(db);

    let restarted = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".into(),
        Db::open(&runtime_home).expect("reopen db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("restarted app state");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let pending = restarted
                .session_service
                .store()
                .list_pending_prompts(PARENT_ID)
                .expect("parent queue");
            if pending.len() == 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restarted worker enqueued capture");
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let pending = restarted
        .session_service
        .store()
        .list_pending_prompts(PARENT_ID)
        .expect("stable parent queue");
    assert_eq!(pending.len(), 1);
    let expected_prompt_id = format!("subagent_completion:{delivery_id}");
    assert_eq!(
        pending[0].prompt_id.as_deref(),
        Some(expected_prompt_id.as_str())
    );
    let deliveries = CompletionDeliveryStore::new(restarted.db.clone())
        .list_all_for_test()
        .expect("restarted deliveries");
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].delivery_id, delivery_id);
    let projection_count: i64 = restarted
        .db
        .with_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })
        })
        .expect("projection count");
    assert_eq!(projection_count, 1);

    drop(restarted);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "current_thread")]
async fn file_backed_closed_open_turn_is_repaired_by_restarted_worker() {
    let _lock = test_support::lock_env();
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = std::env::temp_dir().join(format!(
        "completion-delivery-closed-restart-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("workspace");
    let state_before = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".into(),
        Db::open(&runtime_home).expect("file-backed db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("state before restart");
    test_support::seed_workspace_with_repo_root(
        &state_before.db,
        WORKSPACE_ID,
        "local",
        &workspace_path.to_string_lossy(),
    );
    seed_subagent_open_turn(&state_before, true, false, true).await;
    assert!(worker(&state_before)
        .repair_retired_subagent_turns()
        .await
        .is_err());
    assert_open_turn_without_delivery(&state_before);
    drop(state_before);

    let reopened_db = Db::open(&runtime_home).expect("reopen db");
    reopened_db
        .with_conn(|conn| conn.execute_batch("DROP TRIGGER reject_closed_repair_delivery;"))
        .expect("remove failure after crash");
    let restarted = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".into(),
        reopened_db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("restarted state");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if CompletionDeliveryStore::new(restarted.db.clone())
                .list_all_for_test()
                .is_ok_and(|rows| rows.len() == 1)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restarted worker repaired Closed child");
    assert_one_cancelled_terminal_and_delivery(&restarted);

    drop(restarted);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}
