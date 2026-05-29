use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyharness_contract::v1::{
    ConfigApplyState, PendingInteractionSummary, ProposedPlanDecisionState, SessionEventEnvelope,
    SessionExecutionPhase, SessionExecutionSummary,
};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};

pub use crate::live::sessions::actor::command::{
    ForkSessionCommandError, ForkSessionCommandResult, InteractionResolution, PromptAcceptError,
    PromptAcceptance, QueueMutationError, ResolveInteractionCommandError,
    SetConfigOptionCommandError,
};

use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::PlanDecisionError;
use crate::live::sessions::actor::command::SessionCommand;
use crate::observability::latency::LatencyRequestContext;
use crate::sessions::prompt::PromptPayload;
use crate::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};

#[derive(Debug)]
pub enum LiveSessionCommandError<E> {
    ActorUnavailable,
    ResponseDropped,
    Rejected(E),
}

fn anyhow_command_error(error: LiveSessionCommandError<anyhow::Error>) -> anyhow::Error {
    match error {
        LiveSessionCommandError::ActorUnavailable => {
            anyhow::anyhow!("session actor channel closed")
        }
        LiveSessionCommandError::ResponseDropped => {
            anyhow::anyhow!("session actor dropped command response")
        }
        LiveSessionCommandError::Rejected(error) => error,
    }
}

fn runtime_event_command_error(
    error: LiveSessionCommandError<RuntimeEventInjectionError>,
) -> RuntimeEventInjectionError {
    match error {
        LiveSessionCommandError::ActorUnavailable | LiveSessionCommandError::ResponseDropped => {
            RuntimeEventInjectionError::ActorUnavailable
        }
        LiveSessionCommandError::Rejected(error) => error,
    }
}

pub struct LiveSessionHandle {
    pub session_id: String,
    pub(in crate::live::sessions) command_tx: mpsc::Sender<SessionCommand>,
    pub(in crate::live::sessions) event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub(in crate::live::sessions) busy: Arc<AtomicBool>,
    pub(in crate::live::sessions) execution: Arc<RwLock<LiveSessionExecutionSnapshot>>,
    pub(in crate::live::sessions) native_session_id: Arc<std::sync::RwLock<Option<String>>>,
}

#[derive(Debug, Clone)]
pub struct LiveSessionExecutionSnapshot {
    pub phase: SessionExecutionPhase,
    pub pending_interactions: Vec<PendingInteractionSummary>,
    pub updated_at: String,
}

impl LiveSessionExecutionSnapshot {
    pub fn new(phase: SessionExecutionPhase) -> Self {
        Self {
            phase,
            pending_interactions: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn to_contract_summary(&self, has_live_handle: bool) -> SessionExecutionSummary {
        SessionExecutionSummary {
            phase: self.phase.clone(),
            has_live_handle,
            pending_interactions: self.pending_interactions.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

impl LiveSessionHandle {
    pub(in crate::live::sessions) fn new(
        session_id: impl Into<String>,
        command_tx: mpsc::Sender<SessionCommand>,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        native_session_id: Option<String>,
        phase: SessionExecutionPhase,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            command_tx,
            event_tx,
            busy: Arc::new(AtomicBool::new(false)),
            execution: Arc::new(RwLock::new(LiveSessionExecutionSnapshot::new(phase))),
            native_session_id: Arc::new(std::sync::RwLock::new(native_session_id)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEventEnvelope> {
        self.event_tx.subscribe()
    }

    pub(in crate::live::sessions) fn try_begin_prompt(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }

    pub(in crate::live::sessions) fn set_busy(&self, busy: bool) {
        self.busy.store(busy, Ordering::Release);
    }

    pub(in crate::live::sessions) fn finish_prompt(&self) {
        self.set_busy(false);
    }

    pub async fn set_execution_phase(&self, phase: SessionExecutionPhase) {
        let mut execution = self.execution.write().await;
        execution.phase = phase;
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn add_pending_interaction(&self, pending_interaction: PendingInteractionSummary) {
        let mut execution = self.execution.write().await;
        execution.phase = SessionExecutionPhase::AwaitingInteraction;
        execution
            .pending_interactions
            .retain(|pending| pending.request_id != pending_interaction.request_id);
        execution.pending_interactions.push(pending_interaction);
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn link_pending_interaction_to_plan(&self, request_id: &str, plan_id: &str) {
        let mut execution = self.execution.write().await;
        let Some(pending) = execution
            .pending_interactions
            .iter_mut()
            .find(|pending| pending.request_id == request_id)
        else {
            return;
        };
        pending.source.linked_plan_id = Some(plan_id.to_string());
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn remove_pending_interaction(&self, request_id: &str) {
        let mut execution = self.execution.write().await;
        execution
            .pending_interactions
            .retain(|pending| pending.request_id != request_id);
        if execution.pending_interactions.is_empty()
            && matches!(execution.phase, SessionExecutionPhase::AwaitingInteraction)
        {
            execution.phase = SessionExecutionPhase::Running;
        }
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn clear_pending_interactions_for_terminal_state(
        &self,
        phase: SessionExecutionPhase,
    ) {
        let mut execution = self.execution.write().await;
        execution.phase = phase;
        execution.pending_interactions.clear();
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub async fn mark_activity_at(&self, updated_at: String) {
        let mut execution = self.execution.write().await;
        execution.updated_at = updated_at;
    }

    pub async fn execution_snapshot(&self) -> LiveSessionExecutionSnapshot {
        self.execution.read().await.clone()
    }

    async fn send_request<T, E>(
        &self,
        build: impl FnOnce(oneshot::Sender<Result<T, E>>) -> SessionCommand,
    ) -> Result<T, LiveSessionCommandError<E>> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(build(tx))
            .await
            .map_err(|_| LiveSessionCommandError::ActorUnavailable)?;
        rx.await
            .map_err(|_| LiveSessionCommandError::ResponseDropped)?
            .map_err(LiveSessionCommandError::Rejected)
    }

    async fn send_prompt_with_queue_marker(
        &self,
        payload: PromptPayload,
        prompt_id: Option<String>,
        latency: Option<LatencyRequestContext>,
        from_queue_seq: Option<i64>,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_request(|respond_to| SessionCommand::Prompt {
            payload,
            prompt_id,
            latency,
            from_queue_seq,
            respond_to,
        })
        .await
    }

    pub async fn send_prompt(
        &self,
        payload: PromptPayload,
        prompt_id: Option<String>,
        latency: Option<LatencyRequestContext>,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_prompt_with_queue_marker(payload, prompt_id, latency, None)
            .await
    }

    pub async fn send_queued_prompt(
        &self,
        payload: PromptPayload,
        seq: i64,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_prompt_with_queue_marker(payload, None, None, Some(seq))
            .await
    }

    pub async fn edit_pending_prompt(
        &self,
        seq: i64,
        payload: PromptPayload,
    ) -> Result<(), LiveSessionCommandError<QueueMutationError>> {
        self.send_request(|respond_to| SessionCommand::EditPendingPrompt {
            seq,
            payload,
            respond_to,
        })
        .await
    }

    pub async fn delete_pending_prompt(
        &self,
        seq: i64,
    ) -> Result<(), LiveSessionCommandError<QueueMutationError>> {
        self.send_request(|respond_to| SessionCommand::DeletePendingPrompt { seq, respond_to })
            .await
    }

    pub async fn set_config_option(
        &self,
        config_id: String,
        value: String,
    ) -> Result<ConfigApplyState, LiveSessionCommandError<SetConfigOptionCommandError>> {
        self.send_request(|respond_to| SessionCommand::SetConfigOption {
            config_id,
            value,
            respond_to,
        })
        .await
    }

    pub async fn resolve_interaction(
        &self,
        request_id: String,
        resolution: InteractionResolution,
    ) -> Result<(), ResolveInteractionCommandError> {
        self.send_request(|respond_to| SessionCommand::ResolveInteraction {
            request_id,
            resolution,
            respond_to,
        })
        .await
        .map_err(|error| match error {
            LiveSessionCommandError::ActorUnavailable
            | LiveSessionCommandError::ResponseDropped => ResolveInteractionCommandError::ActorDead,
            LiveSessionCommandError::Rejected(error) => error,
        })
    }

    pub async fn apply_plan_decision(
        &self,
        plan_id: String,
        expected_version: i64,
        decision: ProposedPlanDecisionState,
    ) -> Result<PlanRecord, LiveSessionCommandError<PlanDecisionError>> {
        self.send_request(|respond_to| SessionCommand::ApplyPlanDecision {
            plan_id,
            expected_version,
            decision,
            respond_to,
        })
        .await
    }

    pub async fn verify_fork_ready(
        &self,
    ) -> Result<(), LiveSessionCommandError<ForkSessionCommandError>> {
        self.send_request(|respond_to| SessionCommand::VerifyForkReady { respond_to })
            .await
    }

    pub async fn fork(
        &self,
    ) -> Result<ForkSessionCommandResult, LiveSessionCommandError<ForkSessionCommandError>> {
        self.send_request(|respond_to| SessionCommand::Fork { respond_to })
            .await
    }

    pub async fn close_native_session(&self, native_session_id: String) -> anyhow::Result<()> {
        self.send_request(|respond_to| SessionCommand::CloseNativeSession {
            native_session_id,
            respond_to,
        })
        .await
        .map_err(anyhow_command_error)
    }

    pub async fn inject_runtime_event(
        &self,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        self.send_request(|respond_to| SessionCommand::InjectRuntimeEvent { event, respond_to })
            .await
            .map_err(runtime_event_command_error)
    }

    pub async fn cancel(&self) -> bool {
        self.command_tx.send(SessionCommand::Cancel).await.is_ok()
    }

    pub async fn dismiss(&self) -> anyhow::Result<()> {
        self.send_request(|respond_to| SessionCommand::Dismiss { respond_to })
            .await
            .map_err(anyhow_command_error)
    }

    pub async fn close(&self) -> anyhow::Result<()> {
        self.send_request(|respond_to| SessionCommand::Close { respond_to })
            .await
            .map_err(anyhow_command_error)
    }

    pub async fn replay_advance(&self) -> Result<(), LiveSessionCommandError<anyhow::Error>> {
        self.send_request(|respond_to| SessionCommand::ReplayAdvance { respond_to })
            .await
    }

    pub fn native_session_id(&self) -> Option<String> {
        self.native_session_id
            .read()
            .expect("native session id lock poisoned")
            .clone()
    }

    #[cfg(test)]
    pub(in crate::live::sessions) fn new_for_test(
        session_id: impl Into<String>,
        command_tx: mpsc::Sender<SessionCommand>,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        native_session_id: Option<String>,
        phase: SessionExecutionPhase,
    ) -> Self {
        Self::new(session_id, command_tx, event_tx, native_session_id, phase)
    }
}
