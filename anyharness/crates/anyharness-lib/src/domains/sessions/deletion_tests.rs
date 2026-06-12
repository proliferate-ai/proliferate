use super::SessionDeleteWorkflow;
use crate::domains::cowork::store::CoworkDeleteParticipant;
use crate::domains::reviews::store::ReviewDeleteParticipant;
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;
use std::sync::Arc;

#[test]
fn delete_session_removes_cross_domain_dependents() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_and_repo(&db);
    let store = SessionStore::new(db.clone());
    store
        .insert(&session_record("session-1"))
        .expect("insert parent session");
    store
        .insert(&session_record("session-child"))
        .expect("insert child session");
    seed_cross_domain_dependents(&db);

    test_delete_workflow(db.clone())
        .delete_session("session-1")
        .expect("delete session graph");

    assert_eq!(count_where(&db, "sessions", "id = 'session-1'"), 0);
    assert_eq!(count_where(&db, "sessions", "id = 'session-child'"), 1);
    assert_eq!(count_all(&db, "cowork_threads"), 0);
    assert_eq!(count_all(&db, "cowork_managed_workspaces"), 0);
    assert_eq!(count_all(&db, "review_feedback_jobs"), 0);
    assert_eq!(count_all(&db, "review_assignments"), 0);
    assert_eq!(count_all(&db, "review_rounds"), 0);
    assert_eq!(count_all(&db, "review_runs"), 0);
    assert_eq!(count_all(&db, "session_link_wake_schedules"), 0);
    assert_eq!(count_all(&db, "session_link_completions"), 0);
    assert_eq!(count_all(&db, "session_links"), 0);
}

fn test_delete_workflow(db: Db) -> SessionDeleteWorkflow {
    SessionDeleteWorkflow::with_participants(
        db,
        vec![
            Arc::new(CoworkDeleteParticipant),
            Arc::new(ReviewDeleteParticipant),
        ],
    )
}

fn seed_workspace_and_repo(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (
                'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                NULL, NULL, '2026-03-25T00:00:00Z', '2026-03-25T00:00:00Z'
             )",
            [],
        )?;
        conn.execute(
            "INSERT INTO workspaces (
                id, kind, repo_root_id, path, surface, lifecycle_state, cleanup_state,
                created_at, updated_at
             ) VALUES (
                'workspace-1', 'worktree', 'repo-root-1', '/tmp/workspace-1',
                'standard', 'active', 'none', ?1, ?1
             )",
            ["2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace and repo");
}

fn seed_cross_domain_dependents(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO cowork_threads (
                id, repo_root_id, workspace_id, session_id, agent_kind, requested_model_id,
                branch_name, created_at
             ) VALUES (
                'thread-1', 'repo-root-1', 'workspace-1', 'session-1', 'claude', NULL,
                'main', '2026-03-25T00:01:00Z'
             )",
            [],
        )?;
        conn.execute(
            "INSERT INTO cowork_managed_workspaces (
                id, parent_session_id, workspace_id, label, created_at
             ) VALUES (
                'managed-1', 'session-1', 'workspace-1', 'Managed', '2026-03-25T00:01:01Z'
             )",
            [],
        )?;
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation,
                created_at
             ) VALUES ('link-1', 'subagent', 'session-1', 'session-child', 'same_workspace', ?1)",
            ["2026-03-25T00:01:02Z"],
        )?;
        conn.execute(
            "INSERT INTO session_link_completions (
                completion_id, session_link_id, child_turn_id, child_last_event_seq,
                outcome, created_at, updated_at
             ) VALUES (
                'completion-1', 'link-1', 'turn-child-1', 42,
                'completed', ?1, ?1
             )",
            ["2026-03-25T00:01:03Z"],
        )?;
        conn.execute(
            "INSERT INTO session_link_wake_schedules (session_link_id)
             VALUES ('link-1')",
            [],
        )?;
        conn.execute(
            "INSERT INTO review_runs (
                id, workspace_id, parent_session_id, kind, status, title, max_rounds,
                auto_iterate, current_round_number, created_at, updated_at
             ) VALUES (
                'review-run-1', 'workspace-1', 'session-1', 'code', 'reviewing',
                'Review', 2, 1, 1, ?1, ?1
             )",
            ["2026-03-25T00:01:04Z"],
        )?;
        conn.execute(
            "INSERT INTO review_rounds (
                id, review_run_id, round_number, status, created_at, updated_at
             ) VALUES (
                'review-round-1', 'review-run-1', 1, 'reviewing', ?1, ?1
             )",
            ["2026-03-25T00:01:05Z"],
        )?;
        conn.execute(
            "INSERT INTO review_assignments (
                id, review_run_id, review_round_id, reviewer_session_id, session_link_id,
                persona_id, persona_label, persona_prompt, agent_kind, status, deadline_at,
                created_at, updated_at
             ) VALUES (
                'assignment-1', 'review-run-1', 'review-round-1', 'session-child', 'link-1',
                'skeptic', 'Skeptic', 'Find issues.', 'claude', 'reviewing', ?1, ?1, ?1
             )",
            ["2026-03-25T00:31:00Z"],
        )?;
        conn.execute(
            "INSERT INTO review_feedback_jobs (
                id, review_run_id, review_round_id, parent_session_id, state, prompt_text,
                created_at, updated_at
             ) VALUES (
                'feedback-job-1', 'review-run-1', 'review-round-1', 'session-1',
                'pending', 'Revise this.', ?1, ?1
             )",
            ["2026-03-25T00:01:06Z"],
        )?;
        Ok(())
    })
    .expect("seed cross-domain dependents");
}

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_scope: None,
        required_agent_auth_revision: None,
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

fn count_all(db: &Db, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    db.with_conn(|conn| conn.query_row(&sql, [], |row| row.get(0)))
        .expect("count all rows")
}

fn count_where(db: &Db, table: &str, where_clause: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {where_clause}");
    db.with_conn(|conn| conn.query_row(&sql, [], |row| row.get(0)))
        .expect("count filtered rows")
}
