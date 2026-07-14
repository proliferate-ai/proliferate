//! Schema-v2 portable workflow acceptance and durable read composition.
//! Execution remains on the single [`WorkflowRunRuntime`](super::runtime::WorkflowRunRuntime)
//! facade; this module only extends the existing synchronous service/store.

use crate::domains::workflows::model::{
    workflow_prompt_id, PutWorkflowRunInputV2, WorkflowResolvedPlanV2, WorkflowRunInvocation,
    WorkflowRunRecord, WorkflowRunStatus, WorkflowRunStepRecord, WorkflowRunStoredSourceV2,
    WorkflowStepStatus,
};
use crate::domains::workflows::portable_validation::{
    render_source_prompt_v2, validate_invocation_v2,
};
use crate::domains::workflows::service::{
    WorkflowRunService, WorkflowRunValidationError, WorkflowRunView, WorkflowServiceError,
};

#[derive(Debug, Clone)]
pub struct WorkflowRunViewV2 {
    pub run: WorkflowRunRecord,
    pub source: WorkflowRunStoredSourceV2,
    pub resolved_plan: WorkflowResolvedPlanV2,
    pub steps: Vec<WorkflowRunStepRecord>,
}

#[derive(Debug, Clone)]
pub enum VersionedWorkflowRunView {
    V1(WorkflowRunView),
    V2(WorkflowRunViewV2),
}

#[derive(Debug, Clone)]
pub struct PreparedWorkflowRunV2 {
    pub run_id: String,
    pub source: WorkflowRunStoredSourceV2,
    pub source_json: String,
    pub prompt_id: String,
}

#[derive(Debug)]
pub enum InspectV2Outcome {
    Missing(PreparedWorkflowRunV2),
    ExactReplay(WorkflowRunViewV2),
    Conflict,
}

#[derive(Debug)]
pub enum AcceptV2Outcome {
    Created {
        plan: WorkflowResolvedPlanV2,
        view: WorkflowRunViewV2,
    },
    ExactReplay(WorkflowRunViewV2),
    Conflict,
}

impl WorkflowRunService {
    /// Normalize schema-v2 portable intent before any launch-option or access
    /// lookup. The returned canonical source is the complete replay identity.
    pub fn prepare_v2(
        &self,
        run_id: &str,
        input: PutWorkflowRunInputV2,
    ) -> Result<PreparedWorkflowRunV2, WorkflowRunValidationError> {
        let validated = validate_invocation_v2(run_id, &input)?;
        let source_json = validated
            .source
            .to_canonical_json()
            .map_err(|_| WorkflowRunValidationError::NonPortableNumber)?;
        let source = serde_json::from_str(&source_json)
            .map_err(|_| WorkflowRunValidationError::NonPortableNumber)?;
        Ok(PreparedWorkflowRunV2 {
            run_id: run_id.to_string(),
            source,
            source_json,
            prompt_id: workflow_prompt_id(run_id),
        })
    }

    /// Render and validate the portable prompt only after target access and
    /// target resolution have succeeded. Exact replay never calls this seam.
    pub fn render_v2(
        &self,
        prepared: &PreparedWorkflowRunV2,
    ) -> Result<String, WorkflowRunValidationError> {
        render_source_prompt_v2(&prepared.source)
    }

    /// Read-before-resolve replay gate. An existing exact v2 source returns
    /// its stored concrete plan without consulting workspace launch options.
    pub fn inspect_v2(
        &self,
        prepared: PreparedWorkflowRunV2,
    ) -> Result<InspectV2Outcome, WorkflowServiceError> {
        let Some((run, steps)) = self.store.get(&prepared.run_id)? else {
            return Ok(InspectV2Outcome::Missing(prepared));
        };
        if run.schema_version != 2 || run.invocation_json != prepared.source_json {
            return Ok(InspectV2Outcome::Conflict);
        }
        Ok(InspectV2Outcome::ExactReplay(parse_v2_view(run, steps)?))
    }

    /// Atomically accept source + resolved plan + materialized step. A race
    /// winner's already-stored plan is returned on exact replay.
    pub fn accept_v2(
        &self,
        prepared: PreparedWorkflowRunV2,
        plan: WorkflowResolvedPlanV2,
    ) -> Result<AcceptV2Outcome, WorkflowServiceError> {
        let created_at = chrono::Utc::now().to_rfc3339();
        let resolved_plan_json = plan
            .to_json()
            .map_err(|error| WorkflowServiceError::Store(error.into()))?;
        let run = WorkflowRunRecord {
            id: prepared.run_id.clone(),
            schema_version: 2,
            invocation_json: prepared.source_json,
            resolved_plan_json: Some(resolved_plan_json),
            status: WorkflowRunStatus::Accepted,
            workspace_id: prepared.source.workspace_id.clone(),
            session_id: None,
            failure_code: None,
            created_at: created_at.clone(),
            updated_at: created_at.clone(),
            started_at: None,
            finished_at: None,
        };
        let step = WorkflowRunStepRecord {
            run_id: prepared.run_id,
            stage_index: 0,
            step_index: 0,
            status: WorkflowStepStatus::Pending,
            prompt_id: plan.prompt_id.clone(),
            turn_id: None,
            failure_code: None,
            created_at: created_at.clone(),
            updated_at: created_at,
            started_at: None,
            finished_at: None,
        };

        match self.store.accept(&run, &step)? {
            crate::domains::workflows::store::StoreAcceptOutcome::Created => {
                Ok(AcceptV2Outcome::Created {
                    plan: plan.clone(),
                    view: WorkflowRunViewV2 {
                        run,
                        source: prepared.source,
                        resolved_plan: plan,
                        steps: vec![step],
                    },
                })
            }
            crate::domains::workflows::store::StoreAcceptOutcome::ExactReplay { run, steps } => {
                Ok(AcceptV2Outcome::ExactReplay(parse_v2_view(run, steps)?))
            }
            crate::domains::workflows::store::StoreAcceptOutcome::Conflict => {
                Ok(AcceptV2Outcome::Conflict)
            }
        }
    }

    pub fn get_versioned(
        &self,
        run_id: &str,
    ) -> Result<Option<VersionedWorkflowRunView>, WorkflowServiceError> {
        let Some((run, steps)) = self.store.get(run_id)? else {
            return Ok(None);
        };
        match run.schema_version {
            1 => {
                let invocation =
                    serde_json::from_str::<WorkflowRunInvocation>(&run.invocation_json)
                        .map_err(|error| WorkflowServiceError::Store(error.into()))?;
                Ok(Some(VersionedWorkflowRunView::V1(WorkflowRunView {
                    run,
                    invocation,
                    steps,
                })))
            }
            2 => Ok(Some(VersionedWorkflowRunView::V2(parse_v2_view(
                run, steps,
            )?))),
            version => Err(WorkflowServiceError::Store(anyhow::anyhow!(
                "unsupported stored workflow schema version {version}"
            ))),
        }
    }
}

fn parse_v2_view(
    run: WorkflowRunRecord,
    steps: Vec<WorkflowRunStepRecord>,
) -> Result<WorkflowRunViewV2, WorkflowServiceError> {
    let source = serde_json::from_str::<WorkflowRunStoredSourceV2>(&run.invocation_json)
        .map_err(|error| WorkflowServiceError::Store(error.into()))?;
    let plan_json = run.resolved_plan_json.as_deref().ok_or_else(|| {
        WorkflowServiceError::Store(anyhow::anyhow!(
            "schema-v2 workflow run has no resolved plan"
        ))
    })?;
    let resolved_plan = serde_json::from_str::<WorkflowResolvedPlanV2>(plan_json)
        .map_err(|error| WorkflowServiceError::Store(error.into()))?;
    Ok(WorkflowRunViewV2 {
        run,
        source,
        resolved_plan,
        steps,
    })
}
