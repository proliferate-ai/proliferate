use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc, oneshot, RwLock};

use crate::live::sessions::actor::command::{
    InteractionResolution, ResolveInteractionCommandError, SessionCommand,
};
use anyharness_contract::v1::{
    PendingInteractionSummary, SessionEventEnvelope, SessionExecutionPhase, SessionExecutionSummary,
};

pub struct LiveSessionHandle {
    pub session_id: String,
    pub(crate) command_tx: mpsc::Sender<SessionCommand>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub busy: Arc<AtomicBool>,
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
    pub(crate) fn new(
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

    pub fn try_begin_prompt(&self) -> bool {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn finish_prompt(&self) {
        self.busy.store(false, Ordering::Release);
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

    pub async fn resolve_interaction(
        &self,
        request_id: String,
        resolution: InteractionResolution,
    ) -> Result<(), ResolveInteractionCommandError> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(SessionCommand::ResolveInteraction {
                request_id,
                resolution,
                respond_to: tx,
            })
            .await
            .map_err(|_| ResolveInteractionCommandError::ActorDead)?;
        rx.await
            .map_err(|_| ResolveInteractionCommandError::ActorDead)?
    }

    pub fn native_session_id(&self) -> Option<String> {
        self.native_session_id
            .read()
            .expect("native session id lock poisoned")
            .clone()
    }

    #[cfg(test)]
    pub(crate) fn new_for_test(
        session_id: impl Into<String>,
        command_tx: mpsc::Sender<SessionCommand>,
        event_tx: broadcast::Sender<SessionEventEnvelope>,
        native_session_id: Option<String>,
        phase: SessionExecutionPhase,
    ) -> Self {
        Self::new(session_id, command_tx, event_tx, native_session_id, phase)
    }
}
