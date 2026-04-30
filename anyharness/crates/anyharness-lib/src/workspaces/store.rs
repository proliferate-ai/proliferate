use rusqlite::{params, Connection, OptionalExtension};

use super::model::WorkspaceRecord;
use crate::origin::{decode_origin_json, encode_origin_json};
use crate::persistence::Db;

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
            // Workspace-scoped rows do not all cascade today, so clear them
            // explicitly before removing the workspace record itself.
            conn.execute(
                "DELETE FROM workspace_access_modes WHERE workspace_id = ?1",
                [workspace_id],
            )?;
            conn.execute(
                "DELETE FROM cowork_threads WHERE workspace_id = ?1",
                [workspace_id],
            )?;
            conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
            Ok(())
        })
    }
}

fn insert_workspace(conn: &Connection, r: &WorkspaceRecord) -> rusqlite::Result<()> {
    let origin_json = encode_origin_json(&r.origin)?;
    conn.execute(
        "INSERT INTO workspaces (
            id, kind, repo_root_id, path, surface, source_repo_root_path, source_workspace_id,
            git_provider, git_owner, git_repo_name, original_branch, current_branch, display_name,
            origin_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
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
            r.created_at,
            r.updated_at,
        ],
    )?;
    Ok(())
}

fn map_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceRecord> {
    let id: String = row.get("id")?;
    let origin_json: Option<String> = row.get("origin_json")?;
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
            system_prompt_append: None,
            origin: None,
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
