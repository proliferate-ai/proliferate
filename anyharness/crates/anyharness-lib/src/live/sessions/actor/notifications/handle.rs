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
use crate::live::sessions::background_work::BackgroundWorkRegistry;
use crate::live::sessions::driver::inbound;
use crate::live::sessions::model::ActorCapabilities;
use crate::live::sessions::sink::{SessionEventSink, SinkObservation};

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
}
