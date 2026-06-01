use super::*;

#[test]
fn title_from_markdown_uses_first_heading_without_marker() {
    assert_eq!(
        title_from_markdown("# Repo Issue Investigation\n\n## Goal\nFind issues"),
        Some("Repo Issue Investigation".to_string())
    );
}

#[test]
fn extract_tagged_proposed_plan_requires_complete_wrapper() {
    assert_eq!(
        extract_tagged_proposed_plan(
            "\n<proposed_plan>\n# Plan: Tighten review\n\nDo the work.\n</proposed_plan>\n"
        )
        .as_deref(),
        Some("# Plan: Tighten review\n\nDo the work.")
    );
    assert!(extract_tagged_proposed_plan("# Plan\n\nNo wrapper").is_none());
    assert!(extract_tagged_proposed_plan("<proposed_plan># Plan").is_none());
}

#[tokio::test]
async fn handle_notification_persists_raw_acp_notifications() {
    let db = Db::open_in_memory().expect("open db");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("insert session");

    let (event_tx, _) = broadcast::channel(16);
    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        store.clone(),
    )));
    let mut startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![],
        current_model_id: None,
        available_model_ids: vec![],
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    let mut persisted_config_state = PersistedSessionConfigState {
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
    };
    let mut background_work_registry = test_background_work_registry(&store);

    let notif = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("hello".into())),
    );

    handle_notification(
        &notif,
        &event_sink,
        &mut background_work_registry,
        &store,
        "session-1",
        "workspace-1",
        "claude",
        test_plan_service(&db),
        None,
        &mut persisted_config_state,
        &mut startup_state,
    )
    .await;

    let raw = store
        .list_raw_notifications("session-1")
        .expect("list raw notifications");
    assert_eq!(raw.len(), 1);
    assert_eq!(raw[0].seq, 1);
    assert_eq!(raw[0].notification_kind, "agent_message_chunk");

    let payload: serde_json::Value =
        serde_json::from_str(&raw[0].payload_json).expect("deserialize raw payload");
    assert_eq!(payload["sessionId"], "native-1");
    assert_eq!(payload["update"]["sessionUpdate"], "agent_message_chunk");
}

#[test]
fn resume_replay_filter_suppresses_after_user_echo_until_quiet_gap() {
    let mut filter = ResumeReplayFilter::new(
        "codex",
        NativeSessionStartupDisposition::LoadedExisting,
        "running",
    );
    let base = Instant::now();

    let user_echo = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("older prompt".into())),
    );
    let replay_assistant = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("older answer".into())),
    );
    let replay_config = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::ConfigOptionUpdate(acp::ConfigOptionUpdate::new(vec![])),
    );
    let available_commands = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AvailableCommandsUpdate(acp::AvailableCommandsUpdate::new(vec![])),
    );
    let fresh_assistant = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("fresh answer".into())),
    );

    assert!(filter.should_suppress(&user_echo, base));
    assert!(filter.should_suppress(&replay_assistant, base + Duration::from_millis(10)));
    assert!(filter.should_suppress(&replay_config, base + Duration::from_millis(20)));
    assert!(!filter.should_suppress(&available_commands, base + Duration::from_millis(30)));
    assert!(!filter.should_suppress(
        &fresh_assistant,
        base + Duration::from_millis(20)
            + IDLE_RESUME_REPLAY_QUIET_WINDOW
            + Duration::from_millis(10),
    ));
}

#[test]
fn resume_replay_filter_disable_allows_current_prompt_after_loaded_session() {
    let mut filter = ResumeReplayFilter::new(
        "codex",
        NativeSessionStartupDisposition::LoadedExisting,
        "idle",
    );
    let base = Instant::now();
    filter.disable();

    let user_echo = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("current prompt".into())),
    );
    let assistant = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("fresh answer".into())),
    );

    assert!(!filter.should_suppress(&user_echo, base));
    assert!(!filter.should_suppress(&assistant, base + Duration::from_millis(10)));
}

#[test]
fn resume_replay_filter_ignores_non_resume_agent_chunks() {
    let mut filter = ResumeReplayFilter::new(
        "claude",
        NativeSessionStartupDisposition::CreatedFresh,
        "idle",
    );
    let base = Instant::now();
    let assistant = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new("fresh answer".into())),
    );

    assert!(!filter.should_suppress(&assistant, base));
}

#[test]
fn resume_replay_filter_stays_disabled_for_zero_turn_fresh_native_resumes() {
    let mut filter = ResumeReplayFilter::new(
        "claude",
        NativeSessionStartupDisposition::CreatedFresh,
        "idle",
    );
    let base = Instant::now();
    let user_echo = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("current prompt".into())),
    );

    assert!(!filter.should_suppress(&user_echo, base));
}

#[tokio::test]
async fn replay_filter_keeps_raw_notifications_but_skips_normalized_transcript_events() {
    let db = Db::open_in_memory().expect("open db");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");

    let store = SessionStore::new(db.clone());
    store
        .insert(&SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: Some("native-1".to_string()),
            agent_auth_scope: None,
            required_agent_auth_revision: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy:
                crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        })
        .expect("insert session");

    let (event_tx, _) = broadcast::channel(16);
    let event_sink = Arc::new(Mutex::new(SessionEventSink::new(
        "session-1".to_string(),
        "claude".to_string(),
        PathBuf::from("/tmp/workspace"),
        event_tx,
        store.clone(),
    )));
    let mut startup_state = SessionStartupState {
        current_mode_id: None,
        legacy_mode_state: None,
        config_options: vec![],
        current_model_id: None,
        available_model_ids: vec![],
        prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
    };
    let mut persisted_config_state = PersistedSessionConfigState {
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
    };
    let mut replay_filter = ResumeReplayFilter::new(
        "claude",
        NativeSessionStartupDisposition::LoadedExisting,
        "idle",
    );
    let mut background_work_registry = test_background_work_registry(&store);

    let replay_user = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::UserMessageChunk(acp::ContentChunk::new("older prompt".into())),
    );
    handle_notification_with_resume_replay_filter(
        &replay_user,
        &mut replay_filter,
        &event_sink,
        &mut background_work_registry,
        &store,
        "session-1",
        "workspace-1",
        "claude",
        test_plan_service(&db),
        None,
        &mut persisted_config_state,
        &mut startup_state,
    )
    .await;

    assert_eq!(
        store
            .list_raw_notifications("session-1")
            .expect("raw")
            .len(),
        1
    );
    assert!(store.list_events("session-1").expect("events").is_empty());

    let replay_config = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::ConfigOptionUpdate(acp::ConfigOptionUpdate::new(vec![])),
    );
    handle_notification_with_resume_replay_filter(
        &replay_config,
        &mut replay_filter,
        &event_sink,
        &mut background_work_registry,
        &store,
        "session-1",
        "workspace-1",
        "claude",
        test_plan_service(&db),
        None,
        &mut persisted_config_state,
        &mut startup_state,
    )
    .await;

    assert_eq!(
        store
            .list_raw_notifications("session-1")
            .expect("raw after config replay")
            .len(),
        2
    );
    assert!(store
        .list_events("session-1")
        .expect("events after config replay")
        .is_empty());

    let available_commands = acp::SessionNotification::new(
        "native-1",
        acp::SessionUpdate::AvailableCommandsUpdate(acp::AvailableCommandsUpdate::new(vec![])),
    );
    handle_notification_with_resume_replay_filter(
        &available_commands,
        &mut replay_filter,
        &event_sink,
        &mut background_work_registry,
        &store,
        "session-1",
        "workspace-1",
        "claude",
        test_plan_service(&db),
        None,
        &mut persisted_config_state,
        &mut startup_state,
    )
    .await;

    let raw = store
        .list_raw_notifications("session-1")
        .expect("raw after passthrough");
    let events = store
        .list_events("session-1")
        .expect("events after passthrough");
    assert_eq!(raw.len(), 3);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "available_commands_update");
}
