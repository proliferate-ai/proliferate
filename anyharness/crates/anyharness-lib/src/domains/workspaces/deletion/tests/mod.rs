//! `deletion/mod.rs`'s own suite — the surviving `WorkspaceDeleteWorkflow`
//! half. Purge's own suite lives in `purge_tests.rs`, next to it in this same
//! directory.
//!
//! The single test below is `deletion_tests.rs`'s
//! `purge_workspace_deletes_sessions_and_workspace_scoped_dependents`,
//! rewritten against the split surfaces: the method it exercised
//! (`purge_workspace_with_sessions`) no longer exists, split into
//! `SessionDeleteWorkflow::delete_artifacts_for_workspace` (the session
//! graph — including `cowork_threads`, via the same `CoworkDeleteParticipant`
//! callback `delete_session_graph_in_tx` already invokes per session, because
//! `cowork_threads.session_id` carries no cascade) and the store's own
//! `delete_workspace` (the row) — exactly the two calls purge itself
//! composes. `workspace_access_modes` and `terminal_command_runs` DO carry
//! `ON DELETE CASCADE` against `workspaces(id)`, so `store.delete_workspace`
//! alone clears those once the sessions are already gone — this test is the
//! direct proof of that cascade, not an assumption.

mod purge_checkpoint_tests;
mod purge_harness;
mod purge_tests;

use super::WorkspaceDeleteWorkflow;
use crate::domains::cowork::store::CoworkDeleteParticipant;
use crate::domains::reviews::store::ReviewDeleteParticipant;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::store::SessionStore;
use crate::domains::terminals::model::{
    TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus, TerminalPurpose,
};
use crate::domains::terminals::store::TerminalStore;
use crate::persistence::Db;
use std::path::Path;
use std::sync::Arc;

#[test]
fn deleting_session_artifacts_then_the_row_clears_sessions_and_workspace_scoped_dependents() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_and_repo(&db);
    let session_store = SessionStore::new(db.clone());
    session_store
        .insert(&session_record("session-1"))
        .expect("insert session");
    session_store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("insert event");
    let terminal_store = TerminalStore::new(db.clone());
    terminal_store
        .insert_command_run(&terminal_run_record())
        .expect("insert terminal run");
    terminal_store
        .set_latest_setup_run("workspace-1", "terminal-run-1")
        .expect("set setup run");
    seed_workspace_scoped_dependents(&db);

    let runtime_home =
        std::env::temp_dir().join(format!("anyharness-deletion-test-{}", uuid::Uuid::new_v4()));
    let session_delete_workflow = test_session_delete_workflow(db.clone());

    // The split surfaces purge itself composes: artifacts + session graph
    // rows FIRST, then the workspace row.
    session_delete_workflow
        .delete_artifacts_for_workspace("workspace-1", Path::new("/tmp/workspace-1"), &runtime_home)
        .expect("delete session artifacts for workspace");
    assert_eq!(count_all(&db, "sessions"), 0);
    assert_eq!(count_all(&db, "session_events"), 0);
    // Session-scoped, no cascade: dies via the participant callback inside
    // `delete_session_graph_in_tx`, before the workspace row is touched.
    assert_eq!(count_all(&db, "cowork_threads"), 0);
    // The row is still present at this point — row dies LAST is the whole
    // contract, and this is the assertion that proves it holds even one call
    // outside the orchestrator that composes both halves.
    assert_eq!(count_all(&db, "workspaces"), 1);

    crate::domains::workspaces::store::WorkspaceStore::new(db.clone())
        .delete_workspace("workspace-1")
        .expect("delete workspace row");

    // Workspace-scoped, `ON DELETE CASCADE`: die for free the moment the row
    // does, with no explicit participant call needed.
    assert_eq!(count_all(&db, "workspaces"), 0);
    assert_eq!(count_all(&db, "workspace_access_modes"), 0);
    assert_eq!(count_all(&db, "workspace_setup_state"), 0);
    assert_eq!(count_all(&db, "terminal_command_runs"), 0);
}

/// `WorkspaceDeleteWorkflow::delete_workspace_record` — the surviving,
/// non-purge half of this module, used by workspace materialization. Asserts
/// it still deletes the workspace-scoped graph rows and the row in one
/// transaction, independent of purge's split surfaces above.
///
/// No `cowork_threads` row here: `cowork_threads.session_id` is `NOT NULL
/// REFERENCES sessions(id)` with no cascade, and `sessions.workspace_id` has
/// no cascade either, so a cowork thread can only exist alongside a live
/// session — and a live session blocks this method's own row delete (it
/// never touches `sessions`). This method's two real callers only ever run
/// it on a workspace already known to have zero sessions, so "a cowork
/// thread survives to this call" is not a reachable state to pin.
#[test]
fn delete_workspace_record_deletes_workspace_scoped_dependents_and_the_row() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace_and_repo(&db);
    seed_workspace_access_mode(&db);

    test_delete_workflow(db.clone())
        .delete_workspace_record("workspace-1")
        .expect("delete workspace record");

    assert_eq!(count_all(&db, "workspaces"), 0);
    assert_eq!(count_all(&db, "workspace_access_modes"), 0);
}

fn test_delete_workflow(db: Db) -> WorkspaceDeleteWorkflow {
    WorkspaceDeleteWorkflow::with_participants(db.clone(), vec![Arc::new(CoworkDeleteParticipant)])
}

fn test_session_delete_workflow(db: Db) -> SessionDeleteWorkflow {
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
                id, kind, repo_root_id, path, surface, lifecycle_state,
                created_at, updated_at
             ) VALUES (
                'workspace-1', 'worktree', 'repo-root-1', '/tmp/workspace-1',
                'standard', 'active', ?1, ?1
             )",
            ["2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace and repo");
}

fn seed_workspace_access_mode(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspace_access_modes (workspace_id, mode, handoff_op_id, updated_at)
             VALUES ('workspace-1', 'remote_owned', 'handoff-1', '2026-03-25T00:01:00Z')",
            [],
        )?;
        Ok(())
    })
    .expect("seed workspace access mode");
}

/// Workspace-scoped dependents plus a `cowork_threads` row — callable only
/// once a session (here, `session-1`) already exists, since
/// `cowork_threads.session_id` is a non-nullable FK against `sessions(id)`.
fn seed_workspace_scoped_dependents(db: &Db) {
    seed_workspace_access_mode(db);
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
        Ok(())
    })
    .expect("seed workspace dependents");
}

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
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

fn terminal_run_record() -> TerminalCommandRunRecord {
    TerminalCommandRunRecord {
        id: "terminal-run-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        terminal_id: None,
        purpose: TerminalPurpose::Setup,
        command: "echo ok".to_string(),
        status: TerminalCommandRunStatus::Succeeded,
        exit_code: Some(0),
        output_mode: TerminalCommandOutputMode::Combined,
        stdout: None,
        stderr: None,
        combined_output: None,
        output_truncated: false,
        started_at: None,
        completed_at: Some("2026-03-25T00:02:00Z".to_string()),
        duration_ms: Some(1),
        created_at: "2026-03-25T00:01:00Z".to_string(),
        updated_at: "2026-03-25T00:02:00Z".to_string(),
    }
}

fn count_all(db: &Db, table: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    db.with_conn(|conn| conn.query_row(&sql, [], |row| row.get(0)))
        .expect("count rows")
}
