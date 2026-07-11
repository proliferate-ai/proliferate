use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{watch, RwLock};

use super::rendezvous::broker::{
    InteractionRendezvous, ResolveInteractionError as BrokerResolveInteractionError,
};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::ActorCapabilities;

mod replay;
mod runtime_events;
mod startup;

#[cfg(test)]
mod tests;

type StartupReadinessState = Option<Result<String, String>>;

pub struct LiveSessionManager {
    live_sessions: Arc<RwLock<HashMap<String, Arc<LiveSessionHandle>>>>,
    pending_startups: Arc<RwLock<HashMap<String, watch::Receiver<StartupReadinessState>>>>,
    interaction_broker: Arc<InteractionRendezvous>,
    /// The never-varies capability set every actor runs against; wired once
    /// at construction.
    caps: ActorCapabilities,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RevealMcpElicitationUrlError {
    NotFound,
    KindMismatch,
    NotMcpUrlElicitation,
    InvalidMcpFieldValue,
}

impl From<BrokerResolveInteractionError> for RevealMcpElicitationUrlError {
    fn from(error: BrokerResolveInteractionError) -> Self {
        match error {
            BrokerResolveInteractionError::NotFound => Self::NotFound,
            BrokerResolveInteractionError::KindMismatch => Self::KindMismatch,
            BrokerResolveInteractionError::NotMcpUrlElicitation => Self::NotMcpUrlElicitation,
            BrokerResolveInteractionError::InvalidOptionId
            | BrokerResolveInteractionError::InvalidQuestionId
            | BrokerResolveInteractionError::DuplicateQuestionAnswer
            | BrokerResolveInteractionError::MissingQuestionAnswer
            | BrokerResolveInteractionError::InvalidSelectedOptionLabel
            | BrokerResolveInteractionError::InvalidMcpFieldId
            | BrokerResolveInteractionError::DuplicateMcpField
            | BrokerResolveInteractionError::MissingMcpField
            | BrokerResolveInteractionError::InvalidMcpFieldValue => Self::InvalidMcpFieldValue,
        }
    }
}

impl LiveSessionManager {
    pub fn new(caps: ActorCapabilities) -> Self {
        let interaction_broker = Arc::new(InteractionRendezvous::new());
        Self {
            live_sessions: Arc::new(RwLock::new(HashMap::new())),
            pending_startups: Arc::new(RwLock::new(HashMap::new())),
            interaction_broker,
            caps,
        }
    }

    pub(crate) async fn reveal_mcp_elicitation_url(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<String, RevealMcpElicitationUrlError> {
        self.interaction_broker
            .reveal_mcp_elicitation_url(session_id, request_id)
            .await
            .map_err(RevealMcpElicitationUrlError::from)
    }

    pub async fn get_handle(&self, session_id: &str) -> Option<Arc<LiveSessionHandle>> {
        let sessions = self.live_sessions.read().await;
        sessions.get(session_id).cloned()
    }

    pub async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.live_sessions.write().await;
        sessions.remove(session_id);
        self.pending_startups.write().await.remove(session_id);
    }

    /// Synchronous variant for mobility install/export code that runs inside a
    /// blocking task. Dropping the handle forces the next prompt to start a
    /// fresh native agent with the destination workspace path.
    pub fn remove_session_blocking(&self, session_id: &str) {
        self.live_sessions.blocking_write().remove(session_id);
        self.pending_startups.blocking_write().remove(session_id);
    }
}

impl Clone for LiveSessionManager {
    fn clone(&self) -> Self {
        Self {
            live_sessions: self.live_sessions.clone(),
            pending_startups: self.pending_startups.clone(),
            interaction_broker: self.interaction_broker.clone(),
            caps: self.caps.clone(),
        }
    }
}

#[cfg(test)]
pub(crate) struct DrainingCloseTestControl {
    pub close_received: tokio::sync::oneshot::Receiver<()>,
    release: Option<tokio::sync::oneshot::Sender<()>>,
}

#[cfg(test)]
impl DrainingCloseTestControl {
    pub async fn wait_for_close(&mut self) {
        let _ = (&mut self.close_received).await;
    }

    pub fn release(mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}

#[cfg(test)]
impl LiveSessionManager {
    /// Installs a deterministic busy-actor double: Close is acknowledged and
    /// made observable, but actor exit is held until the test releases it.
    /// This exercises the real handle/manager quiescence boundary without a
    /// provider process.
    pub(crate) async fn install_draining_close_handle_for_test(
        &self,
        session_id: &str,
    ) -> DrainingCloseTestControl {
        use anyharness_contract::v1::{SessionEventEnvelope, SessionExecutionPhase};
        use tokio::sync::{broadcast, mpsc, oneshot};

        use crate::live::sessions::actor::command::SessionCommand;

        let (command_tx, mut command_rx) = mpsc::channel(8);
        let (event_tx, _) = broadcast::channel::<SessionEventEnvelope>(8);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some("test-native-session".to_string()),
            SessionExecutionPhase::Running,
        ));
        handle.set_busy(true);
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle.clone());

        let (close_received_tx, close_received) = oneshot::channel();
        let (release, release_rx) = oneshot::channel();
        let sessions = self.live_sessions.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if let SessionCommand::Close { respond_to } = command {
                    handle
                        .set_execution_phase(SessionExecutionPhase::Closing)
                        .await;
                    let _ = respond_to.send(Ok(()));
                    let _ = close_received_tx.send(());
                    let _ = release_rx.await;
                    sessions.write().await.remove(&session_id);
                    handle.exit_signal.mark_exited();
                    break;
                }
            }
        });

        DrainingCloseTestControl {
            close_received,
            release: Some(release),
        }
    }
}
