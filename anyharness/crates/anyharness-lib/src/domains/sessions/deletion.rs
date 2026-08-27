use std::path::Path;
use std::sync::Arc;

use crate::persistence::Db;

pub trait SessionDeleteParticipant: Send + Sync {
    fn delete_session_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()>;
}

#[derive(Clone)]
pub struct SessionDeleteWorkflow {
    db: Db,
    participants: Vec<Arc<dyn SessionDeleteParticipant>>,
}

impl SessionDeleteWorkflow {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            participants: Vec::new(),
        }
    }

    pub fn with_participants(db: Db, participants: Vec<Arc<dyn SessionDeleteParticipant>>) -> Self {
        Self { db, participants }
    }

    pub fn delete_session(&self, session_id: &str) -> anyhow::Result<()> {
        self.db
            .with_tx(|conn| self.delete_session_graph_in_tx(conn, session_id))
    }

    pub(crate) fn delete_session_graph_in_tx(
        &self,
        conn: &rusqlite::Connection,
        session_id: &str,
    ) -> rusqlite::Result<()> {
        for participant in &self.participants {
            participant.delete_session_rows_in_tx(conn, session_id)?;
        }
        crate::domains::sessions::links::store::delete_session_link_rows_for_session_in_tx(
            conn, session_id,
        )?;
        crate::domains::sessions::store::sessions::delete_session_rows_in_tx(conn, session_id)?;
        Ok(())
    }

    /// Purge's session-artifact surface: all three artifact classes a
    /// workspace's sessions can leave behind, so "delete a workspace" never
    /// silently stops at the DB row. A version that only walked
    /// [`Self::delete_session_graph_in_tx`] would delete rows and leave native
    /// JSONL and prompt attachments on disk forever — this method exists
    /// specifically so purge cannot do that by omission.
    ///
    /// `workspace_path` and `runtime_home` are required because
    /// `delete_session_agent_artifacts` (the native JSONL deleter) needs both;
    /// that is the whole reason this surface's signature carries them instead
    /// of resolving them itself from a bare workspace id.
    ///
    /// Builds its own [`crate::domains::sessions::store::SessionStore`] and
    /// [`crate::domains::sessions::attachment_storage::PromptAttachmentStorage`]
    /// from `self.db` and `runtime_home` rather than widening `new` /
    /// `with_participants` — both dependencies are already derivable from
    /// what this struct holds and what this call already carries, and
    /// widening the constructor would churn every existing construction site.
    pub fn delete_artifacts_for_workspace(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
        runtime_home: &Path,
    ) -> anyhow::Result<()> {
        let session_store = crate::domains::sessions::store::SessionStore::new(self.db.clone());
        let sessions = session_store.list_by_workspace(workspace_id)?;

        // Class 1: native JSONL and other per-agent artifact files. Runs
        // before the DB rows die so a mid-flight failure here leaves the
        // session rows in place for a retried DELETE to re-walk.
        for session in &sessions {
            crate::domains::agents::portability::delete_session_agent_artifacts(
                session,
                workspace_path,
                Some(runtime_home),
            )?;
        }

        // Class 2: the session graph rows themselves (participants, links,
        // the session row) — split OUT of the old
        // `purge_workspace_with_sessions`, deliberately WITHOUT the
        // workspace-row delete that wrapper performed in the same
        // transaction, because that delete is exactly what would break
        // purge's row-dies-last ordering.
        self.db.with_tx(|conn| {
            let session_ids =
                crate::domains::sessions::store::sessions::list_session_ids_by_workspace_in_tx(
                    conn,
                    workspace_id,
                )?;
            for session_id in &session_ids {
                self.delete_session_graph_in_tx(conn, session_id)?;
            }
            Ok(())
        })?;

        // Class 3: prompt attachment directories. Best-effort per session —
        // a leftover attachment directory after the durable (DB + JSONL)
        // cleanup has already succeeded is logged, not fatal, matching the
        // old purge's same tolerance for this exact step.
        let attachment_storage = crate::domains::sessions::attachment_storage::PromptAttachmentStorage::new(
            runtime_home.to_path_buf(),
        );
        for session in &sessions {
            if let Err(error) = attachment_storage.delete_session_dir(&session.id) {
                tracing::warn!(
                    workspace_id,
                    session_id = %session.id,
                    error = %error,
                    "workspace purge left prompt attachment files behind after durable cleanup"
                );
            }
        }

        Ok(())
    }
}

#[cfg(test)]
#[path = "deletion_tests.rs"]
mod tests;
