use rusqlite::{params, Connection, OptionalExtension};

use super::model::WorkspaceRecord;
use crate::origin::{decode_origin_json, encode_origin_json};
use crate::persistence::Db;
use crate::workspaces::creator_context::{
    decode_creator_context_json, encode_creator_context_json,
};

#[derive(Clone)]
pub struct WorkspaceStore {
    db: Db,
}

impl WorkspaceStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces WHERE path = ?1 ORDER BY created_at ASC LIMIT 1",
                [path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE path = ?1 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC LIMIT 1",
                [path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path_excluding_id(
        &self,
        path: &str,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE path = ?1 AND id <> ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC LIMIT 1",
                params![path, excluded_id],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_path_and_kind(
        &self,
        path: &str,
        kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces WHERE path = ?1 AND kind = ?2 ORDER BY created_at ASC LIMIT 1",
                params![path, kind],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_active_by_path_and_kind(
        &self,
        path: &str,
        kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE path = ?1 AND kind = ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC LIMIT 1",
                params![path, kind],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_retired_incomplete_cleanup_by_path_and_kind(
        &self,
        path: &str,
        kind: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE path = ?1
                   AND kind = ?2
                   AND lifecycle_state = 'retired'
                   AND cleanup_state IN ('pending', 'failed')
                 ORDER BY updated_at DESC
                 LIMIT 1",
                params![path, kind],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_repo_by_source_root_path(
        &self,
        source_repo_root_path: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM workspaces
                 WHERE kind = 'repo' AND source_repo_root_path = ?1
                 ORDER BY created_at ASC
                 LIMIT 1",
                [source_repo_root_path],
                |row| map_row(row),
            )
            .optional()
        })
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM workspaces WHERE id = ?1", [id], |row| {
                map_row(row)
            })
            .optional()
        })
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM workspaces ORDER BY updated_at DESC")?;
            let rows = stmt.query_map([], |row| map_row(row))?;
            rows.collect()
        })
    }

    pub fn list_execution_surfaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspaces
                 WHERE kind IN ('local', 'worktree')
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn list_by_repo_root_id(&self, repo_root_id: &str) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspaces
                 WHERE repo_root_id = ?1
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([repo_root_id], map_row)?;
            rows.collect()
        })
    }

    pub fn list_active_by_repo_root_id(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM workspaces
                 WHERE repo_root_id = ?1 AND lifecycle_state = 'active'
                 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map([repo_root_id], map_row)?;
            rows.collect()
        })
    }

    pub fn list_standard_active_worktrees_by_activity(
        &self,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "WITH session_activity AS (
                    SELECT workspace_id,
                           MAX(MAX(COALESCE(last_prompt_at, ''), COALESCE(updated_at, ''))) AS session_at
                      FROM sessions
                     GROUP BY workspace_id
                  ),
                  terminal_activity AS (
                    SELECT workspace_id,
                           MAX(MAX(COALESCE(completed_at, ''), COALESCE(updated_at, ''), COALESCE(created_at, ''))) AS terminal_at
                      FROM terminal_command_runs
                     GROUP BY workspace_id
                  )
                  SELECT w.*
                    FROM workspaces w
                    LEFT JOIN session_activity sa ON sa.workspace_id = w.id
                    LEFT JOIN terminal_activity ta ON ta.workspace_id = w.id
                   WHERE w.kind = 'worktree'
                     AND w.surface = 'standard'
                     AND w.lifecycle_state = 'active'
                   ORDER BY w.repo_root_id ASC,
                            MAX(
                              COALESCE(sa.session_at, ''),
                              COALESCE(ta.terminal_at, ''),
                              COALESCE(w.updated_at, ''),
                              COALESCE(w.created_at, '')
                            ) DESC,
                            w.created_at DESC,
                            w.id ASC",
            )?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn update_lifecycle_cleanup_state(
        &self,
        workspace_id: &str,
        lifecycle_state: &str,
        cleanup_state: &str,
        cleanup_operation: Option<&str>,
        cleanup_error_message: Option<&str>,
        cleanup_failed_at: Option<&str>,
        cleanup_attempted_at: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET lifecycle_state = ?2,
                     cleanup_state = ?3,
                     cleanup_operation = ?4,
                     cleanup_error_message = ?5,
                     cleanup_failed_at = ?6,
                     cleanup_attempted_at = ?7,
                     updated_at = ?8
                 WHERE id = ?1",
                params![
                    workspace_id,
                    lifecycle_state,
                    cleanup_state,
                    cleanup_operation,
                    cleanup_error_message,
                    cleanup_failed_at,
                    cleanup_attempted_at,
                    updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_current_branch(
        &self,
        workspace_id: &str,
        current_branch: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET current_branch = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, current_branch, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn update_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET display_name = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, display_name, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn insert(&self, record: &WorkspaceRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| insert_workspace(conn, record))
    }

    pub fn delete_by_id(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            delete_workspace_scoped_rows_in_tx(conn, workspace_id)?;
            delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    pub fn purge_workspace_with_sessions(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            let session_ids = list_workspace_session_ids_in_tx(conn, workspace_id)?;
            for session_id in session_ids {
                crate::sessions::store::delete_session_in_tx(conn, &session_id)?;
            }
            delete_workspace_scoped_rows_in_tx(conn, workspace_id)?;
            delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }
}

fn list_workspace_session_ids_in_tx(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM sessions WHERE workspace_id = ?1")?;
    let rows = stmt.query_map([workspace_id], |row| row.get::<_, String>(0))?;
    let session_ids = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(session_ids)
}

pub(crate) fn delete_workspace_scoped_rows_in_tx(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<()> {
    // Workspace-scoped rows do not all cascade today, so clear them explicitly.
    conn.execute(
        "DELETE FROM workspace_access_modes WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    conn.execute(
        "DELETE FROM cowork_threads WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    conn.execute(
        "DELETE FROM cowork_managed_workspaces WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    conn.execute(
        "DELETE FROM workspace_setup_state WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    conn.execute(
        "DELETE FROM terminal_command_runs WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    Ok(())
}

pub(crate) fn delete_workspace_row_in_tx(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
    Ok(())
}

fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&r.origin)?;
    let creator_context_json = encode_creator_context_json(&r.creator_context)?;
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, source_repo_root_path, source_workspace_id,
            git_provider, git_owner, git_repo_name, original_branch, current_branch, display_name,
            origin_json, creator_context_json, lifecycle_state, cleanup_state, cleanup_operation,
            cleanup_error_message, cleanup_failed_at, cleanup_attempted_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            r.id,
            r.kind,
            r.repo_root_id,
            r.path,
            r.surface,
            r.source_repo_root_path,
            r.source_workspace_id,
            r.git_provider,
            r.git_owner,
            r.git_repo_name,
            r.original_branch,
            r.current_branch,
            r.display_name,
            origin_json,
            creator_context_json,
            r.lifecycle_state,
            r.cleanup_state,
            r.cleanup_operation,
            r.cleanup_error_message,
            r.cleanup_failed_at,
            r.cleanup_attempted_at,
            r.created_at,
            r.updated_at,
        ],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceRecord> {
    let id: String = row.get("id")?;
    let origin_json: Option<String> = row.get("origin_json")?;
    let creator_context_json: Option<String> = row.get("creator_context_json")?;
    Ok(WorkspaceRecord {
        id: id.clone(),
        kind: row.get("kind")?,
        repo_root_id: row.get("repo_root_id")?,
        path: row.get("path")?,
        surface: row.get("surface")?,
        source_repo_root_path: row.get("source_repo_root_path")?,
        source_workspace_id: row.get("source_workspace_id")?,
        git_provider: row.get("git_provider")?,
        git_owner: row.get("git_owner")?,
        git_repo_name: row.get("git_repo_name")?,
        original_branch: row.get("original_branch")?,
        current_branch: row.get("current_branch")?,
        display_name: row.get("display_name")?,
        origin: decode_origin_json("workspaces", &id, origin_json),
        creator_context: decode_creator_context_json("workspaces", &id, creator_context_json),
        lifecycle_state: row.get("lifecycle_state")?,
        cleanup_state: row.get("cleanup_state")?,
        cleanup_operation: row.get("cleanup_operation")?,
        cleanup_error_message: row.get("cleanup_error_message")?,
        cleanup_failed_at: row.get("cleanup_failed_at")?,
        cleanup_attempted_at: row.get("cleanup_attempted_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::{WorkspaceRecord, WorkspaceStore};
    use crate::origin::OriginContext;
    use crate::persistence::Db;
    use crate::sessions::model::SessionRecord;
    use crate::sessions::store::SessionStore;
    use crate::terminals::model::{
        TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus,
        TerminalPurpose,
    };
    use crate::terminals::store::TerminalStore;
    use crate::workspaces::creator_context::WorkspaceCreatorContext;

    fn workspace_record(id: &str, kind: &str, path: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_string(),
            kind: kind.to_string(),
            repo_root_id: None,
            path: path.to_string(),
            surface: "standard".to_string(),
            source_repo_root_path: path.to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        }
    }

    fn session_record(id: &str, workspace_id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: None,
        }
    }

    fn terminal_run_record(
        id: &str,
        workspace_id: &str,
        completed_at: &str,
        updated_at: &str,
    ) -> TerminalCommandRunRecord {
        TerminalCommandRunRecord {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            terminal_id: None,
            purpose: TerminalPurpose::Run,
            command: "echo ok".to_string(),
            status: TerminalCommandRunStatus::Succeeded,
            exit_code: Some(0),
            output_mode: TerminalCommandOutputMode::Combined,
            stdout: None,
            stderr: None,
            combined_output: None,
            output_truncated: false,
            started_at: None,
            completed_at: Some(completed_at.to_string()),
            duration_ms: Some(1),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    #[test]
    fn stores_and_loads_workspace_origin() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let mut workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        workspace.origin = Some(OriginContext::human_desktop());

        store.insert(&workspace).expect("insert workspace");
        let stored = store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .expect("workspace record");

        assert_eq!(stored.origin, Some(OriginContext::human_desktop()));
    }

    #[test]
    fn malformed_workspace_origin_is_omitted() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db.clone());

        let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        store.insert(&workspace).expect("insert workspace");

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces SET origin_json = ?1 WHERE id = ?2",
                [
                    "{\"kind\":\"automation\",\"entrypoint\":\"cloud\"}",
                    &workspace.id,
                ],
            )?;
            Ok(())
        })
        .expect("corrupt origin JSON");

        let stored = store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .expect("workspace record");

        assert_eq!(stored.origin, None);
    }

    #[test]
    fn stores_and_loads_workspace_creator_context() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let mut workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        workspace.creator_context = Some(WorkspaceCreatorContext::Agent {
            source_session_id: "session-1".to_string(),
            source_session_workspace_id: Some("workspace-parent".to_string()),
            session_link_id: None,
            source_workspace_id: Some("workspace-source".to_string()),
            label: Some("Cowork thread".to_string()),
        });

        store.insert(&workspace).expect("insert workspace");
        let stored = store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .expect("workspace record");

        assert_eq!(stored.creator_context, workspace.creator_context);
    }

    #[test]
    fn malformed_workspace_creator_context_is_omitted() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db.clone());

        let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        store.insert(&workspace).expect("insert workspace");

        db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces SET creator_context_json = ?1 WHERE id = ?2",
                ["{\"kind\":\"agent\",\"sourceSessionId\":42}", &workspace.id],
            )?;
            Ok(())
        })
        .expect("corrupt creator context JSON");

        let stored = store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .expect("workspace record");

        assert_eq!(stored.creator_context, None);
    }

    #[test]
    fn active_path_lookup_ignores_retired_rows() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/workspace");
        retired.lifecycle_state = "retired".to_string();
        retired.cleanup_state = "complete".to_string();
        let active = workspace_record("workspace-active", "worktree", "/tmp/workspace");

        store.insert(&retired).expect("insert retired workspace");
        store.insert(&active).expect("insert active workspace");

        assert_eq!(
            store
                .find_by_path("/tmp/workspace")
                .expect("find any path")
                .expect("historical workspace")
                .id,
            "workspace-retired"
        );
        assert_eq!(
            store
                .find_active_by_path("/tmp/workspace")
                .expect("find active path")
                .expect("active workspace")
                .id,
            "workspace-active"
        );
        assert!(store
            .find_active_by_path_and_kind("/tmp/workspace", "local")
            .expect("find active local path")
            .is_none());
    }

    #[test]
    fn active_path_lookup_can_exclude_current_workspace() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let current = workspace_record("workspace-current", "worktree", "/tmp/workspace");
        let sibling = workspace_record("workspace-sibling", "local", "/tmp/workspace");
        let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/workspace");
        retired.lifecycle_state = "retired".to_string();
        retired.cleanup_state = "complete".to_string();

        store.insert(&current).expect("insert current workspace");
        store.insert(&sibling).expect("insert sibling workspace");
        store.insert(&retired).expect("insert retired workspace");

        assert_eq!(
            store
                .find_active_by_path_excluding_id("/tmp/workspace", "workspace-current")
                .expect("find active path excluding current")
                .expect("sibling active workspace")
                .id,
            "workspace-sibling"
        );
        assert!(store
            .find_active_by_path_excluding_id("/tmp/workspace", "workspace-sibling")
            .expect("find active path excluding sibling")
            .is_some());
        assert!(store
            .find_active_by_path_excluding_id("/tmp/other", "workspace-current")
            .expect("find active path for missing path")
            .is_none());
    }

    #[test]
    fn retired_incomplete_cleanup_lookup_tracks_path_ownership() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let mut complete = workspace_record("workspace-complete", "worktree", "/tmp/complete");
        complete.lifecycle_state = "retired".to_string();
        complete.cleanup_state = "complete".to_string();
        let mut failed = workspace_record("workspace-failed", "worktree", "/tmp/failed");
        failed.lifecycle_state = "retired".to_string();
        failed.cleanup_state = "failed".to_string();

        store.insert(&complete).expect("insert complete workspace");
        store.insert(&failed).expect("insert failed workspace");

        assert!(store
            .find_retired_incomplete_cleanup_by_path_and_kind("/tmp/complete", "worktree")
            .expect("lookup complete path")
            .is_none());
        assert_eq!(
            store
                .find_retired_incomplete_cleanup_by_path_and_kind("/tmp/failed", "worktree")
                .expect("lookup failed path")
                .expect("failed retired workspace")
                .id,
            "workspace-failed"
        );
    }

    #[test]
    fn active_repo_root_listing_ignores_retired_rows() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let mut retired = workspace_record("workspace-retired", "worktree", "/tmp/retired");
        retired.repo_root_id = Some("repo-root-1".to_string());
        retired.lifecycle_state = "retired".to_string();
        retired.cleanup_state = "complete".to_string();
        let mut active = workspace_record("workspace-active", "worktree", "/tmp/active");
        active.repo_root_id = Some("repo-root-1".to_string());

        store.insert(&retired).expect("insert retired workspace");
        store.insert(&active).expect("insert active workspace");

        let workspaces = store
            .list_active_by_repo_root_id("repo-root-1")
            .expect("list active repo-root workspaces");
        assert_eq!(
            workspaces
                .iter()
                .map(|workspace| workspace.id.as_str())
                .collect::<Vec<_>>(),
            vec!["workspace-active"]
        );
    }

    #[test]
    fn lifecycle_cleanup_update_preserves_workspace_and_persists_failure_detail() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db);

        let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        store.insert(&workspace).expect("insert workspace");
        store
            .update_lifecycle_cleanup_state(
                &workspace.id,
                "retired",
                "failed",
                Some("retire"),
                Some("permission denied"),
                Some("2026-04-29T12:00:00Z"),
                Some("2026-04-29T11:59:00Z"),
                "2026-04-29T12:00:01Z",
            )
            .expect("update lifecycle cleanup");

        let stored = store
            .find_by_id(&workspace.id)
            .expect("find workspace")
            .expect("workspace should still exist");
        assert_eq!(stored.lifecycle_state, "retired");
        assert_eq!(stored.cleanup_state, "failed");
        assert_eq!(stored.cleanup_operation.as_deref(), Some("retire"));
        assert_eq!(
            stored.cleanup_error_message.as_deref(),
            Some("permission denied")
        );
        assert_eq!(
            stored.cleanup_failed_at.as_deref(),
            Some("2026-04-29T12:00:00Z")
        );
        assert_eq!(
            stored.cleanup_attempted_at.as_deref(),
            Some("2026-04-29T11:59:00Z")
        );
        assert_eq!(stored.updated_at, "2026-04-29T12:00:01Z");
    }

    #[test]
    fn active_worktree_activity_order_uses_true_row_max() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let terminal_store = TerminalStore::new(db.clone());

        let mut session_newer =
            workspace_record("workspace-session-newer", "worktree", "/tmp/session-newer");
        session_newer.repo_root_id = Some("repo-root-1".to_string());
        let mut terminal_newer = workspace_record(
            "workspace-terminal-newer",
            "worktree",
            "/tmp/terminal-newer",
        );
        terminal_newer.repo_root_id = Some("repo-root-1".to_string());
        let mut older = workspace_record("workspace-older", "worktree", "/tmp/older");
        older.repo_root_id = Some("repo-root-1".to_string());

        store.insert(&session_newer).expect("insert session newer");
        store
            .insert(&terminal_newer)
            .expect("insert terminal newer");
        store.insert(&older).expect("insert older");

        let mut session = session_record("session-newer", &session_newer.id);
        session.last_prompt_at = Some("2025-01-02T00:00:00Z".to_string());
        session.updated_at = "2025-01-11T00:00:00Z".to_string();
        session_store
            .insert(&session)
            .expect("insert newer session");

        let mut older_session = session_record("session-older", &older.id);
        older_session.last_prompt_at = Some("2025-01-09T00:00:00Z".to_string());
        older_session.updated_at = "2025-01-09T00:00:00Z".to_string();
        session_store
            .insert(&older_session)
            .expect("insert older session");

        terminal_store
            .insert_command_run(&terminal_run_record(
                "terminal-run-newer",
                &terminal_newer.id,
                "2025-01-03T00:00:00Z",
                "2025-01-10T00:00:00Z",
            ))
            .expect("insert terminal run");

        let ids = store
            .list_standard_active_worktrees_by_activity()
            .expect("list by activity")
            .into_iter()
            .map(|workspace| workspace.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "workspace-session-newer".to_string(),
                "workspace-terminal-newer".to_string(),
                "workspace-older".to_string(),
            ]
        );
    }

    #[test]
    fn delete_workspace_removes_workspace_scoped_rows() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorkspaceStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());

        let workspace = workspace_record("workspace-1", "worktree", "/tmp/workspace-1");
        store.insert(&workspace).expect("insert workspace");
        session_store
            .insert(&session_record("session-1", &workspace.id))
            .expect("insert session");

        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO repo_roots (
                    id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                    remote_repo_name, remote_url, created_at, updated_at
                 ) VALUES (
                    'repo-root-1', 'external', '/tmp/repo-root-1', NULL, 'main', NULL, NULL,
                    NULL, NULL, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'
                 )",
                [],
            )?;
            conn.execute(
                "INSERT INTO workspace_access_modes (workspace_id, mode, handoff_op_id, updated_at)
                 VALUES (?1, 'remote_owned', 'handoff-1', '2025-01-01T00:00:00Z')",
                [&workspace.id],
            )?;
            conn.execute(
                "INSERT INTO cowork_threads (
                    id, repo_root_id, workspace_id, session_id, agent_kind, requested_model_id, branch_name, created_at
                 ) VALUES (
                    'thread-1', 'repo-root-1', ?1, 'session-1', 'claude', NULL, 'main', '2025-01-01T00:00:00Z'
                 )",
                [&workspace.id],
            )?;
            Ok(())
        })
        .expect("insert dependent rows");

        session_store
            .delete_session("session-1")
            .expect("delete session first");
        store.delete_by_id(&workspace.id).expect("delete workspace");

        db.with_conn(|conn| {
            let workspace_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM workspaces WHERE id = ?1",
                [&workspace.id],
                |row| row.get(0),
            )?;
            let access_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM workspace_access_modes WHERE workspace_id = ?1",
                [&workspace.id],
                |row| row.get(0),
            )?;
            let thread_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM cowork_threads WHERE workspace_id = ?1",
                [&workspace.id],
                |row| row.get(0),
            )?;
            assert_eq!(workspace_count, 0);
            assert_eq!(access_count, 0);
            assert_eq!(thread_count, 0);
            Ok(())
        })
        .expect("verify cleanup");
    }
}
