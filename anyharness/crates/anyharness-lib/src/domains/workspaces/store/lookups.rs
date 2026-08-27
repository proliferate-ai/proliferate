use std::path::Path;

use rusqlite::{params, OptionalExtension};

use super::row::{map_row, WORKSPACE_COLUMNS};
use super::WorkspaceStore;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::path_identity::same_path;

impl WorkspaceStore {
    pub fn find_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE path = ?1 ORDER BY created_at ASC, id ASC LIMIT 1"),
                [path],
                map_row,
            )
            .optional()
        })
    }

    pub fn find_active_by_path(&self, path: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                [path],
                map_row,
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
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND id <> ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, excluded_id],
                map_row,
            )
            .optional()
        })
    }

    pub fn find_active_by_path_and_kind_excluding_id(
        &self,
        path: &str,
        kind: WorkspaceKind,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2 AND id <> ?3 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str(), excluded_id],
                map_row,
            )
            .optional()
        })
    }

    pub fn find_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str()],
                map_row,
            )
            .optional()
        })
    }

    pub fn find_active_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1 AND kind = ?2 AND lifecycle_state = 'active'
                 ORDER BY created_at ASC, id ASC LIMIT 1"
                ),
                params![path, kind.as_str()],
                map_row,
            )
            .optional()
        })
    }

    /// Any archived row claiming `path`. Archiving reserves a workspace's
    /// recorded path for its lifetime: unarchive restores in place and never
    /// relocates, so a path handed to a new workspace is a path its owner can
    /// never come back to. That is why this covers ALL archived rows, not just
    /// the incomplete-cleanup subset the retire-era predicate looked at.
    pub fn find_archived_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE path = ?1
                   AND kind = ?2
                   AND lifecycle_state = 'archived'
                 ORDER BY updated_at DESC
                 LIMIT 1"
                ),
                params![path, kind.as_str()],
                map_row,
            )
            .optional()
        })
    }

    pub fn find_by_id(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?1"),
                [id],
                map_row,
            )
            .optional()
        })
    }

    /// The named read the archive flows use where "absent" is a possibility
    /// they handle (the pre-gate fast path). Same query as
    /// [`Self::find_by_id`], named for the intent so the flows read as prose.
    pub fn find_workspace(&self, id: &str) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.find_by_id(id)
    }

    /// The named read for every step that runs AFTER the workspace's existence
    /// is already established (post-lease, post-flip): absent is a real error
    /// there, not a branch, and an `Option` would invite silently skipping the
    /// step that must not be skipped.
    pub fn require_workspace(&self, id: &str) -> anyhow::Result<WorkspaceRecord> {
        self.find_by_id(id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {id}"))
    }

    /// Does any row OTHER than `workspace` claim `workspace`'s recorded path?
    ///
    /// Two specifics carry the whole safety story:
    ///
    /// - **Which lifecycles count as a claim**: everything EXCEPT a
    ///   sha-bearing archived row. Active rows always claim; archived rows
    ///   claim when `archived_head_sha` IS NULL, because that surviving
    ///   directory may be the only copy of never-snapshotted work; and a
    ///   lifecycle value this binary does not know claims too. The predicate is
    ///   stated as the exclusion rather than as a list of claimants precisely
    ///   so it fails CLOSED: a row a newer binary wrote in a state we cannot
    ///   parse must never have its directory destroyed on the strength of an
    ///   enum we did not recognise, which is the same tolerance R0 built into
    ///   the read path. Only the provably safe case is exempt — a sha-bearing
    ///   archived row's work lives in its refs and its directory is mere
    ///   leftover. Counting THAT case would wedge two archived rows recording
    ///   one path forever: each reads as the other's claimant, so neither
    ///   leftover is ever sweepable and neither row can be individually
    ///   converged.
    /// - **Both sides are resolved before comparing** (see
    ///   `domains/workspaces/path_identity.rs`), so `/tmp` and `/private/tmp`
    ///   spellings of one directory are one path, and an unresolvable path
    ///   counts as a claim — fail safe, never fail destructive.
    pub fn any_other_row_claims_path(&self, workspace: &WorkspaceRecord) -> anyhow::Result<bool> {
        let candidates: Vec<WorkspaceRecord> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                // The one non-claimant, stated as an exclusion so an unknown
                // lifecycle value claims. `IS NOT` rather than `<>` because it
                // is null-safe: a NULL lifecycle_state must not evaporate the
                // whole row out of the claimant set.
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE id <> ?1
                   AND NOT (lifecycle_state IS 'archived'
                            AND archived_head_sha IS NOT NULL)"
            ))?;
            let rows = stmt.query_map([&workspace.id], map_row)?;
            rows.collect()
        })?;
        let subject = Path::new(&workspace.path);
        Ok(candidates
            .iter()
            .any(|candidate| same_path(subject, Path::new(&candidate.path))))
    }

    /// Every row that OTHER than `workspace` claims `workspace`'s recorded
    /// path, under the same narrowed rule as
    /// [`Self::any_other_row_claims_path`]. The claim gate needs the row
    /// itself, not just the boolean: the 409 names the occupant and its
    /// lifecycle so the dialog copy can point at an exit that exists.
    pub fn other_rows_claiming_path(
        &self,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        let candidates: Vec<WorkspaceRecord> = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                // Same fail-closed exclusion as
                // `any_other_row_claims_path`; the two must never disagree
                // about who counts as a claimant.
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE id <> ?1
                   AND NOT (lifecycle_state IS 'archived'
                            AND archived_head_sha IS NOT NULL)
                 ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([&workspace.id], map_row)?;
            rows.collect()
        })?;
        let subject = Path::new(&workspace.path);
        Ok(candidates
            .into_iter()
            .filter(|candidate| same_path(subject, Path::new(&candidate.path)))
            .collect())
    }
}
