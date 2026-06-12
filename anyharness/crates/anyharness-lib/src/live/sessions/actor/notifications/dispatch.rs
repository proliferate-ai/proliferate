use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{CurrentModeUpdatePayload, SessionInfoUpdatePayload};
use tokio::sync::Mutex;

use crate::domains::sessions::runtime_event::{
    RuntimeEventInjectionResult, RuntimeInjectedSessionEvent,
};
use crate::live::sessions::actor::config::apply::set_select_option_current_value_for_purpose;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, persist_current_config_state_from_startup,
};
use crate::live::sessions::actor::config::types::{ConfigPurpose, PersistedSessionConfigState};
use crate::live::sessions::actor::state::SessionActor;
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::handle::LiveSessionHandle;
use crate::live::sessions::model::{EventPersist, SessionStateDurable};
use crate::live::sessions::sink::{ActorBoundUpdate, SessionEventSink};

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn inject_runtime_event(
        &self,
        event: RuntimeInjectedSessionEvent,
    ) -> RuntimeEventInjectionResult {
        inject_runtime_event(&self.event_sink, &self.handle, event).await
    }
}

pub(in crate::live::sessions::actor) async fn inject_runtime_event(
    event_sink: &Arc<Mutex<SessionEventSink>>,
    handle: &Arc<LiveSessionHandle>,
    event: RuntimeInjectedSessionEvent,
) -> RuntimeEventInjectionResult {
    let touch_session_activity = event.updates_session_activity_at();
    let result = event_sink.lock().await.inject_runtime_event(event);
    if touch_session_activity {
        if let Ok(envelope) = &result {
            handle.mark_activity_at(envelope.timestamp.clone()).await;
        }
    }
    result
}

/// Applies one actor-bound update the sink handed back from `ingest`: the
/// arms that touch `SessionStateDurable` and the actor's startup state
/// (config/mode/session-info). Persists first, then emits via the sink —
/// exactly the legacy ordering.
pub(in crate::live::sessions::actor) async fn apply_actor_update(
    update: ActorBoundUpdate,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_store: &dyn SessionStateDurable,
    session_id: &str,
    source_agent_kind: &str,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) {
    match update {
        ActorBoundUpdate::CurrentMode { next_mode_id } => {
            startup_state.set_current_mode_id(next_mode_id.clone());
            set_select_option_current_value_for_purpose(
                &mut startup_state.config_options,
                ConfigPurpose::Mode,
                &next_mode_id,
            );
            let now = chrono::Utc::now().to_rfc3339();
            if startup_state.has_raw_or_legacy_mode_control() {
                emit_live_config_update(
                    source_agent_kind,
                    session_id,
                    session_store,
                    event_sink,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .map(|()| true)
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist live config after current mode update");
                    false
                })
            } else {
                persist_current_config_state_from_startup(
                    session_store,
                    event_sink,
                    session_id,
                    persisted_config_state,
                    startup_state,
                    now.clone(),
                )
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(session_id = %session_id, error = %error, "failed to persist current session state after current mode update");
                    false
                })
            };
            let payload = CurrentModeUpdatePayload {
                current_mode_id: next_mode_id,
            };
            let mut sink = event_sink.lock().await;
            sink.current_mode_update(payload);
        }
        ActorBoundUpdate::ConfigOptions(config_options) => {
            startup_state.config_options = config_options;
            if let Err(error) = emit_live_config_update(
                source_agent_kind,
                session_id,
                session_store,
                event_sink,
                persisted_config_state,
                startup_state,
                chrono::Utc::now().to_rfc3339(),
            )
            .await
            {
                tracing::warn!(session_id = %session_id, error = %error, "failed to persist config option update");
            }
        }
        ActorBoundUpdate::SessionInfo { title, updated_at } => {
            if let Some(ref t) = title {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = session_store.update_title(session_id, t, &now);
            }

            let payload = SessionInfoUpdatePayload { title, updated_at };
            let mut sink = event_sink.lock().await;
            sink.session_info_update(payload);
        }
    }
}

pub(in crate::live::sessions::actor) fn persist_raw_notification(
    events: &dyn EventPersist,
    session_id: &str,
    kind: &str,
    notif: &acp::schema::SessionNotification,
) -> anyhow::Result<()> {
    let payload_json = serde_json::to_string(notif)?;
    events.append_raw_notification(
        session_id,
        kind,
        &chrono::Utc::now().to_rfc3339(),
        &payload_json,
    )
}
