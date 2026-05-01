use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use anyharness_contract::v1::{
    InteractionPayload, PendingInteractionPayloadSummary, PendingInteractionSource,
    PendingInteractionSummary, SessionEndReason, SessionEndedEvent, SessionEvent,
    SessionEventEnvelope, SessionExecutionPhase, SessionStartedEvent,
};
use tokio::sync::{broadcast, mpsc};

use super::event_sink::publish_session_event;
use super::session_actor::{
    ActorReadyResult, ForkSessionCommandError, LiveSessionHandle, PromptAcceptError,
    QueueMutationError, ResolveInteractionCommandError, SessionCommand,
    SetConfigOptionCommandError,
};
use crate::plans::service::PlanDecisionError;
use crate::sessions::model::SessionRecord;
use crate::sessions::runtime_event::RuntimeEventInjectionError;
use crate::sessions::store::SessionStore;

const MAX_REPLAY_GAP: Duration = Duration::from_millis(1500);

pub struct ReplayActorConfig {
    pub session: SessionRecord,
    pub events: Vec<SessionEventEnvelope>,
    pub speed: f32,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
    pub session_store: SessionStore,
    pub last_seq: i64,
    pub on_exit: Option<Box<dyn FnOnce(bool) + Send + 'static>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReplayExitDisposition {
    Completed,
    Close,
    Dismiss,
}

pub fn spawn_replay_actor(
    mut config: ReplayActorConfig,
) -> anyhow::Result<(Arc<LiveSessionHandle>, ActorReadyResult)> {
    let session_id = config.session.id.clone();
    let native_session_id = format!("replay:{session_id}");
    let (command_tx, command_rx) = mpsc::channel::<SessionCommand>(32);
    let handle = Arc::new(LiveSessionHandle::new(
        session_id.clone(),
        command_tx,
        config.event_tx.clone(),
        Some(native_session_id.clone()),
        SessionExecutionPhase::Starting,
    ));
    let actor_handle = handle.clone();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<String>>();
    let on_exit = config.on_exit.take();

    std::thread::Builder::new()
        .name(format!(
            "replay-session-{}",
            &session_id[..8.min(session_id.len())]
        ))
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build replay tokio runtime");
            let errored = match rt.block_on(run_replay_actor(
                config,
                command_rx,
                ready_tx,
                actor_handle,
                native_session_id,
            )) {
                Ok(()) => false,
                Err(error) => {
                    tracing::error!(session_id = %session_id, error = %error, "replay actor failed");
                    true
                }
            };
            if let Some(cb) = on_exit {
                cb(errored);
            }
        })?;

    let native_session_id = ready_rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|error| match error {
            std::sync::mpsc::RecvTimeoutError::Timeout => {
                anyhow::anyhow!("replay session startup timed out after 10s")
            }
            std::sync::mpsc::RecvTimeoutError::Disconnected => {
                anyhow::anyhow!("replay actor died before startup completed")
            }
        })??;

    Ok((handle, ActorReadyResult { native_session_id }))
}

async fn run_replay_actor(
    config: ReplayActorConfig,
    mut command_rx: mpsc::Receiver<SessionCommand>,
    ready_tx: std::sync::mpsc::Sender<anyhow::Result<String>>,
    handle: Arc<LiveSessionHandle>,
    native_session_id: String,
) -> anyhow::Result<()> {
    let session_id = config.session.id.clone();
    let store = config.session_store.clone();
    let mut next_seq = config.last_seq + 1;
    let mut first_turn_started = false;
    let mut previous_recorded_timestamp: Option<chrono::DateTime<chrono::FixedOffset>> = None;
    let mut emitted_session_ended = false;

    let _ = ready_tx.send(Ok(native_session_id));
    handle
        .set_execution_phase(SessionExecutionPhase::Idle)
        .await;
    let now = chrono::Utc::now().to_rfc3339();
    let _ = store.update_status(&session_id, "idle", &now);

    let mut exit = ReplayExitDisposition::Completed;
    for recorded in config.events {
        if matches!(recorded.event, SessionEvent::TurnStarted(_)) {
            if first_turn_started {
                handle.busy.store(false, Ordering::Release);
                handle
                    .set_execution_phase(SessionExecutionPhase::Idle)
                    .await;
                let _ = store.update_status(&session_id, "idle", &chrono::Utc::now().to_rfc3339());
                match wait_for_advance(&mut command_rx).await {
                    Ok(()) => {}
                    Err(disposition) => {
                        exit = disposition;
                        break;
                    }
                }
            }
            first_turn_started = true;
            handle.busy.store(true, Ordering::Release);
            handle
                .set_execution_phase(SessionExecutionPhase::Running)
                .await;
            let _ = store.update_status(&session_id, "running", &chrono::Utc::now().to_rfc3339());
        }

        let recorded_timestamp = parse_recorded_timestamp(&recorded)?;
        let delay = replay_delay(
            previous_recorded_timestamp,
            recorded_timestamp,
            config.speed,
        );
        previous_recorded_timestamp = Some(recorded_timestamp);
        if !delay.is_zero() {
            match sleep_or_handle_commands(delay, &mut command_rx).await {
                Ok(()) => {}
                Err(disposition) => {
                    exit = disposition;
                    break;
                }
            }
        }

        let event = remap_event(recorded.event, &session_id);
        publish_session_event(
            &session_id,
            &mut next_seq,
            &config.event_tx,
            &store,
            event.clone(),
            recorded.turn_id,
            recorded.item_id,
        );

        match event {
            SessionEvent::InteractionRequested(interaction) => {
                handle
                    .add_pending_interaction(pending_summary_from_interaction(&interaction))
                    .await;
                match wait_for_interaction(&mut command_rx, &handle, &interaction.request_id).await
                {
                    Ok(()) => {}
                    Err(disposition) => {
                        exit = disposition;
                        break;
                    }
                }
            }
            SessionEvent::InteractionResolved(interaction) => {
                handle
                    .remove_pending_interaction(&interaction.request_id)
                    .await;
            }
            SessionEvent::TurnEnded(_) => {
                handle.busy.store(false, Ordering::Release);
                handle
                    .set_execution_phase(SessionExecutionPhase::Idle)
                    .await;
                let _ = store.update_status(&session_id, "idle", &chrono::Utc::now().to_rfc3339());
            }
            SessionEvent::SessionEnded(event) => {
                emitted_session_ended = true;
                let is_error = matches!(event.reason, SessionEndReason::Error);
                let phase = if is_error {
                    SessionExecutionPhase::Errored
                } else {
                    SessionExecutionPhase::Closed
                };
                handle
                    .clear_pending_interactions_for_terminal_state(phase)
                    .await;
                let status = if is_error { "errored" } else { "closed" };
                let _ = store.update_status(&session_id, status, &chrono::Utc::now().to_rfc3339());
            }
            SessionEvent::Error(_) => {
                handle
                    .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Errored)
                    .await;
                let _ =
                    store.update_status(&session_id, "errored", &chrono::Utc::now().to_rfc3339());
            }
            SessionEvent::ItemStarted(_) | SessionEvent::ItemDelta(_) => {
                handle
                    .set_execution_phase(SessionExecutionPhase::Running)
                    .await;
                let _ =
                    store.update_status(&session_id, "running", &chrono::Utc::now().to_rfc3339());
            }
            _ => {}
        }
    }

    if matches!(exit, ReplayExitDisposition::Close) && !emitted_session_ended {
        publish_session_event(
            &session_id,
            &mut next_seq,
            &config.event_tx,
            &store,
            SessionEvent::SessionEnded(SessionEndedEvent {
                reason: SessionEndReason::Closed,
            }),
            None,
            None,
        );
    }

    handle.busy.store(false, Ordering::Release);
    match exit {
        ReplayExitDisposition::Close => {
            handle
                .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Closed)
                .await;
        }
        ReplayExitDisposition::Dismiss | ReplayExitDisposition::Completed => {
            handle
                .clear_pending_interactions_for_terminal_state(SessionExecutionPhase::Idle)
                .await;
        }
    }
    Ok(())
}

async fn wait_for_advance(
    command_rx: &mut mpsc::Receiver<SessionCommand>,
) -> Result<(), ReplayExitDisposition> {
    loop {
        match command_rx.recv().await {
            Some(SessionCommand::ReplayAdvance { respond_to }) => {
                let _ = respond_to.send(Ok(()));
                return Ok(());
            }
            Some(command) => {
                if let Some(disposition) = handle_non_replay_command(command, true).await {
                    return Err(disposition);
                }
            }
            None => return Err(ReplayExitDisposition::Close),
        }
    }
}

async fn wait_for_interaction(
    command_rx: &mut mpsc::Receiver<SessionCommand>,
    handle: &Arc<LiveSessionHandle>,
    request_id: &str,
) -> Result<(), ReplayExitDisposition> {
    loop {
        match command_rx.recv().await {
            Some(SessionCommand::ResolveInteraction {
                request_id: resolved_id,
                respond_to,
                ..
            }) if resolved_id == request_id => {
                handle.remove_pending_interaction(request_id).await;
                let _ = respond_to.send(Ok(()));
                return Ok(());
            }
            Some(SessionCommand::ResolveInteraction { respond_to, .. }) => {
                let _ = respond_to.send(Err(ResolveInteractionCommandError::NotFound));
            }
            Some(command) => {
                if let Some(disposition) = handle_non_replay_command(command, false).await {
                    return Err(disposition);
                }
            }
            None => return Err(ReplayExitDisposition::Close),
        }
    }
}

async fn sleep_or_handle_commands(
    delay: Duration,
    command_rx: &mut mpsc::Receiver<SessionCommand>,
) -> Result<(), ReplayExitDisposition> {
    let sleep = tokio::time::sleep(delay);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return Ok(()),
            command = command_rx.recv() => {
                match command {
                    Some(command) => {
                        if let Some(disposition) = handle_non_replay_command(command, false).await {
                            return Err(disposition);
                        }
                    }
                    None => return Err(ReplayExitDisposition::Close),
                }
            }
        }
    }
}

async fn handle_non_replay_command(
    command: SessionCommand,
    advance_allowed: bool,
) -> Option<ReplayExitDisposition> {
    match command {
        SessionCommand::ReplayAdvance { respond_to } => {
            let result = if advance_allowed {
                Ok(())
            } else {
                Err(anyhow::anyhow!(
                    "replay is not paused at an advance boundary"
                ))
            };
            let _ = respond_to.send(result);
            None
        }
        SessionCommand::Prompt { respond_to, .. } => {
            let _ = respond_to.send(Err(PromptAcceptError::EnqueueFailed(
                "replay sessions do not accept prompts".to_string(),
            )));
            None
        }
        SessionCommand::EditPendingPrompt { respond_to, .. }
        | SessionCommand::DeletePendingPrompt { respond_to, .. } => {
            let _ = respond_to.send(Err(QueueMutationError::NotFound));
            None
        }
        SessionCommand::SetConfigOption { respond_to, .. } => {
            let _ = respond_to.send(Err(SetConfigOptionCommandError::Rejected(
                "replay sessions do not support config changes".to_string(),
            )));
            None
        }
        SessionCommand::ResolveInteraction { respond_to, .. } => {
            let _ = respond_to.send(Err(ResolveInteractionCommandError::NotFound));
            None
        }
        SessionCommand::ApplyPlanDecision { respond_to, .. } => {
            let _ = respond_to.send(Err(PlanDecisionError::NotFound));
            None
        }
        SessionCommand::VerifyForkReady { respond_to } => {
            let _ = respond_to.send(Err(ForkSessionCommandError::Unsupported(
                "replay sessions cannot be forked".to_string(),
            )));
            None
        }
        SessionCommand::Fork { respond_to } => {
            let _ = respond_to.send(Err(ForkSessionCommandError::Unsupported(
                "replay sessions cannot be forked".to_string(),
            )));
            None
        }
        SessionCommand::CloseNativeSession { respond_to, .. } => {
            let _ = respond_to.send(Err(anyhow::anyhow!(
                "replay sessions have no native child sessions"
            )));
            None
        }
        SessionCommand::InjectRuntimeEvent { respond_to, .. } => {
            let _ = respond_to.send(Err(RuntimeEventInjectionError::SessionReplaying));
            None
        }
        SessionCommand::Cancel => None,
        SessionCommand::Dismiss { respond_to } => {
            let _ = respond_to.send(Ok(()));
            Some(ReplayExitDisposition::Dismiss)
        }
        SessionCommand::Close { respond_to } => {
            let _ = respond_to.send(Ok(()));
            Some(ReplayExitDisposition::Close)
        }
    }
}

fn remap_event(event: SessionEvent, session_id: &str) -> SessionEvent {
    match event {
        SessionEvent::SessionStarted(SessionStartedEvent {
            source_agent_kind, ..
        }) => SessionEvent::SessionStarted(SessionStartedEvent {
            native_session_id: format!("replay:{session_id}"),
            source_agent_kind,
        }),
        other => other,
    }
}

fn parse_recorded_timestamp(
    envelope: &SessionEventEnvelope,
) -> anyhow::Result<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(&envelope.timestamp).map_err(|error| {
        anyhow::anyhow!("invalid replay timestamp at seq {}: {error}", envelope.seq)
    })
}

fn replay_delay(
    previous: Option<chrono::DateTime<chrono::FixedOffset>>,
    current: chrono::DateTime<chrono::FixedOffset>,
    speed: f32,
) -> Duration {
    if speed == 0.0 {
        return Duration::ZERO;
    }
    let Some(previous) = previous else {
        return Duration::ZERO;
    };
    let delta = current.signed_duration_since(previous);
    if delta <= chrono::TimeDelta::zero() {
        return Duration::ZERO;
    }
    let capped = delta.to_std().unwrap_or(Duration::ZERO).min(MAX_REPLAY_GAP);
    capped.div_f32(speed)
}

fn pending_summary_from_interaction(
    event: &anyharness_contract::v1::InteractionRequestedEvent,
) -> PendingInteractionSummary {
    PendingInteractionSummary {
        request_id: event.request_id.clone(),
        kind: event.kind.clone(),
        title: event.title.clone(),
        description: event.description.clone(),
        source: PendingInteractionSource {
            tool_call_id: event.source.tool_call_id.clone(),
            tool_kind: event.source.tool_kind.clone(),
            tool_status: event.source.tool_status.clone(),
            linked_plan_id: None,
        },
        payload: pending_payload_summary(&event.payload),
    }
}

fn pending_payload_summary(payload: &InteractionPayload) -> PendingInteractionPayloadSummary {
    match payload {
        InteractionPayload::Permission(payload) => PendingInteractionPayloadSummary::Permission {
            options: payload.options.clone(),
            context: payload.context.clone(),
        },
        InteractionPayload::UserInput(payload) => PendingInteractionPayloadSummary::UserInput {
            questions: payload.questions.clone(),
        },
        InteractionPayload::McpElicitation(payload) => {
            PendingInteractionPayloadSummary::McpElicitation {
                payload: payload.clone(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::runtime_event::RuntimeInjectedSessionEvent;

    fn ts(value: &str) -> chrono::DateTime<chrono::FixedOffset> {
        chrono::DateTime::parse_from_rfc3339(value).expect("valid timestamp")
    }

    #[test]
    fn replay_delay_caps_negative_deltas_and_zero_speed() {
        let first = ts("2026-04-16T18:00:00Z");
        let later = ts("2026-04-16T18:00:10Z");
        let earlier = ts("2026-04-16T17:59:59Z");

        assert_eq!(replay_delay(None, first, 1.0), Duration::ZERO);
        assert_eq!(replay_delay(Some(first), later, 1.0), MAX_REPLAY_GAP);
        assert_eq!(
            replay_delay(Some(first), later, 2.0),
            Duration::from_millis(750)
        );
        assert_eq!(replay_delay(Some(first), earlier, 1.0), Duration::ZERO);
        assert_eq!(replay_delay(Some(first), later, 0.0), Duration::ZERO);
    }

    #[test]
    fn remap_event_rewrites_session_started_native_id() {
        let remapped = remap_event(
            SessionEvent::SessionStarted(SessionStartedEvent {
                native_session_id: "native-old".to_string(),
                source_agent_kind: "codex".to_string(),
            }),
            "session-new",
        );

        match remapped {
            SessionEvent::SessionStarted(event) => {
                assert_eq!(event.native_session_id, "replay:session-new");
                assert_eq!(event.source_agent_kind, "codex");
            }
            _ => panic!("expected session_started"),
        }
    }

    #[tokio::test]
    async fn replay_actor_rejects_runtime_event_injection() {
        let (tx, rx) = tokio::sync::oneshot::channel();

        let disposition = handle_non_replay_command(
            SessionCommand::InjectRuntimeEvent {
                event: RuntimeInjectedSessionEvent::SessionInfoUpdate {
                    title: Some("Renamed".to_string()),
                    updated_at: None,
                },
                respond_to: tx,
            },
            false,
        )
        .await;

        assert!(disposition.is_none());
        let error = rx
            .await
            .expect("response")
            .expect_err("replay should reject injection");
        assert!(matches!(
            error,
            RuntimeEventInjectionError::SessionReplaying
        ));
    }
}
