use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};

use super::WorkflowStore;
use crate::domains::workflows::cleanup::{
    WorkflowCleanupFence, WorkflowMaterializationBegin, WorkflowMaterializationCleanupReceipt,
    WorkflowMaterializationIntent, WorkflowMaterializationRecord, WorkflowMaterializationState,
};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};

impl WorkflowStore {
    pub fn begin_materialization(
        &self,
        intent: &WorkflowMaterializationIntent,
        now: &str,
    ) -> anyhow::Result<WorkflowMaterializationBegin> {
        let broker_generation = validate_intent_generations(intent)?;
        self.db.with_tx_anyhow(|tx| {
            let run = Self::find_run_tx(tx, &intent.run_id)?
                .ok_or_else(|| anyhow::anyhow!("workflow materialization run does not exist"))?;
            if run.is_terminal() {
                anyhow::bail!("terminal workflow run cannot begin materialization");
            }
            if let Some(existing) = Self::find_materialization_tx(tx, intent, broker_generation)? {
                if existing.intent != *intent {
                    anyhow::bail!(
                        "workflow materialization identity conflicts with its durable intent"
                    );
                }
                return match existing.state {
                    WorkflowMaterializationState::Cleaned => {
                        Ok(WorkflowMaterializationBegin::Retired(existing))
                    }
                    WorkflowMaterializationState::Pending
                    | WorkflowMaterializationState::CleanupRequired => {
                        Ok(WorkflowMaterializationBegin::ReconcileFirst(existing))
                    }
                    WorkflowMaterializationState::Registered => {
                        Ok(WorkflowMaterializationBegin::Registered(existing))
                    }
                };
            }

            tx.execute(
                "INSERT INTO workflow_materialization_operations (
                    run_id, scope_id, source_repo_root_id, source_root, target_root, branch_name,
                    base_commit_oid, execution_generation, broker_generation,
                    state, workspace_id, last_error, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                           'pending', NULL, NULL, ?10, ?10)",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.source_repo_root_id,
                    intent.source_root.to_string_lossy(),
                    intent.target_root.to_string_lossy(),
                    intent.branch_name,
                    intent.base_commit_oid,
                    intent.execution_generation,
                    broker_generation,
                    now,
                ],
            )?;
            let record = Self::find_materialization_tx(tx, intent, broker_generation)?
                .ok_or_else(|| anyhow::anyhow!("materialization row missing after insert"))?;
            Ok(WorkflowMaterializationBegin::Ready(record))
        })
    }

    pub fn mark_materialization_cleanup_required(
        &self,
        intent: &WorkflowMaterializationIntent,
        last_error: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        let broker_generation = validate_intent_generations(intent)?;
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE workflow_materialization_operations
                 SET state = 'cleanup_required', workspace_id = NULL,
                     last_error = ?5, updated_at = ?6
                 WHERE run_id = ?1 AND scope_id = ?2
                   AND execution_generation = ?3 AND broker_generation = ?4
                   AND source_repo_root_id = ?7
                   AND source_root = ?8 AND target_root = ?9
                   AND branch_name = ?10 AND base_commit_oid = ?11
                   AND state IN ('pending', 'cleanup_required')",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.execution_generation,
                    broker_generation,
                    last_error,
                    now,
                    intent.source_repo_root_id,
                    intent.source_root.to_string_lossy(),
                    intent.target_root.to_string_lossy(),
                    intent.branch_name,
                    intent.base_commit_oid,
                ],
            )?;
            if changed != 1 {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }
            Ok(())
        })
    }

    pub fn register_materialized_workspace(
        &self,
        intent: &WorkflowMaterializationIntent,
        workspace: &WorkspaceRecord,
        now: &str,
    ) -> anyhow::Result<()> {
        let broker_generation = validate_intent_generations(intent)?;
        validate_workspace_registration(intent, workspace)?;
        self.db.with_tx_anyhow(|tx| {
            let run = Self::find_run_tx(tx, &intent.run_id)?
                .ok_or_else(|| anyhow::anyhow!("workflow materialization run does not exist"))?;
            if run.is_terminal() {
                anyhow::bail!("terminal workflow run cannot register materialization");
            }
            let existing = Self::find_materialization_tx(tx, intent, broker_generation)?
                .ok_or_else(|| anyhow::anyhow!("materialization operation does not exist"))?;
            if existing.intent != *intent || !existing.state.requires_reconciliation() {
                anyhow::bail!("materialization operation is not awaiting exact registration");
            }
            let path_conflict: bool = tx.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM workspaces
                    WHERE path = ?1 AND lifecycle_state = 'active'
                 )",
                [&workspace.path],
                |row| row.get(0),
            )?;
            if path_conflict {
                anyhow::bail!("active workspace already owns materialization target path");
            }
            crate::domains::workspaces::store::insert_workspace_with_materialization_base_commit(
                tx,
                workspace,
                Some(&intent.base_commit_oid),
            )?;
            let changed = tx.execute(
                "UPDATE workflow_materialization_operations
                 SET state = 'registered', workspace_id = ?5, last_error = NULL,
                     updated_at = ?6
                 WHERE run_id = ?1 AND scope_id = ?2
                   AND execution_generation = ?3 AND broker_generation = ?4
                   AND source_repo_root_id = ?7
                   AND source_root = ?8 AND target_root = ?9
                   AND branch_name = ?10 AND base_commit_oid = ?11
                   AND state IN ('pending', 'cleanup_required')",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.execution_generation,
                    broker_generation,
                    workspace.id,
                    now,
                    intent.source_repo_root_id,
                    intent.source_root.to_string_lossy(),
                    intent.target_root.to_string_lossy(),
                    intent.branch_name,
                    intent.base_commit_oid,
                ],
            )?;
            if changed != 1 {
                anyhow::bail!("materialization registration lost its exact operation identity");
            }
            tx.execute(
                "INSERT INTO workflow_materialization_registrations (
                    run_id, scope_id, execution_generation, broker_generation,
                    workspace_id, registered_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.execution_generation,
                    broker_generation,
                    workspace.id,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    pub fn record_materialization_cleanup_receipt(
        &self,
        receipt: &WorkflowMaterializationCleanupReceipt,
        now: &str,
    ) -> anyhow::Result<()> {
        let intent = receipt.intent();
        if !receipt.proves_exact_absence() {
            anyhow::bail!("materialization cleanup receipt does not prove exact artifact absence");
        }
        let broker_generation = validate_intent_generations(intent)?;
        self.db.with_tx_anyhow(|tx| {
            let existing = Self::find_materialization_tx(tx, intent, broker_generation)?
                .ok_or_else(|| anyhow::anyhow!("materialization operation does not exist"))?;
            if existing.intent != *intent {
                anyhow::bail!("cleanup receipt does not match durable materialization intent");
            }
            if existing.state == WorkflowMaterializationState::Cleaned {
                return Ok(());
            }
            if existing.state == WorkflowMaterializationState::Registered {
                let workspace_id = existing.workspace_id.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("registered materialization lost workspace ownership")
                })?;
                let deleted = tx.execute(
                    "DELETE FROM workflow_materialization_registrations
                     WHERE run_id = ?1 AND scope_id = ?2
                       AND execution_generation = ?3 AND broker_generation = ?4
                       AND workspace_id = ?5",
                    params![
                        intent.run_id,
                        intent.scope_id,
                        intent.execution_generation,
                        broker_generation,
                        workspace_id,
                    ],
                )?;
                if deleted != 1 {
                    anyhow::bail!(
                        "registered materialization lacks its exact registration receipt"
                    );
                }
            }
            let changed = tx.execute(
                "UPDATE workflow_materialization_operations
                 SET state = 'cleaned', workspace_id = NULL, last_error = NULL,
                     updated_at = ?5
                 WHERE run_id = ?1 AND scope_id = ?2
                   AND execution_generation = ?3 AND broker_generation = ?4
                   AND source_repo_root_id = ?6
                   AND source_root = ?7 AND target_root = ?8
                   AND branch_name = ?9 AND base_commit_oid = ?10
                   AND state IN ('pending', 'cleanup_required', 'registered')",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.execution_generation,
                    broker_generation,
                    now,
                    intent.source_repo_root_id,
                    intent.source_root.to_string_lossy(),
                    intent.target_root.to_string_lossy(),
                    intent.branch_name,
                    intent.base_commit_oid,
                ],
            )?;
            if changed != 1 {
                anyhow::bail!("cleanup receipt did not retire its exact operation");
            }
            Ok(())
        })
    }

    pub fn list_unresolved_materializations(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Vec<WorkflowMaterializationRecord>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM workflow_materialization_operations
                 WHERE run_id = ?1 AND state IN ('pending', 'cleanup_required')
                 ORDER BY created_at ASC, scope_id ASC",
            )?;
            let rows = statement.query_map([run_id], map_materialization)?;
            rows.collect()
        })
    }

    pub fn unresolved_materialization_run_ids(&self) -> anyhow::Result<Vec<String>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT DISTINCT run_id FROM workflow_materialization_operations
                 WHERE state IN ('pending', 'cleanup_required') ORDER BY run_id ASC",
            )?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        })
    }

    pub fn registered_workspace_for_intent(
        &self,
        intent: &WorkflowMaterializationIntent,
    ) -> anyhow::Result<Option<String>> {
        let broker_generation = validate_intent_generations(intent)?;
        let expected_creator_json = expected_creator_json(&intent.run_id)?;
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT r.workspace_id
                 FROM workflow_materialization_operations o
                 JOIN workflow_materialization_registrations r
                   ON r.run_id = o.run_id AND r.scope_id = o.scope_id
                  AND r.execution_generation = o.execution_generation
                  AND r.broker_generation = o.broker_generation
                 JOIN workspaces w ON w.id = r.workspace_id
                 WHERE o.run_id = ?1 AND o.scope_id = ?2
                   AND o.execution_generation = ?3 AND o.broker_generation = ?4
                   AND o.source_repo_root_id = ?5
                   AND o.source_root = ?6 AND o.target_root = ?7
                   AND o.branch_name = ?8 AND o.base_commit_oid = ?9
                   AND o.state = 'registered' AND o.workspace_id = r.workspace_id
                   AND w.lifecycle_state = 'active' AND w.kind = 'worktree'
                   AND w.repo_root_id = o.source_repo_root_id
                   AND w.path = o.target_root AND w.current_branch = o.branch_name
                   AND w.workflow_materialization_base_commit_oid = o.base_commit_oid
                   AND w.creator_context_json = ?10",
                params![
                    intent.run_id,
                    intent.scope_id,
                    intent.execution_generation,
                    broker_generation,
                    intent.source_repo_root_id,
                    intent.source_root.to_string_lossy(),
                    intent.target_root.to_string_lossy(),
                    intent.branch_name,
                    intent.base_commit_oid,
                    expected_creator_json,
                ],
                |row| row.get(0),
            )
            .optional()
        })
    }

    pub fn registered_materialization_for_identity(
        &self,
        run_id: &str,
        scope_id: &str,
        execution_generation: i64,
        broker_generation: u64,
    ) -> anyhow::Result<Option<WorkflowMaterializationRecord>> {
        let broker_generation = i64::try_from(broker_generation).map_err(|_| {
            anyhow::anyhow!("workflow broker generation exceeds SQLite integer range")
        })?;
        let expected_creator_json = expected_creator_json(run_id)?;
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT o.*
                 FROM workflow_materialization_operations o
                 JOIN workflow_materialization_registrations r
                   ON r.run_id = o.run_id AND r.scope_id = o.scope_id
                  AND r.execution_generation = o.execution_generation
                  AND r.broker_generation = o.broker_generation
                 JOIN workspaces w ON w.id = r.workspace_id
                 WHERE o.run_id = ?1 AND o.scope_id = ?2
                   AND o.execution_generation = ?3 AND o.broker_generation = ?4
                   AND o.state = 'registered' AND o.workspace_id = r.workspace_id
                   AND w.lifecycle_state = 'active' AND w.kind = 'worktree'
                   AND w.repo_root_id = o.source_repo_root_id
                   AND w.path = o.target_root AND w.current_branch = o.branch_name
                   AND w.workflow_materialization_base_commit_oid = o.base_commit_oid
                   AND w.creator_context_json = ?5",
                params![
                    run_id,
                    scope_id,
                    execution_generation,
                    broker_generation,
                    expected_creator_json,
                ],
                map_materialization,
            )
            .optional()
        })
    }

    pub fn fence_pending_materializations_after_restart(
        &self,
        run_id: &str,
        detail: &str,
        now: &str,
    ) -> anyhow::Result<usize> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workflow_materialization_operations
                 SET state = 'cleanup_required', last_error = ?2, updated_at = ?3
                 WHERE run_id = ?1 AND state = 'pending'",
                params![run_id, detail, now],
            )
        })
    }

    pub fn upsert_cleanup_fence(
        &self,
        run_id: &str,
        fence_kind: &str,
        fence_key: &str,
        detail: &str,
        now: &str,
    ) -> anyhow::Result<()> {
        self.db.with_tx_anyhow(|tx| {
            let run = Self::find_run_tx(tx, run_id)?
                .ok_or_else(|| anyhow::anyhow!("workflow cleanup-fence run does not exist"))?;
            if run.is_terminal() {
                anyhow::bail!("terminal workflow run cannot acquire new cleanup ownership");
            }
            tx.execute(
                "INSERT INTO workflow_cleanup_fences (
                    run_id, fence_kind, fence_key, detail, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(run_id, fence_kind, fence_key) DO UPDATE SET
                    detail = excluded.detail, updated_at = excluded.updated_at",
                params![run_id, fence_kind, fence_key, detail, now],
            )?;
            Ok(())
        })
    }

    pub fn clear_cleanup_fence(
        &self,
        run_id: &str,
        fence_kind: &str,
        fence_key: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "DELETE FROM workflow_cleanup_fences
                 WHERE run_id = ?1 AND fence_kind = ?2 AND fence_key = ?3",
                params![run_id, fence_kind, fence_key],
            )?;
            Ok(())
        })
    }

    pub fn list_cleanup_fences(&self, run_id: &str) -> anyhow::Result<Vec<WorkflowCleanupFence>> {
        self.db.with_conn(|conn| {
            let mut statement = conn.prepare(
                "SELECT * FROM workflow_cleanup_fences
                 WHERE run_id = ?1 ORDER BY fence_kind ASC, fence_key ASC",
            )?;
            let rows = statement.query_map([run_id], map_cleanup_fence)?;
            rows.collect()
        })
    }

    pub(in crate::domains::workflows) fn has_terminal_cleanup_blocker_tx(
        tx: &Connection,
        run_id: &str,
    ) -> rusqlite::Result<bool> {
        tx.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM workflow_materialization_operations
                WHERE run_id = ?1 AND state IN ('pending', 'cleanup_required')
                UNION ALL
                SELECT 1 FROM workflow_cleanup_fences WHERE run_id = ?1
            )",
            [run_id],
            |row| row.get::<_, i64>(0).map(|value| value != 0),
        )
    }

    pub(crate) fn workspace_purge_blocker_tx(
        tx: &Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<Option<String>> {
        tx.query_row(
            "SELECT CASE WHEN wr.status IN ('completed', 'failed', 'cancelled')
                    THEN 'workflow broker cleanup receipt is required before workspace purge'
                    ELSE 'nonterminal workflow materialization cannot be purged'
                    END
             FROM workflow_materialization_operations o
             JOIN workflow_runs wr ON wr.run_id = o.run_id
             WHERE o.workspace_id = ?1 AND o.state = 'registered'
             LIMIT 1",
            [workspace_id],
            |row| row.get(0),
        )
        .optional()
    }

    pub(crate) fn reject_registered_workspace_purge_tx(
        tx: &Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()> {
        if Self::workspace_purge_blocker_tx(tx, workspace_id)?.is_some() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        Ok(())
    }

    fn find_materialization_tx(
        tx: &Connection,
        intent: &WorkflowMaterializationIntent,
        broker_generation: i64,
    ) -> rusqlite::Result<Option<WorkflowMaterializationRecord>> {
        tx.query_row(
            "SELECT * FROM workflow_materialization_operations
             WHERE run_id = ?1 AND scope_id = ?2
               AND execution_generation = ?3 AND broker_generation = ?4",
            params![
                intent.run_id,
                intent.scope_id,
                intent.execution_generation,
                broker_generation,
            ],
            map_materialization,
        )
        .optional()
    }
}

fn validate_intent_generations(intent: &WorkflowMaterializationIntent) -> anyhow::Result<i64> {
    if intent.execution_generation <= 0 {
        anyhow::bail!("workflow execution generation must be positive");
    }
    if intent.broker_generation == 0 {
        anyhow::bail!("workflow broker generation must be positive");
    }
    i64::try_from(intent.broker_generation)
        .map_err(|_| anyhow::anyhow!("workflow broker generation exceeds SQLite integer range"))
}

fn map_materialization(row: &Row<'_>) -> rusqlite::Result<WorkflowMaterializationRecord> {
    let state_raw: String = row.get("state")?;
    let state = WorkflowMaterializationState::from_db(&state_raw).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            0,
            Type::Text,
            format!("unknown workflow materialization state: {state_raw}").into(),
        )
    })?;
    let broker_generation = row.get::<_, i64>("broker_generation")?;
    let broker_generation = u64::try_from(broker_generation).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(0, Type::Integer, Box::new(error))
    })?;
    Ok(WorkflowMaterializationRecord {
        intent: WorkflowMaterializationIntent {
            run_id: row.get("run_id")?,
            scope_id: row.get("scope_id")?,
            source_repo_root_id: row.get("source_repo_root_id")?,
            source_root: std::path::PathBuf::from(row.get::<_, String>("source_root")?),
            target_root: std::path::PathBuf::from(row.get::<_, String>("target_root")?),
            branch_name: row.get("branch_name")?,
            base_commit_oid: row.get("base_commit_oid")?,
            execution_generation: row.get("execution_generation")?,
            broker_generation,
        },
        state,
        workspace_id: row.get("workspace_id")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn validate_workspace_registration(
    intent: &WorkflowMaterializationIntent,
    workspace: &WorkspaceRecord,
) -> anyhow::Result<()> {
    let canonical_target = std::fs::canonicalize(&intent.target_root)
        .unwrap_or_else(|_| intent.target_root.clone())
        .to_string_lossy()
        .to_string();
    let expected_creator = WorkspaceCreatorContext::Automation {
        automation_id: None,
        automation_run_id: Some(intent.run_id.clone()),
        label: Some("workflow-run".to_string()),
    };
    if workspace.kind != WorkspaceKind::Worktree
        || workspace.lifecycle_state != WorkspaceLifecycleState::Active
        || workspace.repo_root_id != intent.source_repo_root_id
        || intent.target_root.to_string_lossy() != canonical_target
        || workspace.path != canonical_target
        || workspace.current_branch.as_deref() != Some(intent.branch_name.as_str())
        || workspace.creator_context.as_ref() != Some(&expected_creator)
    {
        anyhow::bail!("workspace metadata does not match exact materialization intent");
    }
    Ok(())
}

fn expected_creator_json(run_id: &str) -> anyhow::Result<String> {
    crate::domains::workspaces::creator_context::encode_creator_context_json(&Some(
        WorkspaceCreatorContext::Automation {
            automation_id: None,
            automation_run_id: Some(run_id.to_string()),
            label: Some("workflow-run".to_string()),
        },
    ))?
    .ok_or_else(|| anyhow::anyhow!("workflow creator context did not serialize"))
}

fn map_cleanup_fence(row: &Row<'_>) -> rusqlite::Result<WorkflowCleanupFence> {
    Ok(WorkflowCleanupFence {
        run_id: row.get("run_id")?,
        fence_kind: row.get("fence_kind")?,
        fence_key: row.get("fence_key")?,
        detail: row.get("detail")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}
