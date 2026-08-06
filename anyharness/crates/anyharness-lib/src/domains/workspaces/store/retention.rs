//! Persistence for the `worktree_retention_policy` singleton row.
//!
//! Store half of the former `workspaces/retention_policy.rs`, which was a
//! DB-backed store wearing a policy name. The decisions (bounds validation,
//! per-repo keep threshold) now live in `workspaces/retention_policy.rs` as a
//! pure policy; this file only reads and writes rows. Callers supply `updated_at`
//! so the clock stays above the store.

use rusqlite::{params, OptionalExtension};

use crate::domains::workspaces::retention_policy::{
    WorktreeRetentionPolicyRecord, DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct WorktreeRetentionPolicyStore {
    db: Db,
}

impl WorktreeRetentionPolicyStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Read the singleton policy row, recreating it at the default cap if the
    /// migration row is missing. `default_updated_at` is the caller's clock
    /// reading, used only on the recreate path.
    pub fn get_policy(
        &self,
        default_updated_at: &str,
    ) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
        self.db.with_tx(|conn| {
            let policy = conn
                .query_row(
                    "SELECT max_materialized_worktrees_per_repo, updated_at
                       FROM worktree_retention_policy
                      WHERE id = 1",
                    [],
                    |row| {
                        Ok(WorktreeRetentionPolicyRecord {
                            max_materialized_worktrees_per_repo: row.get::<_, u32>(0)?,
                            updated_at: row.get(1)?,
                        })
                    },
                )
                .optional()?;
            match policy {
                Some(policy) => Ok(policy),
                None => {
                    let updated_at = default_updated_at.to_string();
                    conn.execute(
                        "INSERT INTO worktree_retention_policy (
                            id, max_materialized_worktrees_per_repo, updated_at
                         ) VALUES (1, ?1, ?2)",
                        params![DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO, updated_at],
                    )?;
                    Ok(WorktreeRetentionPolicyRecord {
                        max_materialized_worktrees_per_repo:
                            DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
                        updated_at,
                    })
                }
            }
        })
    }

    /// Upsert the singleton policy row. Bounds are the policy's business, not
    /// the store's: callers validate before writing.
    pub fn upsert_policy(
        &self,
        max_materialized_worktrees_per_repo: u32,
        updated_at: &str,
    ) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
        let updated_at = updated_at.to_string();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO worktree_retention_policy (
                    id, max_materialized_worktrees_per_repo, updated_at
                 ) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                    max_materialized_worktrees_per_repo = excluded.max_materialized_worktrees_per_repo,
                    updated_at = excluded.updated_at",
                params![max_materialized_worktrees_per_repo, updated_at],
            )?;
            Ok(WorktreeRetentionPolicyRecord {
                max_materialized_worktrees_per_repo,
                updated_at,
            })
        })
    }
}
