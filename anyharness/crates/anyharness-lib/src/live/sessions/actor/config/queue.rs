use std::sync::Arc;

use agent_client_protocol as acp;
use tokio::sync::Mutex;

use crate::live::sessions::actor::command::SetConfigOptionCommandError;
use crate::live::sessions::actor::config::apply::apply_specific_config_option;
use crate::live::sessions::actor::config::selection::{
    current_select_value, find_select_option_for_request, is_mode_config_request,
    is_model_config_request, pending_config_rank, select_option_contains_value,
};
use crate::live::sessions::actor::config::types::PersistedSessionConfigState;
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::event_sink::SessionEventSink;
use crate::sessions::model::PendingConfigChangeRecord;
use crate::sessions::store::SessionStore;
pub(in crate::live::sessions::actor) fn queue_pending_config_change(
    store: &SessionStore,
    session_id: &str,
    startup_state: &SessionStartupState,
    config_id: &str,
    value: &str,
) -> Result<(), SetConfigOptionCommandError> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' is not exposed by the active session."
        )));
    }

    if let Some(option) = option {
        if !select_option_contains_value(option, value)
            && (!is_mode_request || !startup_state.legacy_mode_contains_value(value))
        {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{value}' is not valid for config option '{config_id}'."
            )));
        }
    }

    if is_mode_request && !startup_state.legacy_mode_contains_value(value) {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Value '{value}' is not valid for config option '{config_id}'."
        )));
    }

    let queued_at = chrono::Utc::now().to_rfc3339();
    store
        .upsert_pending_config_change(&PendingConfigChangeRecord {
            session_id: session_id.to_string(),
            config_id: config_id.to_string(),
            value: value.to_string(),
            queued_at,
        })
        .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))
}

pub(in crate::live::sessions::actor) fn config_request_matches_current_state(
    startup_state: &SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> bool {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    option
        .and_then(current_select_value)
        .as_deref()
        .is_some_and(|current| current == desired_value)
        || (is_model_request && startup_state.current_model_id.as_deref() == Some(desired_value))
        || (is_mode_request && startup_state.current_mode_id.as_deref() == Some(desired_value))
}

pub(in crate::live::sessions::actor) async fn apply_pending_config_changes_if_idle(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    let mut pending = store.list_pending_config_changes(session_id)?;
    pending.sort_by_key(|change| pending_config_rank(startup_state, &change.config_id));

    for change in pending {
        let result = apply_specific_config_option(
            conn,
            native_session_id,
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            &change.config_id,
            &change.value,
        )
        .await;

        match result {
            Ok(_) => {
                store.delete_pending_config_change(session_id, &change.config_id)?;
            }
            Err(SetConfigOptionCommandError::Rejected(_)) => {
                store.delete_pending_config_change(session_id, &change.config_id)?;
            }
        }
    }

    Ok(())
}
