use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::model::{CoworkManagedWorkspaceRecord, CoworkRootRecord, CoworkThreadRecord};
use crate::domains::sessions::deletion::SessionDeleteParticipant;
use crate::domains::sessions::links::model::SessionLinkRecord;
use crate::domains::workspaces::deletion::WorkspaceDeleteParticipant;
use crate::persistence::Db;

#[derive(Clone)]
pub struct CoworkStore {
    db: Db,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertManagedWorkspaceOutcome {
    Inserted,
    WorkspaceLimit,
    ParentUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsertCodingSessionLinkOutcome {
    Inserted,
    SessionLimit,
    ParentUnavailable,
}

impl CoworkStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn get_root(&self) -> anyhow::Result<Option<CoworkRootRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_roots WHERE id = 'cowork-root'",
                [],
                map_root_row,
            )
            .optional()
        })
    }

    pub fn upsert_root(&self, record: &CoworkRootRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO cowork_roots (id, repo_root_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    repo_root_id = excluded.repo_root_id,
                    updated_at = excluded.updated_at",
                params![
                    record.id,
                    record.repo_root_id,
                    record.created_at,
                    record.updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn insert_thread(&self, record: &CoworkThreadRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO cowork_threads (
                    id, repo_root_id, workspace_id, session_id, agent_kind, requested_model_id,
                    branch_name, workspace_delegation_enabled, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    record.id,
                    record.repo_root_id,
                    record.workspace_id,
                    record.session_id,
                    record.agent_kind,
                    record.requested_model_id,
                    record.branch_name,
                    if record.workspace_delegation_enabled {
                        1
                    } else {
                        0
                    },
                    record.created_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_threads(&self) -> anyhow::Result<Vec<CoworkThreadRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT * FROM cowork_threads ORDER BY created_at DESC")?;
            let rows = stmt.query_map([], map_thread_row)?;
            rows.collect()
        })
    }

    pub fn find_thread_by_session(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<CoworkThreadRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_threads WHERE session_id = ?1",
                [session_id],
                map_thread_row,
            )
            .optional()
        })
    }

    pub fn find_managed_workspace_by_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_managed_workspaces WHERE workspace_id = ?1",
                [workspace_id],
                map_managed_workspace_row,
            )
            .optional()
        })
    }

    pub fn find_managed_workspace(
        &self,
        parent_session_id: &str,
        workspace_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_managed_workspaces
                 WHERE parent_session_id = ?1 AND workspace_id = ?2
                   AND closed_at IS NULL",
                params![parent_session_id, workspace_id],
                map_managed_workspace_row,
            )
            .optional()
        })
    }

    pub fn list_managed_workspaces(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM cowork_managed_workspaces
                 WHERE parent_session_id = ?1
                   AND closed_at IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_managed_workspace_row)?;
            rows.collect()
        })
    }

    pub fn find_managed_workspace_by_public_id(
        &self,
        public_id: &str,
    ) -> anyhow::Result<Option<CoworkManagedWorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM cowork_managed_workspaces WHERE public_id = ?1",
                [public_id],
                map_managed_workspace_row,
            )
            .optional()
        })
    }

    pub fn insert_managed_workspace_with_limit(
        &self,
        record: &CoworkManagedWorkspaceRecord,
        max_workspaces: usize,
    ) -> anyhow::Result<InsertManagedWorkspaceOutcome> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT INTO cowork_managed_workspaces (
                    id, public_id, parent_session_id, workspace_id, source_workspace_id,
                    label, created_at, closed_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
                 WHERE (
                    SELECT COUNT(*)
                    FROM cowork_managed_workspaces
                    WHERE parent_session_id = ?3
                      AND closed_at IS NULL
                 ) < ?9
                   AND EXISTS (
                    SELECT 1 FROM sessions parent
                    WHERE parent.id = ?3
                      AND parent.closed_at IS NULL
                      AND parent.status NOT IN ('closing', 'closed')
                 )",
                params![
                    record.id,
                    record.public_id,
                    record.parent_session_id,
                    record.workspace_id,
                    record.source_workspace_id,
                    record.label,
                    record.created_at,
                    record.closed_at,
                    max_workspaces as i64,
                ],
            )?;
            if inserted > 0 {
                return Ok(InsertManagedWorkspaceOutcome::Inserted);
            }
            let parent_open = conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sessions
                    WHERE id = ?1 AND closed_at IS NULL
                      AND status NOT IN ('closing', 'closed')
                 )",
                [record.parent_session_id.as_str()],
                |row| row.get::<_, bool>(0),
            )?;
            Ok(if parent_open {
                InsertManagedWorkspaceOutcome::WorkspaceLimit
            } else {
                InsertManagedWorkspaceOutcome::ParentUnavailable
            })
        })
    }

    pub fn delete_managed_workspace(&self, id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute("DELETE FROM cowork_managed_workspaces WHERE id = ?1", [id])?;
            Ok(())
        })
    }

    pub fn mark_managed_workspace_closed(&self, id: &str, closed_at: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE cowork_managed_workspaces
                 SET closed_at = COALESCE(closed_at, ?1)
                 WHERE id = ?2",
                params![closed_at, id],
            )?;
            Ok(updated > 0)
        })
    }

    pub fn mark_managed_workspaces_closed_by_parent(
        &self,
        parent_session_id: &str,
        closed_at: &str,
    ) -> anyhow::Result<usize> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE cowork_managed_workspaces
                 SET closed_at = COALESCE(closed_at, ?1)
                 WHERE parent_session_id = ?2",
                params![closed_at, parent_session_id],
            )
            .map_err(Into::into)
        })
    }

    pub fn insert_coding_session_link_with_workspace_limit(
        &self,
        record: &SessionLinkRecord,
        workspace_id: &str,
        max_sessions_per_workspace: usize,
    ) -> anyhow::Result<InsertCodingSessionLinkOutcome> {
        self.db.with_conn(|conn| {
            let inserted = conn.execute(
                "INSERT INTO session_links (
                    id, public_id, relation, parent_session_id, child_session_id,
                    workspace_relation, label, created_by_turn_id,
                    created_by_tool_call_id, created_at, closed_at
                 )
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
                 WHERE (
                    SELECT COUNT(*)
                    FROM session_links links
                    JOIN sessions child ON child.id = links.child_session_id
                    WHERE links.relation = ?3
                      AND links.parent_session_id = ?4
                      AND child.workspace_id = ?12
                      AND links.closed_at IS NULL
                 ) < ?13
                   AND EXISTS (
                    SELECT 1 FROM sessions parent
                    WHERE parent.id = ?4
                      AND parent.closed_at IS NULL
                      AND parent.status NOT IN ('closing', 'closed')
                 )",
                params![
                    record.id,
                    record.public_id,
                    record.relation.as_str(),
                    record.parent_session_id,
                    record.child_session_id,
                    record.workspace_relation.as_str(),
                    record.label,
                    record.created_by_turn_id,
                    record.created_by_tool_call_id,
                    record.created_at,
                    record.closed_at,
                    workspace_id,
                    max_sessions_per_workspace as i64,
                ],
            )?;
            if inserted > 0 {
                return Ok(InsertCodingSessionLinkOutcome::Inserted);
            }
            let parent_open = conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sessions
                    WHERE id = ?1 AND closed_at IS NULL
                      AND status NOT IN ('closing', 'closed')
                 )",
                [record.parent_session_id.as_str()],
                |row| row.get::<_, bool>(0),
            )?;
            Ok(if parent_open {
                InsertCodingSessionLinkOutcome::SessionLimit
            } else {
                InsertCodingSessionLinkOutcome::ParentUnavailable
            })
        })
    }
}

pub(crate) fn delete_cowork_rows_for_session_in_tx(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM cowork_threads WHERE session_id = ?1",
        [session_id],
    )?;
    conn.execute(
        "DELETE FROM cowork_managed_workspaces WHERE parent_session_id = ?1",
        [session_id],
    )?;
    Ok(())
}

pub(crate) fn delete_cowork_rows_for_workspace_in_tx(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM cowork_threads WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    conn.execute(
        "DELETE FROM cowork_managed_workspaces WHERE workspace_id = ?1",
        [workspace_id],
    )?;
    Ok(())
}

pub struct CoworkDeleteParticipant;

impl SessionDeleteParticipant for CoworkDeleteParticipant {
    fn delete_session_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()> {
        delete_cowork_rows_for_session_in_tx(conn, session_id)
    }
}

impl WorkspaceDeleteParticipant for CoworkDeleteParticipant {
    fn delete_workspace_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()> {
        delete_cowork_rows_for_workspace_in_tx(conn, workspace_id)
    }
}

fn map_root_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoworkRootRecord> {
    Ok(CoworkRootRecord {
        id: row.get("id")?,
        repo_root_id: row.get("repo_root_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn map_thread_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoworkThreadRecord> {
    Ok(CoworkThreadRecord {
        id: row.get("id")?,
        repo_root_id: row.get("repo_root_id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        agent_kind: row.get("agent_kind")?,
        requested_model_id: row.get("requested_model_id")?,
        branch_name: row.get("branch_name")?,
        workspace_delegation_enabled: row.get::<_, i64>("workspace_delegation_enabled")? != 0,
        created_at: row.get("created_at")?,
    })
}

fn map_managed_workspace_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<CoworkManagedWorkspaceRecord> {
    Ok(CoworkManagedWorkspaceRecord {
        id: row.get("id")?,
        public_id: row.get("public_id")?,
        parent_session_id: row.get("parent_session_id")?,
        workspace_id: row.get("workspace_id")?,
        source_workspace_id: row.get("source_workspace_id")?,
        label: row.get("label")?,
        created_at: row.get("created_at")?,
        closed_at: row.get("closed_at")?,
    })
}

pub fn new_managed_workspace_record(
    parent_session_id: &str,
    workspace_id: &str,
    source_workspace_id: Option<String>,
    label: Option<String>,
) -> CoworkManagedWorkspaceRecord {
    CoworkManagedWorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        public_id: Some(format!("cowork_workspace_{}", Uuid::new_v4().simple())),
        parent_session_id: parent_session_id.to_string(),
        workspace_id: workspace_id.to_string(),
        source_workspace_id,
        label,
        created_at: chrono::Utc::now().to_rfc3339(),
        closed_at: None,
    }
}

#[cfg(test)]
mod closing_tests {
    use std::sync::{Arc, Barrier};

    use super::{CoworkStore, InsertCodingSessionLinkOutcome, InsertManagedWorkspaceOutcome};
    use crate::app::test_support;
    use crate::domains::cowork::model::CoworkManagedWorkspaceRecord;
    use crate::domains::sessions::links::model::{
        SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
    };
    use crate::domains::sessions::links::store::SessionLinkStore;
    use crate::domains::sessions::store::SessionStore;
    use crate::persistence::Db;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn close_fence_is_atomic_with_cowork_coding_link_insert() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        db.with_conn(|conn| {
            for id in ["parent-1", "child-1"] {
                conn.execute(
                    "INSERT INTO sessions (
                        id, workspace_id, agent_kind, status, created_at, updated_at
                     ) VALUES (?1, 'workspace-1', 'claude', 'idle', 'now', 'now')",
                    [id],
                )?;
            }
            Ok(())
        })
        .expect("seed sessions");
        let record = SessionLinkRecord {
            id: "cowork-link-1".to_string(),
            public_id: Some("cowork_agent_1".to_string()),
            relation: SessionLinkRelation::CoworkCodingSession,
            parent_session_id: "parent-1".to_string(),
            child_session_id: "child-1".to_string(),
            workspace_relation: SessionLinkWorkspaceRelation::CoworkManagedWorkspace,
            label: Some("Coder".to_string()),
            created_by_turn_id: None,
            created_by_tool_call_id: None,
            created_at: "2026-03-25T00:00:00Z".to_string(),
            closed_at: None,
        };

        let barrier = Arc::new(Barrier::new(2));
        let close_store = SessionStore::new(db.clone());
        let close_links = SessionLinkStore::new(db.clone());
        let close_barrier = barrier.clone();
        let close = tokio::task::spawn_blocking(move || {
            close_barrier.wait();
            close_store
                .mark_closing("parent-1", "2026-03-25T00:01:00Z")
                .expect("mark parent closing");
            close_links
                .list_by_parent("parent-1")
                .expect("enumerate children after close fence")
        });

        let cowork_store = CoworkStore::new(db);
        let insert_barrier = barrier.clone();
        let insert = tokio::task::spawn_blocking(move || {
            insert_barrier.wait();
            cowork_store
                .insert_coding_session_link_with_workspace_limit(&record, "workspace-1", 4)
                .expect("insert outcome")
        });

        let enumerated = close.await.expect("close task");
        match insert.await.expect("insert task") {
            InsertCodingSessionLinkOutcome::Inserted => assert!(enumerated
                .iter()
                .any(|candidate| candidate.id == "cowork-link-1")),
            InsertCodingSessionLinkOutcome::ParentUnavailable => {
                assert!(enumerated.is_empty())
            }
            InsertCodingSessionLinkOutcome::SessionLimit => {
                panic!("unexpected session limit")
            }
        }
    }

    #[test]
    fn closing_parent_rejects_late_managed_workspace_insert() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        test_support::seed_workspace_with_repo_root(
            &db,
            "managed-workspace",
            "local",
            "/tmp/managed-workspace",
        );
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES ('parent-1', 'workspace-1', 'claude', 'closing', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed closing parent");
        let outcome = CoworkStore::new(db)
            .insert_managed_workspace_with_limit(
                &CoworkManagedWorkspaceRecord {
                    id: "managed-1".to_string(),
                    public_id: Some("cowork_workspace_1".to_string()),
                    parent_session_id: "parent-1".to_string(),
                    workspace_id: "managed-workspace".to_string(),
                    source_workspace_id: Some("workspace-1".to_string()),
                    label: Some("Workspace".to_string()),
                    created_at: "now".to_string(),
                    closed_at: None,
                },
                4,
            )
            .expect("insert outcome");
        assert_eq!(outcome, InsertManagedWorkspaceOutcome::ParentUnavailable);
    }
}
