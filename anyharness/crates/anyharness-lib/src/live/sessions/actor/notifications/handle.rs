use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol as acp;
use tokio::sync::Mutex;

use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::dispatch::{
    apply_actor_update, persist_raw_notification,
};
use crate::live::sessions::actor::notifications::observations::dispatch_observations;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};
use crate::live::sessions::actor::turn::finish::{
    commit_staged_terminal_with_retry, terminal_persist_error_class,
};
use crate::live::sessions::background_work::BackgroundWorkRegistry;
use crate::live::sessions::driver::inbound;
use crate::live::sessions::model::ActorCapabilities;
use crate::live::sessions::sink::{PromptTerminalEvent, SessionEventSink, SinkObservation};

impl SessionActor {
    /// Routes one inbound ACP notification through raw persistence, the
    /// resume-replay filter, transcript normalization, and observer dispatch.
    pub(in crate::live::sessions::actor) async fn handle_notification(
        &mut self,
        notif: &acp::schema::SessionNotification,
    ) {
        handle_notification_with_resume_replay_filter(
            notif,
            &mut self.resume_replay_filter,
            &self.event_sink,
            &mut self.background_work_registry,
            &self.caps,
            &self.session_id,
            &self.workspace_id,
            &self.agent_kind,
            &mut self.persisted_config_state,
            &mut self.startup_state,
        )
        .await;
    }
}

#[cfg(test)]
pub(in crate::live::sessions::actor) async fn handle_notification(
    notif: &acp::schema::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    caps: &ActorCapabilities,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let mut replay_filter = ResumeReplayFilter::disabled();
    handle_notification_with_resume_replay_filter(
        notif,
        &mut replay_filter,
        event_sink,
        background_work_registry,
        caps,
        session_id,
        workspace_id,
        source_agent_kind,
        persisted_config_state,
        startup_state,
    )
    .await;
}

pub(in crate::live::sessions::actor) async fn handle_notification_with_resume_replay_filter(
    notif: &acp::schema::SessionNotification,
    replay_filter: &mut ResumeReplayFilter,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    caps: &ActorCapabilities,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let kind = inbound::session_update_kind(&notif.update);
    tracing::info!(
        session_id = %session_id,
        agent = %source_agent_kind,
        kind = kind,
        "handle_notification: received ACP notification"
    );
    if let Err(error) = persist_raw_notification(caps.events.as_ref(), session_id, kind, notif) {
        tracing::warn!(
            session_id = %session_id,
            kind = kind,
            error = %error,
            "failed to persist raw ACP notification"
        );
    }

    // Invariant: raw ACP notifications are stored before replay suppression or
    // transcript normalization so durable debugging state preserves provider
    // order even when resumed-session replay is filtered from the transcript.
    if replay_filter.should_suppress(notif, Instant::now()) {
        tracing::info!(
            session_id = %session_id,
            agent = %source_agent_kind,
            kind = kind,
            "suppressing resumed-session replay notification before transcript normalization"
        );
        return;
    }

    // A failed prompt-terminal commit must leave the actor quiescent for
    // startup repair: ingesting another normalized event could consume the
    // frozen batch's sequence number. Engine terminals may retry here because
    // they require no prompt-finish callback; either way, no new transcript
    // event is accepted before the exact staged batch is resolved.
    if let Some(engine_initiated) = event_sink
        .lock()
        .await
        .staged_terminal_is_engine_initiated()
    {
        if !engine_initiated {
            tracing::error!(
                session_id,
                failure_code = "prompt_terminal_awaiting_startup_repair",
                "normalized notification suppressed while prompt terminal remains unresolved"
            );
            return;
        }
        if let Err(error) = commit_staged_terminal_with_retry(event_sink, session_id).await {
            tracing::error!(
                session_id,
                failure_code = "engine_terminal_persist_exhausted",
                error_class = terminal_persist_error_class(&error),
                "normalized notification suppressed while engine terminal remains unresolved"
            );
            return;
        }
    }

    // The sink ingests the notification (meaning-blind transcript emission)
    // and hands back what the actor still owns: registry observation of tool
    // traffic, the durable config/mode/title arms, and observer dispatch.
    let outcome = event_sink.lock().await.ingest(notif);

    for observation in &outcome.observations {
        if let SinkObservation::ToolCall { turn_id, payload } = observation {
            background_work_registry
                .observe_tool_payload(turn_id.clone(), payload)
                .await;
        }
    }

    if let Some(update) = outcome.needs_actor {
        apply_actor_update(
            update,
            event_sink,
            caps.state.as_ref(),
            session_id,
            source_agent_kind,
            persisted_config_state,
            startup_state,
        )
        .await;
    }

    dispatch_observations(
        event_sink,
        &caps.observers,
        session_id,
        workspace_id,
        source_agent_kind,
        outcome.observations,
    )
    .await;

    // A goal_updated tag opens an engine-initiated turn before the goal
    // observer classifies the update; if the observer dropped it (stale echo,
    // idempotent no-op) the turn is still empty — close it now so it cannot
    // dangle as a phantom in-progress turn.
    event_sink.lock().await.sweep_empty_engine_turn();
    let (has_staged_terminal, requested_outcome) = {
        let sink = event_sink.lock().await;
        (
            sink.has_staged_terminal(),
            sink.requested_engine_terminal_outcome(),
        )
    };
    if has_staged_terminal || requested_outcome.is_some() {
        if !has_staged_terminal {
            let outcome = requested_outcome.expect("requested engine outcome");
            if event_sink
                .lock()
                .await
                .stage_prompt_terminal(
                    outcome,
                    PromptTerminalEvent::TurnEnded(anyharness_contract::v1::StopReason::EndTurn),
                )
                .is_err()
            {
                return;
            }
        }
        if let Err(error) = commit_staged_terminal_with_retry(event_sink, session_id).await {
            tracing::error!(
                session_id,
                failure_code = "engine_terminal_persist_exhausted",
                error_class = terminal_persist_error_class(&error),
                "engine turn remains open and repairable"
            );
        }
    }
}
