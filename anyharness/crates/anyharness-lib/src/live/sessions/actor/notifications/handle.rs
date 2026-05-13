use crate::acp::runtime_client;
use crate::live::sessions::actor::*;
#[cfg(test)]
pub(in crate::live::sessions::actor) async fn handle_notification(
    notif: &acp::SessionNotification,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    plan_service: Arc<PlanService>,
    review_service: Option<Arc<ReviewService>>,
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
        plan_service,
        review_service,
        persisted_config_state,
        startup_state,
    )
    .await;
}

pub(in crate::live::sessions::actor) async fn handle_notification_with_resume_replay_filter(
    notif: &acp::SessionNotification,
    replay_filter: &mut ResumeReplayFilter,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    background_work_registry: &mut BackgroundWorkRegistry,
    session_store: &SessionStore,
    session_id: &str,
    workspace_id: &str,
    source_agent_kind: &str,
    plan_service: Arc<PlanService>,
    review_service: Option<Arc<ReviewService>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    let kind = runtime_client::session_update_kind(&notif.update);
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

    if replay_filter.should_suppress(notif, Instant::now()) {
        tracing::info!(
            session_id = %session_id,
            agent = %source_agent_kind,
            kind = kind,
            "suppressing resumed-session replay notification before transcript normalization"
        );
        return;
    }

    normalize_notification(
        notif,
        event_sink,
        background_work_registry,
        session_store,
        session_id,
        workspace_id,
        source_agent_kind,
        plan_service,
        review_service,
        persisted_config_state,
        startup_state,
    )
    .await;
}
