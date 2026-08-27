use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{watch, RwLock};

use super::rendezvous::broker::{
    InteractionRendezvous, ResolveInteractionError as BrokerResolveInteractionError,
};
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::ActorCapabilities;

pub(crate) mod reaper;
mod replay;
mod runtime_events;
mod startup;
mod unload;

#[cfg(test)]
mod fork_test_support;
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
    pub(super) fn retire_generation_after_actor_finish(
        &self,
        session_id: String,
        handle: Arc<LiveSessionHandle>,
    ) {
        let live_sessions = self.live_sessions.clone();
        tokio::spawn(async move {
            handle.wait_until_actor_finished().await;
            let mut sessions = live_sessions.write().await;
            if matches!(sessions.get(&session_id), Some(current) if Arc::ptr_eq(current, &handle)) {
                sessions.remove(&session_id);
            }
        });
    }

    #[cfg(test)]
    pub(crate) async fn register_handle_for_test(&self, handle: Arc<LiveSessionHandle>) {
        self.live_sessions
            .write()
            .await
            .insert(handle.session_id.clone(), handle);
    }

    #[cfg(test)]
    pub(crate) async fn insert_unavailable_session_for_test(&self, session_id: &str) {
        let (command_tx, command_rx) = tokio::sync::mpsc::channel(1);
        drop(command_rx);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);
    }

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

    /// Run one synchronous recovery action only while no live actor owns the
    /// session. Holding the same map lock used by startup makes the absence
    /// check and action indivisible with respect to actor installation.
    pub(crate) async fn run_if_session_absent<T>(
        &self,
        session_id: &str,
        action: impl FnOnce() -> T,
    ) -> Option<T> {
        let sessions = self.live_sessions.write().await;
        if sessions.contains_key(session_id) {
            return None;
        }
        Some(action())
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
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    Config { config_id: String, value: String },
    /// A `Prompt` arrived (real dispatch), with its deterministic prompt id.
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    Prompt { prompt_id: Option<String> },
    /// A `CancelTurnIfActive` arrived, with its exact expected turn id.
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    CancelIfActive { expected_turn_id: String },
}

#[cfg(test)]
pub(crate) struct ScriptedSession {
    /// One entry per received command, in arrival order.
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
    pub(crate) events: tokio::sync::mpsc::UnboundedReceiver<ScriptedSessionEvent>,
    /// With `hold_config_replies` / `hold_cancel_replies`, the matching reply
    /// waits for one `notify_one` permit per command.
    #[allow(dead_code)]
    // AH-CLIPPY-2: flagged dead by lint wiring 2026-08-27; owner deletes or revives
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
pub(crate) struct ObservedPrompt {
    pub(crate) prompt_id: Option<String>,
    pub(crate) payload: crate::domains::sessions::prompt::PromptPayload,
    pub(crate) from_queue_seq: Option<i64>,
}

#[cfg(test)]
impl LiveSessionManager {
    pub(crate) async fn insert_prompt_observer_for_test(
        &self,
        session_id: &str,
    ) -> tokio::sync::mpsc::UnboundedReceiver<ObservedPrompt> {
        self.insert_prompt_observer_with_phase_for_test(
            session_id,
            anyharness_contract::v1::SessionExecutionPhase::Running,
        )
        .await
    }

    pub(crate) async fn insert_prompt_observer_with_phase_for_test(
        &self,
        session_id: &str,
        phase: anyharness_contract::v1::SessionExecutionPhase,
    ) -> tokio::sync::mpsc::UnboundedReceiver<ObservedPrompt> {
        use crate::live::sessions::actor::command::{PromptAcceptance, SessionCommand};

        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            phase,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);
        let (seen_tx, seen_rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if let SessionCommand::Prompt {
                    payload,
                    prompt_id,
                    from_queue_seq,
                    respond_to,
                } = command
                {
                    let _ = seen_tx.send(ObservedPrompt {
                        prompt_id,
                        payload,
                        from_queue_seq,
                    });
                    let acceptance = match from_queue_seq {
                        Some(seq) => PromptAcceptance::Queued { seq },
                        None => PromptAcceptance::Started {
                            turn_id: "observed-turn".into(),
                        },
                    };
                    let _ = respond_to.send(Ok(acceptance));
                }
            }
        });
        seen_rx
    }

    /// Register a ready handle whose command consumer accepts one prompt into
    /// the real mailbox and then drops its reply sender. This exercises the
    /// ambiguous post-send `ResponseDropped` path without pretending the actor
    /// was unavailable before command acceptance.
    pub(crate) async fn insert_prompt_response_dropper_for_test(
        &self,
        session_id: &str,
    ) -> tokio::sync::mpsc::UnboundedReceiver<ObservedPrompt> {
        use crate::live::sessions::actor::command::SessionCommand;

        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);
        let (seen_tx, seen_rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            if let Some(SessionCommand::Prompt {
                payload,
                prompt_id,
                from_queue_seq,
                respond_to,
            }) = command_rx.recv().await
            {
                let observed = ObservedPrompt {
                    prompt_id,
                    payload,
                    from_queue_seq,
                };
                drop(respond_to);
                let _ = seen_tx.send(observed);
            }
        });
        seen_rx
    }

    /// Register an idle handle whose actor explicitly rejects each prompt
    /// before a turn or durable queue boundary is accepted.
    pub(crate) async fn insert_prompt_rejecter_for_test(&self, session_id: &str) {
        use crate::live::sessions::actor::command::{PromptAcceptError, SessionCommand};

        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            anyharness_contract::v1::SessionExecutionPhase::Idle,
        ));
        self.live_sessions
            .write()
            .await
            .insert(session_id.to_string(), handle);
        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if let SessionCommand::Prompt { respond_to, .. } = command {
                    let _ = respond_to.send(Err(PromptAcceptError::EnqueueFailed(
                        "injected prompt rejection".to_string(),
                    )));
                }
            }
        });
    }

    pub(crate) async fn insert_busy_session_for_test(&self, session_id: &str) {
        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
        let handle = Arc::new(LiveSessionHandle::new_for_test(
            session_id,
            command_tx,
            event_tx,
            Some(format!("native-{session_id}")),
            anyharness_contract::v1::SessionExecutionPhase::Running,
        ));
        handle.set_busy(true);
        self.live_sessions
            .write()
            .await
            .insert(session_id.into(), handle);
        tokio::spawn(async move { while command_rx.recv().await.is_some() {} });
    }

    pub(crate) async fn insert_cancel_observer_for_test(
        &self,
        session_id: &str,
    ) -> tokio::sync::mpsc::UnboundedReceiver<()> {
        use crate::live::sessions::actor::command::SessionCommand;

        let (command_tx, mut command_rx) = tokio::sync::mpsc::channel(1);
        let (event_tx, _) = tokio::sync::broadcast::channel(1);
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
        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if matches!(command, SessionCommand::Cancel) {
                    let _ = seen_tx.send(());
                }
            }
        });
        seen_rx
    }

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
    /// `CancelTurnIfActive` answers `Requested`, `Stop` answers a fixed
    /// `(3, 1)` census (R3: `stop_all_for_workspace`'s domain-level tests
    /// exercise census AGGREGATION and the session-row write policy against
    /// this scripted stand-in - real process-group death is proven at the
    /// mechanism level and at the actor's own real-process test, not here);
    /// every command is recorded. Other commands are dropped.
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
                    SessionCommand::Stop { respond_to } => {
                        let _ = respond_to.send(Ok((3, 1)));
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

    /// Register a handle whose `Stop` reply is deliberately SLOW (`stop_delay`
    /// before it answers `(1, 0)`) and which answers nothing else. The R3
    /// fan-out seam: `stop_all_for_workspace` must drive several of these
    /// concurrently, so N such sessions cost one `stop_delay`, not N of them —
    /// a sequential walk stacks one full TERM grace per live session and
    /// blows R4's 8s `QUIESCE_DEADLINE` on the second one.
    pub(crate) async fn insert_slow_stop_session_for_test(
        &self,
        session_id: &str,
        stop_delay: std::time::Duration,
    ) {
        use crate::live::sessions::actor::command::SessionCommand;

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

        tokio::spawn(async move {
            while let Some(command) = command_rx.recv().await {
                if let SessionCommand::Stop { respond_to } = command {
                    tokio::time::sleep(stop_delay).await;
                    let _ = respond_to.send(Ok((1, 0)));
                }
            }
        });
    }
}
