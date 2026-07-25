//! `GoalRuntime`: runtime write ops for goals (spec §2.3).
//!
//! Writes call the sidecar GoalPort ext methods through the live session
//! driver and record only a pending [`GoalWriteIntent`] — the mirror
//! transitions (and the UI shows "saved") when the observer ingests the
//! native notification round-trip. No optimistic state.

use std::sync::Arc;

use anyharness_contract::v1::{
    GoalArmState, SessionGoalResponse, SetSessionGoalRequest,
};

use super::model::{goal_to_contract, GoalWriteIntent};
use super::service::GoalService;
use crate::domains::sessions::model::{parse_action_capabilities, SessionRecord};
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::live::sessions::LiveSessionManager;

pub const GOAL_SET_EXT_METHOD: &str = "_anyharness/goal/set";
pub const GOAL_GET_EXT_METHOD: &str = "_anyharness/goal/get";
pub const GOAL_CLEAR_EXT_METHOD: &str = "_anyharness/goal/clear";

#[derive(Debug, thiserror::Error)]
pub enum GoalRuntimeError {
    #[error("session not found")]
    SessionNotFound,
    #[error("session agent does not support goals")]
    Unsupported,
    #[error("session is not running; goals require a live session")]
    SessionNotRunning,
    #[error("{0}")]
    InvalidRequest(String),
    #[error("goal ext method failed: {0}")]
    Ext(anyhow::Error),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct GoalRuntime {
    goal_service: Arc<GoalService>,
    session_service: Arc<SessionService>,
    acp_manager: LiveSessionManager,
    access_gate: Arc<WorkspaceAccessGate>,
}

impl GoalRuntime {
    pub fn new(
        goal_service: Arc<GoalService>,
        session_service: Arc<SessionService>,
        acp_manager: LiveSessionManager,
        access_gate: Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            goal_service,
            session_service,
            acp_manager,
            access_gate,
        }
    }

    pub fn goal_service(&self) -> &Arc<GoalService> {
        &self.goal_service
    }

    /// Set or edit the session goal. `objective` omitted = status/budget-only
    /// patch (codex semantics). The response's `goal` is the current mirror
    /// row; the write is authoritative only after the notification ingests.
    pub async fn set_goal(
        &self,
        session_id: &str,
        request: SetSessionGoalRequest,
    ) -> Result<SessionGoalResponse, GoalRuntimeError> {
        let session = self.session_for_mutation(session_id)?;
        let objective = request
            .objective
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if objective.is_none() && request.status.is_none() && request.token_budget.is_none() {
            return Err(GoalRuntimeError::InvalidRequest(
                "goal set requires an objective, status, or token budget".to_string(),
            ));
        }

        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or(GoalRuntimeError::SessionNotRunning)?;

        self.goal_service.record_write_intent(
            session_id,
            GoalWriteIntent {
                source_kind: "user".to_string(),
                source_run_id: None,
                max_turns: request.max_turns,
                max_wall_secs: request.max_wall_secs,
            },
        );

        let mut params = serde_json::Map::new();
        if let Some(objective) = objective {
            params.insert("objective".to_string(), objective.into());
        }
        if let Some(status) = request.status {
            let status = match status {
                GoalArmState::Active => "active",
                GoalArmState::Paused => "paused",
            };
            params.insert("status".to_string(), status.into());
        }
        if let Some(token_budget) = request.token_budget {
            params.insert("tokenBudget".to_string(), token_budget.into());
        }

        handle
            .call_agent_ext_method(GOAL_SET_EXT_METHOD, serde_json::Value::Object(params))
            .await
            .map_err(|error| GoalRuntimeError::Ext(anyhow::anyhow!("{error:?}")))?;

        self.mirror_response(&session)
    }

    /// Clear the session goal via the sidecar; the mirror transitions when
    /// the `goal_cleared` notification round-trips.
    pub async fn clear_goal(
        &self,
        session_id: &str,
    ) -> Result<SessionGoalResponse, GoalRuntimeError> {
        let session = self.session_for_mutation(session_id)?;
        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or(GoalRuntimeError::SessionNotRunning)?;
        handle
            .call_agent_ext_method(GOAL_CLEAR_EXT_METHOD, serde_json::json!({}))
            .await
            .map_err(|error| GoalRuntimeError::Ext(anyhow::anyhow!("{error:?}")))?;
        self.mirror_response(&session)
    }

    fn session_for_mutation(&self, session_id: &str) -> Result<SessionRecord, GoalRuntimeError> {
        let session = self
            .session_service
            .get_session(session_id)
            .map_err(GoalRuntimeError::Store)?
            .ok_or(GoalRuntimeError::SessionNotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| GoalRuntimeError::Store(anyhow::anyhow!(error.to_string())))?;
        let capabilities =
            parse_action_capabilities(session.action_capabilities_json.as_deref());
        if !capabilities.supports_goals {
            return Err(GoalRuntimeError::Unsupported);
        }
        Ok(session)
    }

    fn mirror_response(
        &self,
        session: &SessionRecord,
    ) -> Result<SessionGoalResponse, GoalRuntimeError> {
        let goal = self
            .goal_service
            .active_goal_for_session(&session.id)
            .map_err(GoalRuntimeError::Store)?;
        Ok(SessionGoalResponse {
            accepted: true,
            goal: goal.as_ref().map(goal_to_contract),
        })
    }
}
