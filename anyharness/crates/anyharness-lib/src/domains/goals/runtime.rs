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

use anyharness_contract::v1::{
    Goal, GoalArmState, SessionEvent, SessionEventEnvelope, SetSessionGoalRequest,
};
use tokio::sync::broadcast;

use super::model::{GoalFailReason, GoalGuardDecision, GoalPendingOp};
use super::service::{GoalArming, GoalEventContext, GoalService, MAX_GOAL_OBJECTIVE_BYTES};
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
use crate::live::sessions::{
    AgentExtMethodError, LiveSessionCommandError, LiveSessionHandle, LiveSessionManager,
};

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
    #[error("agent could not service the goal operation: {0}")]
    AgentUnavailable(String),
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
        if let Some(objective) = objective.clone() {
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

        // Correlate the confirmation to THIS write by objective (when one was
        // provided): a stale accounting goal_updated for a still-active OLD
        // goal must not prematurely confirm an edit to a new objective and
        // hand back the pre-edit mirror. Status/budget-only patches carry no
        // objective and fall back to matching on event type alone.
        let confirmed = wait_for_goal_event(
            &mut events,
            &["goal_updated", "goal_met", "goal_cleared"],
            objective.as_deref(),
        )
        .await;
        if !confirmed {
            let _ = self.goal_service.clear_pending(session_id);
            return Err(GoalOpError::NotConfirmed);
        }
        // Stamp anyharness-side caps + provenance onto the freshly-mirrored row.
        // These never went to the sidecar (caps are runtime-enforced; provenance
        // is not a native concept); they are augmentation preserved across
        // subsequent native updates.
        let arming = GoalArming {
            source_kind: request.source_kind,
            source_run_id: request.source_run_id.clone(),
            max_turns: request.max_turns,
            max_wall_secs: request.max_wall_secs,
        };
        self.goal_service.stamp_arming(session_id, arming)?;
        self.goal_service
            .current_goal(session_id)?
            .map(|goal| goal.to_contract())
            .ok_or(GoalOpError::NotConfirmed)
    }

    /// Cap-guard entrypoint (called off [`GoalGuardExtension::on_turn_finished`]
    /// via a spawned task): count this finished turn against the session's
    /// active goal and, on a cap breach, fail the goal and stop the native loop.
    pub async fn evaluate_turn_caps(&self, session_id: &str) -> anyhow::Result<()> {
        let Some(GoalGuardDecision::Breached(reason)) = self.goal_service.record_turn(session_id)?
        else {
            return Ok(());
        };
        self.enforce_cap_breach(session_id, reason).await
    }

    /// Fails the active goal for a breached cap and best-effort clears the
    /// native goal so the harness stops pursuing it (and burning turns/tokens).
    /// The mirror is failed FIRST so the native clear's own `goal_cleared` echo
    /// lands on a terminal head and no-ops — the `failed` result is sticky.
    async fn enforce_cap_breach(
        &self,
        session_id: &str,
        reason: GoalFailReason,
    ) -> anyhow::Result<()> {
        // The guard only fires for live sessions, but the actor can retire
        // between the turn ending and this async hop; a missing handle means
        // there is nothing left to enforce.
        let Some(handle) = self.acp_manager.get_handle(session_id).await else {
            return Ok(());
        };
        self.fail_goal_with_handle(&handle, reason).await?;
        if let Some(native_session_id) = handle.native_session_id() {
            if let Err(error) = handle
                .call_agent_ext_method(
                    GOAL_CLEAR_EXT_METHOD.to_string(),
                    serde_json::json!({ "sessionId": native_session_id }),
                )
                .await
            {
                tracing::debug!(
                    session_id,
                    reason = reason.as_str(),
                    error = ?error,
                    "cap-guard native clear failed; mirror already marked failed"
                );
            }
        }
        Ok(())
    }

    async fn fail_goal_with_handle(
        &self,
        handle: &Arc<LiveSessionHandle>,
        reason: GoalFailReason,
    ) -> anyhow::Result<()> {
        let op = Box::new(GoalFailOp {
            goal_service: self.goal_service.clone(),
            reason,
        });
        let reply = handle.run_domain_op(op).await.map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable => {
                anyhow::anyhow!("session actor is not available for goal cap enforcement")
            }
            LiveSessionCommandError::ResponseDropped => {
                anyhow::anyhow!("session actor dropped goal cap enforcement response")
            }
            LiveSessionCommandError::Rejected(infallible) => match infallible {},
        })?;
        let output = reply
            .downcast::<GoalFailOpOutput>()
            .map_err(|_| anyhow::anyhow!("goal fail op returned an unexpected reply type"))?;
        output.result
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

        let confirmed = wait_for_goal_event(&mut events, &["goal_cleared"], None).await;
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
        LiveSessionCommandError::Rejected(error) => {
            // A hung sidecar or a sidecar-internal error is a server-side
            // failure, not a client rejection — surface it as unavailable
            // (5xx) rather than a 400 so retry/alerting can tell them apart.
            match error.downcast_ref::<AgentExtMethodError>() {
                Some(ext_error) if ext_error.is_agent_unavailable() => {
                    GoalOpError::AgentUnavailable(error.to_string())
                }
                _ => GoalOpError::Rejected(error.to_string()),
            }
        }
    }
}

/// Waits for the observer-ingested confirmation of this mutation on the
/// session's broadcast channel. Returns `false` on timeout or a closed
/// channel. When `expected_objective` is set only an envelope whose goal
/// carries that objective confirms, so an unrelated goal event cannot resolve
/// the wait against a stale mirror.
async fn wait_for_goal_event(
    events: &mut broadcast::Receiver<SessionEventEnvelope>,
    event_types: &[&str],
    expected_objective: Option<&str>,
) -> bool {
    let deadline = tokio::time::Instant::now() + GOAL_CONFIRMATION_TIMEOUT;
    loop {
        let recv = tokio::time::timeout_at(deadline, events.recv()).await;
        match recv {
            Ok(Ok(envelope)) => {
                if goal_event_matches(&envelope, event_types, expected_objective) {
                    return true;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) => return false,
            Err(_) => return false,
        }
    }
}

/// The confirming envelope must be one of the accepted goal event types and,
/// when correlating a set with a known objective, carry that objective.
fn goal_event_matches(
    envelope: &SessionEventEnvelope,
    event_types: &[&str],
    expected_objective: Option<&str>,
) -> bool {
    if !event_types.contains(&envelope.event.event_type()) {
        return false;
    }
    match expected_objective {
        None => true,
        Some(objective) => goal_event_objective(&envelope.event) == Some(objective),
    }
}

fn goal_event_objective(event: &SessionEvent) -> Option<&str> {
    match event {
        SessionEvent::GoalUpdated(payload) => Some(payload.goal.objective.as_str()),
        SessionEvent::GoalMet(payload) => Some(payload.goal.objective.as_str()),
        SessionEvent::GoalCleared(payload) => Some(payload.goal.objective.as_str()),
        _ => None,
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

/// The `Box<dyn Any + Send>` produced by [`GoalFailOp`] downcasts to this.
struct GoalFailOpOutput {
    result: anyhow::Result<()>,
}

/// Fails the active goal for a breached runtime cap under the sink lock, so the
/// emitted `goal_updated(failed)` rides the session's ordered event stream with
/// a correct seq (cf. [`GoalReconcileOp`]).
struct GoalFailOp {
    goal_service: Arc<GoalService>,
    reason: GoalFailReason,
}

impl SessionDomainOp for GoalFailOp {
    fn begin(self: Box<Self>, emitter: &mut SessionOpEmitter<'_>) -> SessionOpStep {
        let GoalFailOp {
            goal_service,
            reason,
        } = *self;
        let context = goal_event_context(&emitter.event_ctx());
        let result = match goal_service.fail_current_goal(context, reason) {
            Ok(batch) => {
                emitter.publish(batch.envelopes);
                Ok(())
            }
            Err(error) => Err(error),
        };
        SessionOpStep::Done(Box::new(GoalFailOpOutput { result }) as Box<dyn Any + Send>)
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

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::{Goal, GoalSourceKind, GoalStatus, GoalUpdatedPayload};

    const GOAL_EVENT_TYPES: &[&str] = &["goal_updated", "goal_met", "goal_cleared"];

    fn goal_updated_envelope(objective: &str) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: "session-1".to_string(),
            seq: 1,
            timestamp: "now".to_string(),
            turn_id: None,
            item_id: None,
            event: SessionEvent::GoalUpdated(GoalUpdatedPayload {
                goal: Goal {
                    objective: objective.to_string(),
                    status: GoalStatus::Active,
                    native_status: None,
                    token_budget: None,
                    max_turns: None,
                    max_wall_secs: None,
                    tokens_used: None,
                    time_used_seconds: None,
                    met_reason: None,
                    failed_reason: None,
                    iterations: None,
                    source_kind: GoalSourceKind::User,
                    source_run_id: None,
                    native: true,
                    revision: 1,
                    created_at: "now".to_string(),
                    updated_at: "now".to_string(),
                },
            }),
        }
    }

    #[test]
    fn uncorrelated_match_accepts_any_goal_event_type() {
        let envelope = goal_updated_envelope("old objective");
        assert!(goal_event_matches(&envelope, GOAL_EVENT_TYPES, None));
        assert!(!goal_event_matches(&envelope, &["goal_cleared"], None));
    }

    #[test]
    fn objective_correlation_skips_unrelated_goal_events() {
        let stale = goal_updated_envelope("old objective");
        let fresh = goal_updated_envelope("new objective");
        // A stale accounting echo for the old objective must NOT confirm an
        // edit to a new objective; only the edit's own echo does.
        assert!(!goal_event_matches(&stale, GOAL_EVENT_TYPES, Some("new objective")));
        assert!(goal_event_matches(&fresh, GOAL_EVENT_TYPES, Some("new objective")));
    }
}
