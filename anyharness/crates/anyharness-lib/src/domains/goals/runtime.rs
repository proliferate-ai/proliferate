//! External goal mutations and the attach-time reconcile pull.
//!
//! Goals are strict mirrors of native harness state: every mutation here goes
//! through the sidecar's `_anyharness/goal/*` ext methods and is confirmed
//! ONLY when the resulting native notification round-trips through
//! [`GoalSessionObserver`](super::session_observer::GoalSessionObserver). The
//! only local write before that round-trip is the thin
//! [`GoalPendingOp`] marker — never a status transition.

use std::any::Any;
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{Goal, GoalArmState, SetSessionGoalRequest};
use tokio::sync::broadcast;

use super::model::GoalPendingOp;
use super::service::{GoalEventContext, GoalService, MAX_GOAL_OBJECTIVE_BYTES};
use super::wire::{
    GoalClearedWireResult, GoalWire, GoalWireEnvelope, GOAL_CLEAR_EXT_METHOD, GOAL_GET_EXT_METHOD,
    GOAL_SET_EXT_METHOD,
};
use crate::domains::sessions::model::{parse_action_capabilities, SessionRecord};
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::live::sessions::model::{
    SessionDomainOp, SessionObserverContext, SessionOpEmitter, SessionOpStep,
};
use crate::live::sessions::{LiveSessionCommandError, LiveSessionHandle, LiveSessionManager};

/// How long a mutation waits for its native notification to round-trip
/// before reporting the write unconfirmed (claude confirmations ride the
/// adapter's transcript tail, which can lag the ext-method response).
const GOAL_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum GoalOpError {
    #[error("session not found")]
    SessionNotFound,
    #[error("agent does not support goals")]
    Unsupported,
    #[error("session is not running")]
    SessionNotLive,
    #[error("goal objective is empty")]
    EmptyObjective,
    #[error("goal objective exceeds {MAX_GOAL_OBJECTIVE_BYTES} bytes")]
    ObjectiveTooLarge,
    #[error("goal mutation was accepted but the native confirmation did not arrive")]
    NotConfirmed,
    #[error("agent rejected goal operation: {0}")]
    Rejected(String),
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

    /// Create-or-patch the session goal through the native mechanism
    /// (`_anyharness/goal/set`). Returns the mirror state after the native
    /// notification round-trips; no optimistic transition happens on the way.
    pub async fn set_goal(
        &self,
        session_id: &str,
        request: SetSessionGoalRequest,
    ) -> Result<Goal, GoalOpError> {
        let objective = match request.objective.as_deref().map(str::trim) {
            Some("") => return Err(GoalOpError::EmptyObjective),
            Some(objective) if objective.len() > MAX_GOAL_OBJECTIVE_BYTES => {
                return Err(GoalOpError::ObjectiveTooLarge)
            }
            Some(objective) => Some(objective.to_string()),
            None => None,
        };
        let (_session, handle, native_session_id) = self.goal_session(session_id).await?;

        let mut params = serde_json::Map::new();
        params.insert(
            "sessionId".to_string(),
            serde_json::Value::String(native_session_id),
        );
        if let Some(objective) = objective {
            params.insert("objective".to_string(), serde_json::Value::String(objective));
        }
        if let Some(status) = request.status {
            let status = match status {
                GoalArmState::Active => "active",
                GoalArmState::Paused => "paused",
            };
            params.insert(
                "status".to_string(),
                serde_json::Value::String(status.to_string()),
            );
        }
        if let Some(token_budget) = request.token_budget {
            params.insert("tokenBudget".to_string(), serde_json::json!(token_budget));
        }

        self.goal_service.mark_pending(session_id, GoalPendingOp::Set)?;
        let mut events = handle.subscribe();
        let response = match handle
            .call_agent_ext_method(
                GOAL_SET_EXT_METHOD.to_string(),
                serde_json::Value::Object(params),
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let _ = self.goal_service.clear_pending(session_id);
                return Err(map_ext_call_error(error));
            }
        };
        // The response is the sidecar's confirmation that the NATIVE write
        // landed; the mirror still transitions only via the notification.
        if let Err(error) = serde_json::from_value::<GoalWireEnvelope>(response) {
            tracing::warn!(
                session_id,
                error = %error,
                "goal/set returned an unexpected result shape"
            );
        }

        let confirmed = wait_for_goal_event(
            &mut events,
            &["goal_updated", "goal_met", "goal_cleared"],
        )
        .await;
        if !confirmed {
            let _ = self.goal_service.clear_pending(session_id);
            return Err(GoalOpError::NotConfirmed);
        }
        self.goal_service
            .current_goal(session_id)?
            .map(|goal| goal.to_contract())
            .ok_or(GoalOpError::NotConfirmed)
    }

    /// Clear the session goal through the native mechanism
    /// (`_anyharness/goal/clear`). Returns whether a native goal was cleared.
    pub async fn clear_goal(&self, session_id: &str) -> Result<bool, GoalOpError> {
        let (_session, handle, native_session_id) = self.goal_session(session_id).await?;

        self.goal_service
            .mark_pending(session_id, GoalPendingOp::Clear)?;
        let mut events = handle.subscribe();
        let response = match handle
            .call_agent_ext_method(
                GOAL_CLEAR_EXT_METHOD.to_string(),
                serde_json::json!({ "sessionId": native_session_id }),
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let _ = self.goal_service.clear_pending(session_id);
                return Err(map_ext_call_error(error));
            }
        };
        let result: GoalClearedWireResult =
            serde_json::from_value(response).unwrap_or(GoalClearedWireResult { cleared: false });

        if !result.cleared {
            // The harness had no goal to clear; heal any drifted mirror from
            // that authoritative native read instead of writing locally.
            self.reconcile_with_handle(&handle, None).await?;
            let _ = self.goal_service.clear_pending(session_id);
            return Ok(false);
        }

        let confirmed = wait_for_goal_event(&mut events, &["goal_cleared"]).await;
        if !confirmed {
            let _ = self.goal_service.clear_pending(session_id);
            return Err(GoalOpError::NotConfirmed);
        }
        Ok(true)
    }

    /// Attach/resume reconcile: pull the native goal state
    /// (`_anyharness/goal/get`) and heal the mirror under the session's sink
    /// lock. Quietly a no-op for sessions whose agent does not advertise
    /// goal support.
    pub async fn reconcile_on_attach(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(session) = self.session_service.get_session(session_id)? else {
            return Ok(());
        };
        if !parse_action_capabilities(session.action_capabilities_json.as_deref()).supports_goals {
            return Ok(());
        }
        let Some(handle) = self.acp_manager.get_handle(session_id).await else {
            return Ok(());
        };
        let Some(native_session_id) = handle.native_session_id() else {
            return Ok(());
        };

        let response = match handle
            .call_agent_ext_method(
                GOAL_GET_EXT_METHOD.to_string(),
                serde_json::json!({ "sessionId": native_session_id }),
            )
            .await
        {
            Ok(response) => response,
            Err(error) => {
                tracing::debug!(
                    session_id,
                    error = ?error,
                    "goal/get reconcile pull failed; leaving mirror untouched"
                );
                return Ok(());
            }
        };
        let envelope: GoalWireEnvelope = match serde_json::from_value(response) {
            Ok(envelope) => envelope,
            Err(error) => {
                tracing::warn!(
                    session_id,
                    error = %error,
                    "goal/get returned an unexpected result shape"
                );
                return Ok(());
            }
        };
        self.reconcile_with_handle(&handle, envelope.goal).await
    }

    async fn reconcile_with_handle(
        &self,
        handle: &Arc<LiveSessionHandle>,
        wire: Option<GoalWire>,
    ) -> anyhow::Result<()> {
        let op = Box::new(GoalReconcileOp {
            goal_service: self.goal_service.clone(),
            wire,
        });
        let reply = handle.run_domain_op(op).await.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                anyhow::anyhow!("session actor is not available for goal reconcile")
            }
            LiveSessionCommandError::ResponseDropped => {
                anyhow::anyhow!("session actor dropped goal reconcile response")
            }
            LiveSessionCommandError::Rejected(infallible) => match infallible {},
        })?;
        let output = reply.downcast::<GoalReconcileOpOutput>().map_err(|_| {
            anyhow::anyhow!("goal reconcile op returned an unexpected reply type")
        })?;
        output.result
    }

    async fn goal_session(
        &self,
        session_id: &str,
    ) -> Result<(SessionRecord, Arc<LiveSessionHandle>, String), GoalOpError> {
        let session = self
            .session_service
            .get_session(session_id)?
            .ok_or(GoalOpError::SessionNotFound)?;
        self.access_gate
            .assert_can_mutate_for_session(session_id)
            .map_err(|error| GoalOpError::Store(anyhow::anyhow!(error.to_string())))?;
        if !parse_action_capabilities(session.action_capabilities_json.as_deref()).supports_goals {
            return Err(GoalOpError::Unsupported);
        }
        let handle = self
            .acp_manager
            .get_handle(session_id)
            .await
            .ok_or(GoalOpError::SessionNotLive)?;
        let native_session_id = handle
            .native_session_id()
            .ok_or(GoalOpError::SessionNotLive)?;
        Ok((session, handle, native_session_id))
    }
}

fn map_ext_call_error(error: LiveSessionCommandError<anyhow::Error>) -> GoalOpError {
    match error {
        LiveSessionCommandError::ActorUnavailable | LiveSessionCommandError::ResponseDropped => {
            GoalOpError::SessionNotLive
        }
        LiveSessionCommandError::Rejected(error) => GoalOpError::Rejected(error.to_string()),
    }
}

/// Waits for the observer-ingested confirmation event on the session's
/// broadcast channel. Returns `false` on timeout or a closed channel.
async fn wait_for_goal_event(
    events: &mut broadcast::Receiver<anyharness_contract::v1::SessionEventEnvelope>,
    event_types: &[&str],
) -> bool {
    let deadline = tokio::time::Instant::now() + GOAL_CONFIRMATION_TIMEOUT;
    loop {
        let recv = tokio::time::timeout_at(deadline, events.recv()).await;
        match recv {
            Ok(Ok(envelope)) => {
                if event_types.contains(&envelope.event.event_type()) {
                    return true;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return false,
            Err(_) => return false,
        }
    }
}

/// The `Box<dyn Any + Send>` produced by [`GoalReconcileOp`] downcasts to
/// this.
struct GoalReconcileOpOutput {
    result: anyhow::Result<()>,
}

/// Heals the goal mirror from an authoritative native read, under the sink
/// lock so the emitted envelopes ride the session's ordered event stream.
///
/// # Partial-failure contract
///
/// [`GoalService::reconcile_native_state`] persists the goal row and its
/// event rows in one transaction and returns every committed envelope; the
/// op publishes exactly that set.
struct GoalReconcileOp {
    goal_service: Arc<GoalService>,
    wire: Option<GoalWire>,
}

impl SessionDomainOp for GoalReconcileOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let GoalReconcileOp { goal_service, wire } = *self;
        let context = goal_event_context(&emitter.event_ctx());
        let result = match goal_service.reconcile_native_state(context, wire) {
            Ok(batch) => {
                emitter.publish(batch.envelopes);
                Ok(())
            }
            Err(error) => Err(anyhow::anyhow!(error.to_string())),
        };
        SessionOpStep::Done(Box::new(GoalReconcileOpOutput { result }) as Box<dyn Any + Send>)
    }
}

fn goal_event_context(ctx: &SessionObserverContext) -> GoalEventContext {
    GoalEventContext {
        workspace_id: ctx.workspace_id.clone(),
        session_id: ctx.session_id.clone(),
        source_agent_kind: ctx.agent_kind.clone(),
        turn_id: ctx.turn_id.clone(),
        next_seq: ctx.next_seq,
    }
}
