//! Durable creation/idempotency after delivery identity validation.

use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::delivery::{delivery_identity_conflict, ConflictAbort, DeliveryIdentity};
use super::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use super::observations;
use super::plan;
use super::service::{WorkflowService, WorkflowServiceError};
use super::store::WorkflowStore;
use super::support::now;

impl WorkflowService {
    /// Create a run and pending step rows under a complete explicit identity.
    /// An exact re-delivery is idempotent; legacy NULL/partial identity and any
    /// workspace, plan-byte, hash, or generation conflict stay parked.
    pub fn create_run_with_identity(
        &self,
        plan_json: &str,
        workspace_id: &str,
        identity: &DeliveryIdentity,
    ) -> Result<(WorkflowRunRecord, bool), WorkflowServiceError> {
        let plan = plan::parse(plan_json)?;
        if plan.run_id != identity.run_id {
            return Err(WorkflowServiceError::InvalidDeliveryIdentity(
                "runId is inconsistent with plan.run_id".to_string(),
            ));
        }
        let run_id = plan.run_id.clone();
        let plan_json = plan_json.to_string();
        let workspace_id = workspace_id.to_string();
        let created = self.store().with_tx_anyhow(|tx| {
            if let Some(existing) = WorkflowStore::find_run_tx(tx, &run_id)? {
                if let Some(field) = delivery_identity_conflict(&existing, identity) {
                    return Err(ConflictAbort { field }.into());
                }
                if existing.workspace_id != workspace_id {
                    return Err(ConflictAbort {
                        field: "workspace_id",
                    }
                    .into());
                }
                if existing.plan_json != plan_json {
                    return Err(ConflictAbort { field: "plan_json" }.into());
                }
                return Ok((existing, false));
            }
            let now = now();
            let run = WorkflowRunRecord {
                run_id: run_id.clone(),
                workflow_id: plan.workflow_id.clone(),
                workflow_version_id: plan.workflow_version_id.clone(),
                version_n: plan.version_n,
                trigger_kind: plan.trigger_kind.clone(),
                target_mode: plan.target_mode.clone(),
                workspace_id: workspace_id.clone(),
                plan_json: plan_json.clone(),
                plan_hash: Some(identity.plan_hash.clone()),
                binding_hash: Some(identity.binding_hash.clone()),
                execution_generation: Some(identity.execution_generation),
                status: WorkflowRunStatus::Running,
                step_cursor: 0,
                session_ids: std::collections::BTreeMap::new(),
                error_code: None,
                error_message: None,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            WorkflowStore::insert_run(tx, &run)?;
            for (index, step) in plan.steps.iter().enumerate() {
                // The current flattened legacy plan carries stable structured
                // keys; synthesize only for old test/parked inputs.
                let step_key = if step.key.is_empty() {
                    format!("0.-.{index}")
                } else {
                    step.key.clone()
                };
                WorkflowStore::insert_step_run(
                    tx,
                    &WorkflowStepRunRecord {
                        run_id: run_id.clone(),
                        step_index: index as i64,
                        step_key,
                        kind: step.kind_slug().to_string(),
                        status: WorkflowStepStatus::Pending,
                        attempt: 0,
                        output_json: None,
                        error_code: None,
                        error_message: None,
                        started_at: None,
                        ended_at: None,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                    },
                )?;
            }
            observations::append_in_tx(tx, &run_id)?;
            Ok((run, true))
        });
        match created {
            Ok(created) => Ok(created),
            Err(error) => match error.downcast::<ConflictAbort>() {
                Ok(conflict) => Err(WorkflowServiceError::DeliveryIdentityConflict {
                    field: conflict.field,
                }),
                Err(error) => Err(WorkflowServiceError::Store(error)),
            },
        }
    }
}
