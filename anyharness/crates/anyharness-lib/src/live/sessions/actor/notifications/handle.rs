use std::sync::Arc;
use std::time::Instant;

use agent_client_protocol as acp;
use tokio::sync::Mutex;

use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::notifications::dispatch::{
    normalize_notification, persist_raw_notification,
};
use crate::live::sessions::actor::notifications::observations::dispatch_observations;
use crate::live::sessions::model::SessionEventObserver;
use crate::live::sessions::actor::notifications::replay_filter::ResumeReplayFilter;
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::background_work::BackgroundWorkRegistry;
use crate::live::sessions::driver::inbound;
use crate::live::sessions::sink::SessionEventSink;
#[cfg(test)]
pub(in crate::live::sessions::actor) async fn handle_notification(
    notif: &acp::schema::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    observers: &[Arc<dyn SessionEventObserver>],
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let mut replay_filter = ResumeReplayFilter::disabled();
    handle_notification_with_resume_replay_filter(
        notif,
        &mut replay_filter,
        event_sink,
        background_work_registry,
        session_store,
        session_id,
        workspace_id,
        source_agent_kind,
        observers,
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
    session_store: &SessionStore,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    observers: &[Arc<dyn SessionEventObserver>],
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
    if let Err(error) = persist_raw_notification(session_store, session_id, kind, notif) {
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

    let observations = normalize_notification(
        notif,
        event_sink,
        background_work_registry,
        session_store,
        session_id,
        source_agent_kind,
        persisted_config_state,
        startup_state,
    )
    .await;
    dispatch_observations(
        event_sink,
        observers,
        session_id,
        workspace_id,
        source_agent_kind,
        observations,
    )
    .await;
}
