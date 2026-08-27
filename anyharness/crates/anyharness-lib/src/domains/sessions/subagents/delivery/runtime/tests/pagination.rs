use super::*;

#[tokio::test(flavor = "current_thread", start_paused = true)]
async fn recovery_pages_past_sixty_four_live_candidates_to_repair_retired_tail() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = std::env::temp_dir().join(format!(
        "completion-delivery-pagination-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("workspace");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        Db::open_in_memory().expect("db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "local",
        &workspace_path.to_string_lossy(),
    );
    let store = SessionStore::new(state.db.clone());
    let links = SessionLinkStore::new(state.db.clone());
    store.insert(&session(PARENT_ID)).expect("parent");

    // Install every early candidate's live handle before exposing its link.
    // The AppState worker can run at any await without seeing an unowned row.
    for index in 0..64 {
        let child_id = format!("child-live-{index:03}");
        store.insert(&session(&child_id)).expect("live child");
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: child_id.clone(),
                seq: 1,
                timestamp: "2026-08-11T00:02:00Z".into(),
                event_type: "turn_started".into(),
                turn_id: Some(format!("turn-live-{index:03}")),
                item_id: None,
                payload_json: r#"{"type":"turn_started"}"#.into(),
            })
            .expect("live open turn");
        state
            .acp_manager
            .insert_unavailable_session_for_test(&child_id)
            .await;
        links
            .insert(&SessionLinkRecord {
                id: format!("link-{index:03}"),
                public_id: Some(format!("subagent-{index:03}")),
                relation: SessionLinkRelation::Subagent,
                parent_session_id: PARENT_ID.into(),
                child_session_id: child_id,
                workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                label: Some(format!("live-{index:03}")),
                created_by_turn_id: None,
                created_by_tool_call_id: None,
                created_at: "2026-08-11T00:00:00Z".into(),
                subagent_closed_at: None,
                closed_at: None,
            })
            .expect("live link");
    }
    tokio::task::yield_now().await;

    // Paused time keeps the AppState worker asleep after its initial pass, so
    // this retired lexical tail is first observed by the explicit run below.
    store.insert(&session(CHILD_ID)).expect("tail child");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: CHILD_ID.into(),
            seq: 1,
            timestamp: "2026-08-11T00:02:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-open".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("tail open turn");
    links
        .insert(&SessionLinkRecord {
            id: "link-999-tail".into(),
            public_id: Some("subagent-tail".into()),
            relation: SessionLinkRelation::Subagent,
            parent_session_id: PARENT_ID.into(),
            child_session_id: CHILD_ID.into(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: Some("tail".into()),
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-08-11T00:00:00Z".into(),
            subagent_closed_at: Some("2026-08-11T00:01:00Z".into()),
            closed_at: None,
        })
        .expect("tail link");

    let repair_worker = worker(&state);
    assert_eq!(
        repair_worker.repair_retired_subagent_turns().await.unwrap(),
        1
    );
    assert_eq!(
        repair_worker.repair_retired_subagent_turns().await.unwrap(),
        0
    );
    assert_one_cancelled_terminal_and_delivery(&state);
    for index in 0..64 {
        let events = store
            .list_events(&format!("child-live-{index:03}"))
            .expect("live events");
        assert_eq!(events.len(), 1, "live actor turn must remain untouched");
        assert_eq!(events[0].event_type, "turn_started");
    }
}
