use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyharness_contract::v1::{
    ConfigApplyState, PendingInteractionSummary, SessionEventEnvelope, SessionExecutionPhase,
    SessionExecutionSummary,
};
use tokio::sync::{broadcast, mpsc, oneshot, Notify, RwLock};

pub use crate::live::sessions::actor::command::{
    ConditionalCancelOutcome, ForkSessionCommandError, ForkSessionCommandResult, PromptAcceptError,
    PromptAcceptance, QueueMutationError, Resolution, ResolveInteractionCommandError,
    SetConfigOptionCommandError, SidedoorForkCommandError, SidedoorForkCommandResult,
};

use crate::domains::sessions::prompt::PromptPayload;
use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionError, RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::live::sessions::actor::command::{ConditionalUnloadOutcome, SessionCommand};
mod fork;
mod sidedoor;
#[derive(Debug)]
pub enum LiveSessionCommandError<E> {
    ActorUnavailable,
    ResponseDropped,
    Rejected(E),
}

/// Classification of an ACP ext-method failure, preserved through the
/// `anyhow::Error` the actor returns so callers can tell a server-side failure
/// (the sidecar never answered, or returned an internal error) apart from a
/// client-side rejection (invalid params) and map it to the right HTTP status
/// instead of folding everything into a 400.
#[derive(Debug, thiserror::Error)]
pub enum AgentExtMethodError {
    /// The sidecar did not answer within the actor's ext-method deadline.
    #[error("agent did not answer {method} within {timeout_secs}s")]
    Timeout { method: String, timeout_secs: u64 },
    /// The sidecar answered with a JSON-RPC error. `code` is the JSON-RPC
    /// error code (e.g. -32602 invalid params, -32603 internal error).
    #[error("agent ext-method {method} failed ({code}): {message}")]
    Rpc {
        method: String,
        code: i32,
        message: String,
    },
}

impl AgentExtMethodError {
    /// True when the failure is server-side (the agent hung, or reported an
    /// internal error) rather than a client-side rejection — the caller should
    /// surface a 5xx/unavailable, not a 400.
    pub fn is_agent_unavailable(&self) -> bool {
        match self {
            Self::Timeout { .. } => true,
            // JSON-RPC internal error (-32603). Invalid params (-32602) and the
            // rest stay client rejections.
            Self::Rpc { code, .. } => *code == -32603,
        }
    }
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
    /// The vault seat id this actor's launch serves (`SessionLaunch::
    /// serving_seat_id`, never token material). `None` for non-seat routes
    /// and replay actors. Immutable for the actor's lifetime — the read path
    /// threads it onto the wire `Session` (slice 7 data enabler 2).
    pub serving_seat_id: Option<String>,
    pub(in crate::live::sessions) command_tx: mpsc::Sender<SessionCommand>,
    pub(in crate::live::sessions) event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub(in crate::live::sessions) busy: Arc<AtomicBool>,
    pub(in crate::live::sessions) execution: Arc<RwLock<LiveSessionExecutionSnapshot>>,
    pub(in crate::live::sessions) native_session_id: Arc<std::sync::RwLock<Option<String>>>,
    event_sequence: Arc<ActorLifecycleSignal>,
    actor_finished: Arc<ActorLifecycleSignal>,
}

#[derive(Default)]
struct ActorLifecycleSignal {
    completed: AtomicBool,
    notify: Notify,
}

impl ActorLifecycleSignal {
    fn complete(&self) {
        if !self.completed.swap(true, Ordering::AcqRel) {
            self.notify.notify_waiters();
        }
    }

    async fn wait(&self) {
        loop {
            if self.completed.load(Ordering::Acquire) {
                return;
            }
            let notified = self.notify.notified();
            if self.completed.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

pub(in crate::live::sessions) struct ActorLifecycleReleaser {
    signal: Arc<ActorLifecycleSignal>,
}

impl Drop for ActorLifecycleReleaser {
    fn drop(&mut self) {
        self.signal.complete();
    }
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
        serving_seat_id: Option<String>,
        command_tx: mpsc::Sender<SessionCommand>,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        native_session_id: Option<String>,
        phase: SessionExecutionPhase,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            serving_seat_id,
            command_tx,
            event_tx,
            busy: Arc::new(AtomicBool::new(false)),
            execution: Arc::new(RwLock::new(LiveSessionExecutionSnapshot::new(phase))),
            native_session_id: Arc::new(std::sync::RwLock::new(native_session_id)),
            event_sequence: Arc::new(ActorLifecycleSignal::default()),
            actor_finished: Arc::new(ActorLifecycleSignal::default()),
        }
    }

    pub(in crate::live::sessions) fn event_sequence_releaser(&self) -> ActorLifecycleReleaser {
        ActorLifecycleReleaser {
            signal: self.event_sequence.clone(),
        }
    }

    pub(in crate::live::sessions) fn actor_finished_releaser(&self) -> ActorLifecycleReleaser {
        ActorLifecycleReleaser {
            signal: self.actor_finished.clone(),
        }
    }

    pub(in crate::live::sessions) fn relinquish_event_sequence(&self) {
        self.event_sequence.complete();
    }

    pub(in crate::live::sessions) async fn wait_for_event_sequence_relinquishment(&self) {
        self.event_sequence.wait().await;
    }

    pub(in crate::live::sessions) async fn wait_until_actor_finished(&self) {
        self.actor_finished.wait().await;
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SessionEventEnvelope> {
        self.event_tx.subscribe()
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

    pub(in crate::live::sessions) async fn set_execution_phase(
        &self,
        phase: SessionExecutionPhase,
    ) {
        let mut execution = self.execution.write().await;
        execution.phase = phase;
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub(in crate::live::sessions) async fn add_pending_interaction(
        &self,
        pending_interaction: PendingInteractionSummary,
    ) {
        let mut execution = self.execution.write().await;
        execution.phase = SessionExecutionPhase::AwaitingInteraction;
        execution
            .pending_interactions
            .retain(|pending| pending.request_id != pending_interaction.request_id);
        execution.pending_interactions.push(pending_interaction);
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    /// Mirror a plan linkage into the pending-interaction snapshot. Safe to
    /// call after resolution (no-op when the interaction is gone); used by
    /// the plans runtime after a decision op reports a (re)link.
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

    pub(in crate::live::sessions) async fn remove_pending_interaction(&self, request_id: &str) {
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

    pub(in crate::live::sessions) async fn clear_pending_interactions_for_terminal_state(
        &self,
        phase: SessionExecutionPhase,
    ) {
        let mut execution = self.execution.write().await;
        execution.phase = phase;
        execution.pending_interactions.clear();
        execution.updated_at = chrono::Utc::now().to_rfc3339();
    }

    pub(in crate::live::sessions) async fn mark_activity_at(&self, updated_at: String) {
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
        from_queue_seq: Option<i64>,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_request(|respond_to| SessionCommand::Prompt {
            payload,
            prompt_id,
            from_queue_seq,
            respond_to,
        })
        .await
    }

    pub async fn send_prompt(
        &self,
        payload: PromptPayload,
        prompt_id: Option<String>,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_prompt_with_queue_marker(payload, prompt_id, None)
            .await
    }

    pub async fn send_queued_prompt(
        &self,
        payload: PromptPayload,
        seq: i64,
    ) -> Result<PromptAcceptance, LiveSessionCommandError<PromptAcceptError>> {
        self.send_prompt_with_queue_marker(payload, None, Some(seq))
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

    pub async fn reorder_pending_prompts(
        &self,
        expected_seqs: Vec<i64>,
        desired_seqs: Vec<i64>,
    ) -> Result<(), LiveSessionCommandError<QueueMutationError>> {
        self.send_request(|respond_to| SessionCommand::ReorderPendingPrompts {
            expected_seqs,
            desired_seqs,
            respond_to,
        })
        .await
    }

    pub async fn steer_pending_prompt(
        &self,
        seq: i64,
    ) -> Result<(), LiveSessionCommandError<QueueMutationError>> {
        self.send_request(|respond_to| SessionCommand::SteerPendingPrompt { seq, respond_to })
            .await
    }

    pub async fn set_config_option(
        &self,
        config_id: String,
        value: String,
        live_snapshot_authorized_model: bool,
    ) -> Result<ConfigApplyState, LiveSessionCommandError<SetConfigOptionCommandError>> {
        self.send_request(|respond_to| SessionCommand::SetConfigOption {
            config_id,
            value,
            live_snapshot_authorized_model,
            respond_to,
        })
        .await
    }

    pub async fn resolve_interaction(
        &self,
        request_id: String,
        resolution: Resolution,
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

    /// Submit a [`SessionDomainOp`](crate::live::sessions::model::SessionDomainOp)
    /// to run serialized through the actor loop. The caller downcasts the
    /// boxed reply to the op's concrete output type.
    pub async fn run_domain_op(
        &self,
        op: Box<dyn crate::live::sessions::model::SessionDomainOp>,
    ) -> Result<Box<dyn std::any::Any + Send>, LiveSessionCommandError<std::convert::Infallible>>
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.command_tx
            .send(SessionCommand::RunDomainOp { op, respond_to: tx })
            .await
            .map_err(|_| LiveSessionCommandError::ActorUnavailable)?;
        rx.await
            .map_err(|_| LiveSessionCommandError::ResponseDropped)
    }

    /// Send an ACP extension-method request to the agent, serialized through
    /// the actor loop, and return its raw JSON result.
    pub async fn call_agent_ext_method(
        &self,
        method: String,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, LiveSessionCommandError<anyhow::Error>> {
        self.send_request(|respond_to| SessionCommand::CallAgentExtMethod {
            method,
            params,
            respond_to,
        })
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

    pub(in crate::live::sessions) async fn inject_runtime_event(
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

    /// Crate-private conditional turn cancellation (spec workflow-run-control
    /// §5.2): the actor serially compares `expected_turn_id` with its current
    /// active turn and forwards ACP cancellation only on exact match. `None`
    /// means the actor is unavailable (command not delivered or reply lost).
    pub(crate) async fn cancel_turn_if_active(
        &self,
        expected_turn_id: String,
    ) -> Option<ConditionalCancelOutcome> {
        let (respond_to, rx) = oneshot::channel();
        if self
            .command_tx
            .send(SessionCommand::CancelTurnIfActive {
                expected_turn_id,
                respond_to,
            })
            .await
            .is_err()
        {
            return None;
        }
        rx.await.ok()
    }

    pub async fn dismiss(&self) -> anyhow::Result<()> {
        self.send_request(|respond_to| SessionCommand::Dismiss { respond_to })
            .await
            .map_err(anyhow_command_error)
    }

    /// Ask the actor to retire itself only if it is STILL idle when the
    /// command reaches the front of its mailbox. The reaper's sweep verdict is
    /// an outside observation that is already stale by the time it is acted
    /// on, so the actor re-decides serially on its own loop. `None` means the
    /// actor is unavailable (command not delivered, or the reply lost), which
    /// for the reaper reads the same as gone.
    pub(in crate::live::sessions) async fn unload_nonterminal_if_idle(
        &self,
    ) -> Option<ConditionalUnloadOutcome> {
        let (respond_to, rx) = tokio::sync::oneshot::channel();
        if self
            .command_tx
            .send(SessionCommand::UnloadIfIdle { respond_to })
            .await
            .is_err()
        {
            return None;
        }
        rx.await.ok()
    }

    pub(in crate::live::sessions) async fn unload_nonterminal(&self) -> anyhow::Result<()> {
        self.send_request(|respond_to| SessionCommand::Unload { respond_to })
            .await
            .map_err(anyhow_command_error)
    }

    /// Workspace-wide stop: detaches the live actor exactly like `dismiss`,
    /// but the returned future does not resolve until the agent's process
    /// group has been signaled (TERM, then KILL after a 5s grace) and
    /// reaped. Returns the `(total, git)` kill census taken before signaling.
    pub async fn stop_and_await(&self) -> anyhow::Result<(usize, usize)> {
        self.send_request(|respond_to| SessionCommand::Stop { respond_to })
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
        let handle = Self::new(
            session_id,
            None,
            command_tx,
            event_tx,
            native_session_id,
            phase,
        );
        handle.relinquish_event_sequence();
        handle.actor_finished.complete();
        handle
    }
}

#[cfg(test)]
mod ext_method_error_tests;
