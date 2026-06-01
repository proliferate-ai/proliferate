use rusqlite::{params, OptionalExtension};

use crate::persistence::Db;

pub const DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 20;
pub const MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 10;
pub const MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO: u32 = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRetentionPolicyRecord {
    pub max_materialized_worktrees_per_repo: u32,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct WorktreeRetentionPolicyStore {
    db: Db,
}

impl WorktreeRetentionPolicyStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn get_policy(&self) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
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
                    let updated_at = chrono::Utc::now().to_rfc3339();
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

    pub fn update_policy(
        &self,
        max_materialized_worktrees_per_repo: u32,
    ) -> anyhow::Result<WorktreeRetentionPolicyRecord> {
        validate_max_materialized_worktrees_per_repo(max_materialized_worktrees_per_repo)?;
        let updated_at = chrono::Utc::now().to_rfc3339();
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

pub fn validate_max_materialized_worktrees_per_repo(value: u32) -> anyhow::Result<()> {
    if !(MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO..=MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO)
        .contains(&value)
    {
        anyhow::bail!(
            "maxMaterializedWorktreesPerRepo must be between {} and {}",
            MIN_MAX_MATERIALIZED_WORKTREES_PER_REPO,
            MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        WorktreeRetentionPolicyStore, DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO,
        MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO,
    };
    use crate::persistence::Db;

    #[test]
    fn reads_default_policy_from_migration() {
        let store = WorktreeRetentionPolicyStore::new(Db::open_in_memory().expect("open db"));
        let policy = store.get_policy().expect("policy");

        assert_eq!(
            policy.max_materialized_worktrees_per_repo,
            DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
        assert!(!policy.updated_at.is_empty());
    }

    #[test]
    fn recreates_missing_singleton_row() {
        let db = Db::open_in_memory().expect("open db");
        db.with_conn(|conn| {
            conn.execute("DELETE FROM worktree_retention_policy WHERE id = 1", [])?;
            Ok(())
        })
        .expect("delete row");
        let store = WorktreeRetentionPolicyStore::new(db);

        let policy = store.get_policy().expect("policy");

        assert_eq!(
            policy.max_materialized_worktrees_per_repo,
            DEFAULT_MAX_MATERIALIZED_WORKTREES_PER_REPO
        );
    }

    #[test]
    fn updates_policy_with_upsert_and_bounds() {
        let db = Db::open_in_memory().expect("open db");
        let store = WorktreeRetentionPolicyStore::new(db);

        let updated = store.update_policy(10).expect("update policy");
        assert_eq!(updated.max_materialized_worktrees_per_repo, 10);
        assert_eq!(
            store
                .get_policy()
                .expect("policy")
                .max_materialized_worktrees_per_repo,
            10
        );

        assert!(store.update_policy(9).is_err());
        assert!(store.update_policy(0).is_err());
        assert!(store
            .update_policy(MAX_MAX_MATERIALIZED_WORKTREES_PER_REPO + 1)
            .is_err());
    }
}
