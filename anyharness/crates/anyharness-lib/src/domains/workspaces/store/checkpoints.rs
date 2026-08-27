//! Persistence for `workspace_checkpoints` — the metadata truth for a captured
//! checkpoint. SQL text and row mapping only; the capture/retention/purge
//! decisions live in `domains/workspaces/checkpoints/`.

use rusqlite::{params, OptionalExtension};

use super::WorkspaceStore;
use crate::domains::workspaces::checkpoints::{CheckpointOrigin, CheckpointRecord};

const CHECKPOINT_COLUMNS: &str = "id, workspace_id, origin, session_id, turn_id, prompt_id, \
     fork_operation_id, revert_operation_id, head_sha, work_tree_oid, index_tree_oid, \
     work_tree_anchored, index_tree_anchored, notices_json, created_at, updated_at, expired_at";

fn map_checkpoint(row: &rusqlite::Row) -> rusqlite::Result<CheckpointRecord> {
    let origin_str: String = row.get(2)?;
    let origin = CheckpointOrigin::parse(&origin_str).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::<dyn std::error::Error + Send + Sync>::from(error.to_string()),
        )
    })?;
    Ok(CheckpointRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        origin,
        session_id: row.get(3)?,
        turn_id: row.get(4)?,
        prompt_id: row.get(5)?,
        fork_operation_id: row.get(6)?,
        revert_operation_id: row.get(7)?,
        head_sha: row.get(8)?,
        work_tree_oid: row.get(9)?,
        index_tree_oid: row.get(10)?,
        work_tree_anchored: row.get::<_, i64>(11)? != 0,
        index_tree_anchored: row.get::<_, i64>(12)? != 0,
        notices_json: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        expired_at: row.get(16)?,
    })
}

impl WorkspaceStore {
    pub fn insert_checkpoint(&self, record: &CheckpointRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspace_checkpoints (
                    id, workspace_id, origin, session_id, turn_id, prompt_id,
                    fork_operation_id, revert_operation_id, head_sha, work_tree_oid,
                    index_tree_oid, work_tree_anchored, index_tree_anchored, notices_json,
                    created_at, updated_at, expired_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
                 )",
                params![
                    record.id,
                    record.workspace_id,
                    record.origin.as_str(),
                    record.session_id,
                    record.turn_id,
                    record.prompt_id,
                    record.fork_operation_id,
                    record.revert_operation_id,
                    record.head_sha,
                    record.work_tree_oid,
                    record.index_tree_oid,
                    record.work_tree_anchored as i64,
                    record.index_tree_anchored as i64,
                    record.notices_json,
                    record.created_at,
                    record.updated_at,
                    record.expired_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn find_checkpoint(&self, id: &str) -> anyhow::Result<Option<CheckpointRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {CHECKPOINT_COLUMNS} FROM workspace_checkpoints WHERE id = ?1"),
                [id],
                map_checkpoint,
            )
            .optional()})
    }

    /// The unexpired checkpoint captured at a `(session_id, turn_id)` boundary,
    /// if any — the fork path's lookup. Newest first, so a re-captured boundary
    /// resolves to the live one.
    ///
    /// Boundary-key discipline (ADR H owner ruling): the key is the PAIR
    /// `(session_id, turn_id)` — turn ids are not unique across a fork lineage,
    /// so `session_id` is the required scoping. `prompt_id` is dispatch
    /// provenance only and is never a join key here. The match is EXACT equality:
    /// a boundary that is not turn-opening has NO checkpoint by construction, and
    /// callers must surface that absence as a no-checkpoint state — never fall
    /// back to a nearest-turn match.
    pub fn find_unexpired_checkpoint_by_boundary(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> anyhow::Result<Option<CheckpointRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {CHECKPOINT_COLUMNS} FROM workspace_checkpoints
                     WHERE session_id = ?1 AND turn_id = ?2 AND expired_at IS NULL
                     ORDER BY created_at DESC, id DESC LIMIT 1"
                ),
                params![session_id, turn_id],
                map_checkpoint,
            )
            .optional()})
    }

    /// Backfill the `turn_id` a turn-start checkpoint was captured against, once
    /// the actor reports the turn it Started.
    pub fn set_checkpoint_turn_id(&self, id: &str, turn_id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspace_checkpoints SET turn_id = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, turn_id, now],
            )?;
            Ok(())
        })
    }

    /// Mark a checkpoint expired. The fail-safe FIRST step of every deletion:
    /// once a row is expired, its refs are eligible for the orphan reap.
    pub fn mark_checkpoint_expired(&self, id: &str, now: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspace_checkpoints SET expired_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            Ok(())
        })
    }

    /// Mark every checkpoint for a workspace expired while preserving the rows
    /// as sweep-discovery metadata. Purge uses this before deleting refs, then
    /// removes the rows only after ref deletion succeeds.
    pub fn mark_checkpoints_expired_for_workspace(
        &self,
        workspace_id: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspace_checkpoints
                 SET expired_at = COALESCE(expired_at, ?2), updated_at = ?2
                 WHERE workspace_id = ?1",
                params![workspace_id, now],
            )?;
            Ok(())
        })
    }

    /// A workspace's unexpired checkpoints, newest first (the retention duty's
    /// cull ordering).
    pub fn list_unexpired_checkpoints_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<CheckpointRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {CHECKPOINT_COLUMNS} FROM workspace_checkpoints
                 WHERE workspace_id = ?1 AND expired_at IS NULL
                 ORDER BY created_at DESC, id DESC"
            ))?;
            let rows = stmt.query_map([workspace_id], map_checkpoint)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()})
    }

    /// Workspace ids holding at least one unexpired checkpoint.
    pub fn list_workspace_ids_with_unexpired_checkpoints(&self) -> anyhow::Result<Vec<String>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT workspace_id FROM workspace_checkpoints WHERE expired_at IS NULL",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()})
    }

    /// Workspace ids holding ANY checkpoint row (expired or not). The retention
    /// duty iterates this superset so its orphan reap also reaches a workspace
    /// whose rows are all expired but whose refs a crash left behind.
    pub fn list_workspace_ids_with_any_checkpoints(&self) -> anyhow::Result<Vec<String>> {
        self.db.with_conn(|conn| {
            let mut stmt =
                conn.prepare("SELECT DISTINCT workspace_id FROM workspace_checkpoints")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()})
    }

    /// Delete every checkpoint row for a workspace. Purge calls this only after
    /// the rows were expired and `checkpoints::refs::delete_all_for` cleared the
    /// bytes, so a failed ref deletion stays discoverable by the retention pass.
    pub fn delete_checkpoints_for_workspace(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM workspace_checkpoints WHERE workspace_id = ?1",
                [workspace_id],
            )?;
            Ok(())
        })
    }
}
