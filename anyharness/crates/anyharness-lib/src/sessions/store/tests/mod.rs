use super::SessionStore;
use crate::persistence::Db;
use crate::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::sessions::model::SessionRecord;
use rusqlite::params;

fn count_rows(db: &Db, table: &str, session_id: &str) -> i64 {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE session_id = ?1");
    db.with_conn(|conn| conn.query_row(&sql, [session_id], |row| row.get(0)))
        .expect("count rows")
}

fn seed_workspace(db: &Db) {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
             VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
            params!["workspace-1", "2026-03-25T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed workspace");
}

fn session_record() -> SessionRecord {
    SessionRecord {
        id: "session-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: Some("native-1".to_string()),
        agent_auth_scope: None,
        required_agent_auth_revision: None,
        requested_model_id: Some("default".to_string()),
        current_model_id: Some("default".to_string()),
        requested_mode_id: Some("default".to_string()),
        current_mode_id: Some("default".to_string()),
        title: Some("Fix auth refresh".to_string()),
        thinking_level_id: None,
        thinking_budget_tokens: Some(16_000),
        status: "idle".to_string(),
        created_at: "2026-03-25T00:00:00Z".to_string(),
        updated_at: "2026-03-25T00:00:00Z".to_string(),
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn fork_link_record(
    id: &str,
    parent_session_id: &str,
    child_session_id: &str,
) -> SessionLinkRecord {
    SessionLinkRecord {
        id: id.to_string(),
        public_id: Some(format!("session_link_{}", id.replace('-', ""))),
        relation: SessionLinkRelation::Fork,
        parent_session_id: parent_session_id.to_string(),
        child_session_id: child_session_id.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: None,
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        closed_at: None,
    }
}

mod background_work;
mod delete;
mod events;
mod links;
mod notifications;
mod pending_prompts;
mod sessions;
