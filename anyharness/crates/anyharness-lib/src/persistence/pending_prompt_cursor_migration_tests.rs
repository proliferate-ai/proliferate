use crate::app::test_support;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

#[test]
fn backfill_prevents_reuse_of_drained_and_reordered_prompt_sequences() {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
    let store = SessionStore::new(db.clone());
    store.insert(&session()).expect("insert session");
    let mut child = session();
    child.id = "child".to_string();
    store.insert(&child).expect("insert child session");
    SessionLinkStore::new(db.clone())
        .insert(&SessionLinkRecord {
            id: "link-1".to_string(),
            public_id: Some("subagent-1".to_string()),
            relation: SessionLinkRelation::Subagent,
            parent_session_id: "session-1".to_string(),
            child_session_id: "child".to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
            label: None,
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            subagent_closed_at: None,
            closed_at: None,
        })
        .expect("insert session link");
    for (event_seq, event_type, payload_json) in [
        (
            1,
            "pending_prompt_added",
            serde_json::json!({
                "type": "pending_prompt_added",
                "seq": 4,
                "text": "already drained",
                "queuedAt": "2026-03-25T00:01:00Z",
            })
            .to_string(),
        ),
        (
            2,
            "pending_prompts_reordered",
            serde_json::json!({
                "type": "pending_prompts_reordered",
                "pendingPrompts": [{
                    "seq": 7,
                    "text": "later drained",
                    "queuedAt": "2026-03-25T00:02:00Z",
                }],
            })
            .to_string(),
        ),
        (
            3,
            "pending_prompts_reordered",
            r#"{"type":"pending_prompts_reordered","pendingPrompts":["malformed"]}"#.to_string(),
        ),
        (
            4,
            "pending_prompt_added",
            r#"{"type":"pending_prompt_added","seq":9223372036854775807}"#.to_string(),
        ),
        (
            5,
            "pending_prompt_added",
            r#"{"type":"pending_prompt_added","seq":9223372036854775808}"#.to_string(),
        ),
        (
            6,
            "pending_prompts_reordered",
            r#"{"type":"pending_prompts_reordered","pendingPrompts":[{"seq":9223372036854775807}]}"#.to_string(),
        ),
        (
            7,
            "pending_prompts_reordered",
            r#"{"type":"pending_prompts_reordered","pendingPrompts":[{"seq":9223372036854775808}]}"#.to_string(),
        ),
    ] {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: "session-1".to_string(),
                seq: event_seq,
                timestamp: "2026-03-25T00:03:00Z".to_string(),
                event_type: event_type.to_string(),
                turn_id: None,
                item_id: None,
                payload_json,
            })
            .expect("append historical queue event");
    }
    db.with_conn(|conn| {
        conn.execute_batch(
            "INSERT INTO session_events (
                session_id, seq, timestamp, event_type, payload_json
             ) VALUES (
                'session-1', 8, '2026-03-25T00:03:00Z',
                'pending_prompts_reordered', '{'
             );
             INSERT INTO session_link_completions (
                completion_id, session_link_id, child_turn_id, child_last_event_seq,
                outcome, parent_prompt_seq, created_at, updated_at
             ) VALUES (
                'projection-1', 'link-1', 'turn-1', 1, 'completed', 9,
                '2026-03-25T00:03:00Z', '2026-03-25T00:03:00Z'
             );
             INSERT INTO session_link_completion_deliveries (
                delivery_id, completion_id, session_link_id, parent_session_id,
                child_session_id, child_turn_id, child_last_event_seq, outcome,
                notification_text, state, parent_prompt_seq, retired_prompt_seq,
                next_attempt_at, created_at, updated_at
             ) VALUES (
                'delivery-1', 'delivery-completion-1', 'link-1', 'session-1',
                'child', 'turn-2', 2, 'completed', 'done', 'delivered', 10,
                9223372036854775807,
                '2026-03-25T00:03:00Z', '2026-03-25T00:03:00Z',
                '2026-03-25T00:03:00Z'
             );
             INSERT INTO review_runs (
                id, workspace_id, parent_session_id, kind, status, title, max_rounds,
                current_round_number, created_at, updated_at
             ) VALUES (
                'review-1', 'workspace-1', 'session-1', 'code', 'reviewing',
                'Review', 1, 1, '2026-03-25T00:03:00Z', '2026-03-25T00:03:00Z'
             );
             INSERT INTO review_rounds (
                id, review_run_id, round_number, status, created_at, updated_at
             ) VALUES (
                'round-1', 'review-1', 1, 'reviewing',
                '2026-03-25T00:03:00Z', '2026-03-25T00:03:00Z'
             );
             INSERT INTO review_feedback_jobs (
                id, review_run_id, review_round_id, parent_session_id, state,
                prompt_text, sent_prompt_seq, created_at, updated_at
             ) VALUES (
                'feedback-1', 'review-1', 'round-1', 'session-1', 'sent',
                'revise', 12, '2026-03-25T00:03:00Z', '2026-03-25T00:03:00Z'
             );",
        )?;
        conn.execute(
            "UPDATE sessions SET pending_prompt_seq_cursor = 0 WHERE id = 'session-1'",
            [],
        )?;
        conn.execute_batch(include_str!("sql/0073_pending_prompt_cursor_backfill.sql"))
    })
    .expect("run cursor backfill");

    let (backfilled_cursor, cursor_type): (i64, String) = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT pending_prompt_seq_cursor, typeof(pending_prompt_seq_cursor)
                 FROM sessions WHERE id = 'session-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .expect("read backfilled cursor");
    assert_eq!((backfilled_cursor, cursor_type.as_str()), (12, "integer"));

    let next = store
        .insert_pending_prompt("session-1", "new after upgrade", None)
        .expect("insert after backfill");
    assert_eq!(next.seq, 13);
    assert!(!store
        .has_pending_prompt_added_event(&next)
        .expect("historical event must not match the new allocation"));
}

fn session() -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
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
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}
