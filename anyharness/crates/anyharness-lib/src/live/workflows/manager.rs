//! [`WorkflowRunManager`] is the API-facing read/control surface for workflow
//! runs. WF-ID deliberately contains no production edge into the legacy actor:
//! delivery performs identity preflight only, startup leaves historical rows
//! parked, and approval cannot resume execution. WF-PLAN-V2 and WF-CRED must
//! add the final-envelope activation edge atomically in a later packet.

use std::sync::Arc;

use anyharness_contract::v1::ExecutionBinding;

use super::executor::WorkflowExecDeps;
use crate::domains::workflows::delivery::{validate_delivery_identity, DeliveryIdentity};
use crate::domains::workflows::model::{WorkflowRunRecord, WorkflowStepRunRecord};
use crate::domains::workflows::service::WorkflowServiceError;

#[derive(Clone)]
pub struct WorkflowRunManager {
    deps: Arc<WorkflowExecDeps>,
}

impl WorkflowRunManager {
    pub fn new(deps: Arc<WorkflowExecDeps>) -> Self {
        Self { deps }
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    pub fn get_run(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Option<(WorkflowRunRecord, Vec<WorkflowStepRunRecord>)>> {
        self.deps.workflow_service.get_run_with_steps(run_id)
    }

    pub fn list_runs(&self, workspace_id: Option<&str>) -> anyhow::Result<Vec<WorkflowRunRecord>> {
        self.deps.workflow_service.list_runs(workspace_id)
    }

    // ---------------------------------------------------------------------
    // Delivery preflight (activation hard-disabled until final envelope)
    // ---------------------------------------------------------------------

    /// Validate immutable legacy-v1 plan/binding consistency plus the current
    /// runtime workspace generation. This does not yet verify Git HEAD,
    /// checkpoint contents, or materialization lineage. WF-ID deliberately
    /// stops here: no SQLite row, session, effect, observation, or actor is
    /// created until WF-PLAN-V2 and WF-CRED deliver a final envelope and its
    /// later activation verifier.
    pub fn preflight_delivery(
        &self,
        plan_json: &str,
        workspace_id: &str,
        schema_version: u32,
        identity: &DeliveryIdentity,
        binding: &ExecutionBinding,
    ) -> Result<(), WorkflowServiceError> {
        let plan_value: serde_json::Value = serde_json::from_str(plan_json).map_err(|error| {
            WorkflowServiceError::InvalidDeliveryIdentity(format!("plan is not JSON: {error}"))
        })?;
        let workspace_generation = self
            .deps
            .workspace_runtime
            .get_workspace_generation(workspace_id)?
            .ok_or(WorkflowServiceError::WorkspaceNotFound)?;
        validate_delivery_identity(
            schema_version,
            identity,
            &plan_value,
            workspace_id,
            workspace_generation,
            binding,
        )
        .map_err(|error| WorkflowServiceError::InvalidDeliveryIdentity(error.to_string()))?;
        Ok(())
    }

    // ---------------------------------------------------------------------
    // Control
    // ---------------------------------------------------------------------

    /// Historical terminal rows remain readable. A non-terminal legacy row is
    /// not proven quiescent, so WF-ID parks it and refuses control mutation
    /// until final-envelope activation owns cancellation fencing.
    pub async fn cancel(&self, run_id: &str) -> Result<WorkflowRunRecord, WorkflowServiceError> {
        let run = self
            .deps
            .workflow_service
            .get_run(run_id)?
            .ok_or(WorkflowServiceError::RunNotFound)?;
        if run.is_terminal() {
            return Ok(run);
        }
        Err(WorkflowServiceError::FinalEnvelopeRequired)
    }

    /// Resolve a parked approval (approve/deny) and resume driving if that
    /// advanced the run.
    pub fn resolve_approval(
        &self,
        run_id: &str,
        approve: bool,
    ) -> Result<WorkflowRunRecord, WorkflowServiceError> {
        let _ = (run_id, approve);
        Err(WorkflowServiceError::FinalEnvelopeRequired)
    }

    // ---------------------------------------------------------------------
    // Startup resume
    // ---------------------------------------------------------------------

    pub fn spawn_startup_pass(self) {
        tokio::spawn(async move {
            let runs = match self.deps.workflow_service.list_non_terminal_runs() {
                Ok(runs) => runs,
                Err(error) => {
                    tracing::warn!(error = %error, "workflow resume: failed to load non-terminal runs");
                    return;
                }
            };
            for run in runs {
                tracing::warn!(
                    run_id = %run.run_id,
                    code = "FINAL_ENVELOPE_REQUIRED",
                    "workflow resume: activation hard-disabled pending final envelope"
                );
            }
        });
    }
}
