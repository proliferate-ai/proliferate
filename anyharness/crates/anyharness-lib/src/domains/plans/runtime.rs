use std::path::PathBuf;
use std::sync::Arc;

use anyharness_contract::v1::{PromptInputBlock, ProposedPlanDecisionState, ProposedPlanDetail};

use super::document;
use super::model::{
    DEFAULT_IMPLEMENT_INSTRUCTION, PlanDecisionOutcome, PlanDocument, PlanHandoffInput,
    PlanHandoffOutcome, PlanHandoffPromptOutcome, PlanHandoffRecord, PlanRecord,
};
use super::service::{PlanDecisionError, PlanService, plan_to_detail};
use crate::live::sessions::{LiveSessionCommandError, LiveSessionManager};
use crate::origin::OriginContext;
use crate::sessions::runtime::{
    CreateAndStartSessionError, SendPromptError, SendPromptOutcome, SessionRuntime,
};
use crate::sessions::service::SessionService;
use crate::workspaces::access_gate::WorkspaceAccessGate;

#[derive(Debug, thiserror::Error)]
pub enum GetPlanError {
    #[error("plan not found")]
    NotFound,
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum HandoffPlanError {
    #[error("plan not found")]
    PlanNotFound,
    #[error("agent kind is required when no target session is provided")]
    AgentKindRequired,
    #[error("session not found")]
    SessionNotFound,
    #[error("failed to create target session: {0:?}")]
    CreateSession(CreateAndStartSessionError),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
    #[error("failed to send handoff prompt: {0:?}")]
    Prompt(SendPromptError),
}

#[derive(Clone)]
pub struct PlanRuntime {
    plan_service: Arc<PlanService>,
    session_runtime: Arc<SessionRuntime>,
    session_service: Arc<SessionService>,
    acp_manager: LiveSessionManager,
    access_gate: Arc<WorkspaceAccessGate>,
    runtime_home: PathBuf,
}

impl PlanRuntime {
    pub fn new(
        plan_service: Arc<PlanService>,
        session_runtime: Arc<SessionRuntime>,
        session_service: Arc<SessionService>,
        acp_manager: LiveSessionManager,
        access_gate: Arc<WorkspaceAccessGate>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            plan_service,
            session_runtime,
            session_service,
            acp_manager,
            access_gate,
            runtime_home,
        }
    }

    pub fn get_detail(
        &self,
        workspace_id: &str,
        plan_id: &str,
    ) -> Result<ProposedPlanDetail, GetPlanError> {
        let plan = self.get_plan_for_workspace(workspace_id, plan_id)?;
        Ok(plan_to_detail(&plan))
    }

    pub fn document(
        &self,
        workspace_id: &str,
        plan_id: &str,
        materialize: bool,
    ) -> Result<PlanDocument, GetPlanError> {
        let plan = self.get_plan_for_workspace(workspace_id, plan_id)?;
        let markdown = document::render_markdown(&plan);
        let (projection_path, projection_hash) = if materialize {
            let (path, hash) = document::materialize_projection(&self.runtime_home, &plan)?;
            (Some(path.to_string_lossy().to_string()), Some(hash))
        } else {
            (None, None)
        };
        Ok(PlanDocument {
            markdown,
            snapshot_hash: plan.snapshot_hash,
            projection_path,
            projection_hash,
        })
    }

    pub async fn approve(
        &self,
        workspace_id: &str,
        plan_id: &str,
        expected_version: i64,
    ) -> Result<PlanDecisionOutcome, PlanDecisionError> {
        let plan = self
            .apply_plan_decision(
                workspace_id,
                plan_id,
                expected_version,
                ProposedPlanDecisionState::Approved,
            )
            .await?;
        Ok(PlanDecisionOutcome {
            plan: plan_to_detail(&plan),
        })
    }

    pub async fn reject(
        &self,
        workspace_id: &str,
        plan_id: &str,
        expected_version: i64,
    ) -> Result<PlanDecisionOutcome, PlanDecisionError> {
        let plan = self
            .apply_plan_decision(
                workspace_id,
                plan_id,
                expected_version,
                ProposedPlanDecisionState::Rejected,
            )
            .await?;
        Ok(PlanDecisionOutcome {
            plan: plan_to_detail(&plan),
        })
    }

    pub async fn handoff(
        &self,
        workspace_id: &str,
        plan_id: &str,
        input: PlanHandoffInput,
    ) -> Result<PlanHandoffOutcome, HandoffPlanError> {
        let plan = self
            .get_plan_for_workspace(workspace_id, plan_id)
            .map_err(map_get_plan_error_to_handoff)?;
        let (projection_path, _projection_hash) =
            document::materialize_projection(&self.runtime_home, &plan)
                .map_err(HandoffPlanError::Store)?;
        let projection_path_display = projection_path.to_string_lossy().into_owned();
        let (target_session_id, session) = if let Some(target_session_id) = input.target_session_id
        {
            let target = self
                .session_service
                .get_session(&target_session_id)
                .map_err(HandoffPlanError::Store)?
                .ok_or(HandoffPlanError::SessionNotFound)?;
            if target.workspace_id != plan.workspace_id {
                return Err(HandoffPlanError::SessionNotFound);
            }
            (target_session_id, None)
        } else {
            let agent_kind = input
                .agent_kind
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(HandoffPlanError::AgentKindRequired)?;
            let origin = handoff_origin_or_api_default(input.origin);
            let record = self
                .session_runtime
                .create_and_start_session(
                    &plan.workspace_id,
                    agent_kind,
                    input.model_id.as_deref(),
                    input.mode_id.as_deref(),
                    None,
                    Vec::new(),
                    None,
                    None,
                    true,
                    None,
                    None,
                    origin,
                    None,
                )
                .await
                .map_err(HandoffPlanError::CreateSession)?;
            let session = self
                .session_runtime
                .session_to_contract(&record)
                .await
                .map_err(HandoffPlanError::Store)?;
            (record.id, Some(session))
        };
        let instruction = input
            .instruction
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_IMPLEMENT_INSTRUCTION.to_string());
        let prompt = format_handoff_prompt(&projection_path_display, &instruction);
        let now = chrono::Utc::now().to_rfc3339();
        let handoff_id = uuid::Uuid::new_v4().to_string();
        let prompt_status = match self
            .session_runtime
            .send_prompt(
                &target_session_id,
                vec![PromptInputBlock::Text { text: prompt }],
                None,
                None,
            )
            .await
        {
            Ok(SendPromptOutcome::Running { .. }) => PlanHandoffPromptOutcome::Sent,
            Ok(SendPromptOutcome::Queued { .. }) => PlanHandoffPromptOutcome::Queued,
            Err(error) => {
                tracing::warn!(
                    plan_id = %plan.id,
                    target_session_id = %target_session_id,
                    error = ?error,
                    "failed to send proposed-plan handoff prompt"
                );
                PlanHandoffPromptOutcome::Failed
            }
        };
        self.plan_service
            .store()
            .insert_handoff(&PlanHandoffRecord {
                id: handoff_id.clone(),
                plan_id: plan.id.clone(),
                source_session_id: plan.session_id.clone(),
                target_session_id: target_session_id.clone(),
                instruction,
                prompt_status: prompt_status.as_str().to_string(),
                created_at: now.clone(),
                updated_at: now,
            })?;

        Ok(PlanHandoffOutcome {
            handoff_id,
            plan_id: plan.id,
            source_session_id: plan.session_id,
            target_session_id,
            prompt_status,
            session,
        })
    }

    fn get_plan_for_workspace(
        &self,
        workspace_id: &str,
        plan_id: &str,
    ) -> Result<PlanRecord, GetPlanError> {
        let plan = self
            .plan_service
            .get(plan_id)?
            .ok_or(GetPlanError::NotFound)?;
        if plan.workspace_id != workspace_id {
            return Err(GetPlanError::NotFound);
        }
        Ok(plan)
    }

    async fn apply_plan_decision(
        &self,
        workspace_id: &str,
        plan_id: &str,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
    ) -> Result<PlanRecord, PlanDecisionError> {
        let plan = self
            .get_plan_for_workspace(workspace_id, plan_id)
            .map_err(map_get_plan_error_to_decision)?;
        self.access_gate
            .assert_can_mutate_for_session(&plan.session_id)
            .map_err(|error| PlanDecisionError::Store(anyhow::anyhow!(error.to_string())))?;

        if let Some(handle) = self.acp_manager.get_handle(&plan.session_id).await {
            return handle
                .apply_plan_decision(plan_id.to_string(), expected_version, decision)
                .await
                .map_err(|error| match error {
                    LiveSessionCommandError::ActorUnavailable => PlanDecisionError::Store(
                        anyhow::anyhow!("session actor is not available for plan decision"),
                    ),
                    LiveSessionCommandError::ResponseDropped => PlanDecisionError::Store(
                        anyhow::anyhow!("session actor dropped plan decision response"),
                    ),
                    LiveSessionCommandError::Rejected(error) => error,
                });
        }

        let (plan, _) =
            self.plan_service
                .update_decision_offline(plan_id, expected_version, decision)?;
        Ok(plan)
    }
}

fn format_handoff_prompt(document_path: &str, instruction: &str) -> String {
    format!(
        "Use the approved plan document as context.\n\nDocument: {document_path}\n\nInstruction:\n{instruction}"
    )
}

fn handoff_origin_or_api_default(origin: Option<OriginContext>) -> OriginContext {
    match origin {
        Some(origin) => origin,
        None => {
            tracing::warn!(
                operation = "handoff_plan",
                "AnyHarness request omitted origin; defaulting to api/local_runtime"
            );
            OriginContext::api_local_runtime()
        }
    }
}

fn map_get_plan_error_to_decision(error: GetPlanError) -> PlanDecisionError {
    match error {
        GetPlanError::NotFound => PlanDecisionError::NotFound,
        GetPlanError::Store(error) => PlanDecisionError::Store(error),
    }
}

fn map_get_plan_error_to_handoff(error: GetPlanError) -> HandoffPlanError {
    match error {
        GetPlanError::NotFound => HandoffPlanError::PlanNotFound,
        GetPlanError::Store(error) => HandoffPlanError::Store(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{format_handoff_prompt, handoff_origin_or_api_default};
    use crate::origin::OriginContext;

    #[test]
    fn handoff_prompt_references_document_without_repeating_title() {
        assert_eq!(
            format_handoff_prompt("/tmp/plan.md", "Carry out this approved plan now."),
            "Use the approved plan document as context.\n\nDocument: /tmp/plan.md\n\nInstruction:\nCarry out this approved plan now."
        );
    }

    #[test]
    fn handoff_origin_preserves_request_origin_for_created_sessions() {
        let origin = anyharness_contract::v1::OriginContext {
            kind: anyharness_contract::v1::OriginKind::Human,
            entrypoint: anyharness_contract::v1::OriginEntrypoint::Desktop,
        };

        assert_eq!(
            handoff_origin_or_api_default(Some(OriginContext::from_contract(origin))),
            OriginContext::human_desktop()
        );
    }

    #[test]
    fn handoff_origin_defaults_old_callers_to_api_local_runtime() {
        assert_eq!(
            handoff_origin_or_api_default(None),
            OriginContext::api_local_runtime()
        );
    }
}
