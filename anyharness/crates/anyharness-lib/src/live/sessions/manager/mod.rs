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

    /// Returns only a handle whose actor startup completed. Callers that must
    /// join an in-progress startup should fall through to `start_session`,
    /// which waits on the shared readiness channel.
    pub async fn get_ready_handle(&self, session_id: &str) -> Option<Arc<LiveSessionHandle>> {
        self.get_handle(session_id)
            .await
            .filter(|handle| handle.native_session_id().is_some())
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

/// Merge-gated seam for run-control tests: a registered live handle whose
/// command consumer is scripted, so the production seams that traverse the
/// manager (`request_live_turn_cancel`, effort application, prompt dispatch)
/// can be driven deterministically without a real agent process. Because the
/// startup path reuses an already-registered handle, pre-registering one lets
/// the REAL execution task run end to end against this script.
#[cfg(test)]
#[derive(Debug)]
pub(crate) enum ScriptedSessionEvent {
    /// A `SetConfigOption` arrived (real effort application).
    Config { config_id: String, value: String },
    /// A `Prompt` arrived (real dispatch), with its deterministic prompt id.
    Prompt { prompt_id: Option<String> },
    /// A `CancelTurnIfActive` arrived, with its exact expected turn id.
    CancelIfActive { expected_turn_id: String },
}

#[cfg(test)]
pub(crate) struct ScriptedSession {
    /// One entry per received command, in arrival order.
    pub(crate) events: tokio::sync::mpsc::UnboundedReceiver<ScriptedSessionEvent>,
    /// With `hold_config_replies` / `hold_cancel_replies`, the matching reply
    /// waits for one `notify_one` permit per command.
    pub(crate) release: Arc<tokio::sync::Notify>,
}

#[cfg(test)]
pub(crate) struct ScriptedSessionSpec {
    /// Turn id returned as `PromptAcceptance::Started` for each prompt.
    pub(crate) prompt_turn_id: String,
    /// Hold each `SetConfigOption` reply until released (cancel-during-effort
    /// windows).
    pub(crate) hold_config_replies: bool,
    /// Hold each `CancelTurnIfActive` reply until released (post-commit
    /// injection windows).
    pub(crate) hold_cancel_replies: bool,
}

#[cfg(test)]
impl LiveSessionManager {
    pub(crate) async fn insert_pending_startup_for_test(
        &self,
        session_id: &str,
    ) -> watch::Sender<StartupReadinessState> {
        let (command_tx, _command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            None,
            anyharness_contract::v1::SessionExecutionPhase::Starting,
        ));
        let (ready_tx, ready_rx) = watch::channel::<StartupReadinessState>(None);
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);
        self.pending_startups
            .write()
            .await
            .insert(session_id.to_string(), ready_rx);
        ready_tx
    }

    /// Register a scripted handle for `session_id`: `SetConfigOption` answers
    /// `Applied`, `Prompt` answers `Started` with the scripted turn id,
    /// `CancelTurnIfActive` answers `Requested`; every command is recorded.
    /// Other commands are dropped.
    pub(crate) async fn insert_scripted_session_for_test(
        &self,
        session_id: &str,
        spec: ScriptedSessionSpec,
    ) -> ScriptedSession {
        use crate::live::sessions::actor::command::{
            ConditionalCancelOutcome, PromptAcceptance, SessionCommand,
        };
        use anyharness_contract::v1::ConfigApplyState;

        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(8);
        let (event_tx, _) = tokio::sync::broadcast::channel(16);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            anyharness_contract::v1::SessionExecutionPhase::Running,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);

        let (seen_tx, seen_rx) = tokio::sync::mpsc::unbounded_channel();
        let release = Arc::new(tokio::sync::Notify::new());
        let release_for_task = release.clone();
        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                match command {
                    SessionCommand::SetConfigOption {
                        config_id,
                        value,
                        respond_to,
                        ..
                    } => {
                        let _ = seen_tx.send(ScriptedSessionEvent::Config { config_id, value });
                        if spec.hold_config_replies {
                            release_for_task.notified().await;
                        }
                        let _ = respond_to.send(Ok(ConfigApplyState::Applied));
                    }
                    SessionCommand::Prompt {
                        prompt_id,
                        respond_to,
                        ..
                    } => {
                        let _ = seen_tx.send(ScriptedSessionEvent::Prompt { prompt_id });
                        let _ = respond_to.send(Ok(PromptAcceptance::Started {
                            turn_id: spec.prompt_turn_id.clone(),
                        }));
                    }
                    SessionCommand::CancelTurnIfActive {
                        expected_turn_id,
                        respond_to,
                    } => {
                        let _ =
                            seen_tx.send(ScriptedSessionEvent::CancelIfActive { expected_turn_id });
                        if spec.hold_cancel_replies {
                            release_for_task.notified().await;
                        }
                        let _ = respond_to.send(ConditionalCancelOutcome::Requested);
                    }
                    _ => {}
                }
            }
        });
        ScriptedSession {
            events: seen_rx,
            release,
        }
    }
}
