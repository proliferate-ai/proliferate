use std::sync::Arc;

use anyharness_contract::v1::{
    ConfigOptionUpdatePayload, CurrentModeUpdatePayload, SessionLiveConfigSnapshot,
};
use tokio::sync::Mutex;

use crate::domains::sessions::live_config::{
    build_live_config_snapshot, snapshot_from_record, snapshot_to_record,
    validate_canonical_live_config_current,
};
use crate::live::sessions::actor::config::types::{ConfigPurpose, PersistedSessionConfigState};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::model::SessionStateDurable;
use crate::live::sessions::sink::SessionEventSink;
pub(in crate::live::sessions::actor) async fn persist_session_config_state_if_changed(
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    next: PersistedSessionConfigState,
    updated_at: String,
) -> anyhow::Result<bool> {
    let requested_changed = state.requested_model_id != next.requested_model_id
        || state.requested_mode_id != next.requested_mode_id;
    let current_changed = state.current_model_id != next.current_model_id
        || state.current_mode_id != next.current_mode_id;

    if !requested_changed && !current_changed {
        return Ok(false);
    }

    if requested_changed {
        store.update_requested_configuration(
            session_id,
            next.requested_model_id.as_deref(),
            next.requested_mode_id.as_deref(),
            &updated_at,
        )?;
    }

    if current_changed {
        store.update_current_configuration(
            session_id,
            next.current_model_id.as_deref(),
            next.current_mode_id.as_deref(),
            &updated_at,
        )?;
    }

    *state = next.clone();

    let mut sink = event_sink.lock().await;
    sink.session_state_update(next.to_event_payload());
    Ok(true)
}

pub(in crate::live::sessions::actor) async fn persist_requested_config_value_if_changed(
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    purpose: Option<ConfigPurpose>,
    desired_value: &str,
    updated_at: String,
) -> anyhow::Result<bool> {
    let Some(purpose) = purpose else {
        return Ok(false);
    };

    let mut next = state.clone();
    match purpose {
        ConfigPurpose::Model => next.requested_model_id = Some(desired_value.to_string()),
        ConfigPurpose::Mode => next.requested_mode_id = Some(desired_value.to_string()),
    }

    persist_session_config_state_if_changed(store, event_sink, session_id, state, next, updated_at)
        .await
}

pub(in crate::live::sessions::actor) async fn persist_current_config_state_from_startup(
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    startup_state: &SessionStartupState,
    updated_at: String,
) -> anyhow::Result<bool> {
    let mut next = state.clone();
    // Only an OBSERVED value overwrites: a harness that exposes no model or
    // mode must not null out the selection the session was created or
    // switched with — that selection is what the launch env applied.
    if startup_state.current_model_id.is_some() {
        next.current_model_id = startup_state.current_model_id.clone();
    }
    if startup_state.current_mode_id.is_some() {
        next.current_mode_id = startup_state.current_mode_id.clone();
    }

    persist_session_config_state_if_changed(store, event_sink, session_id, state, next, updated_at)
        .await
}

pub(in crate::live::sessions::actor) async fn emit_live_config_update(
    source_agent_kind: &str,
    session_id: &str,
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    updated_at: String,
) -> anyhow::Result<()> {
    let next_seq = {
        let sink = event_sink.lock().await;
        sink.next_seq()
    };
    let snapshot = build_live_config_snapshot(
        source_agent_kind,
        &startup_state.config_options,
        startup_state.current_model_id.as_deref(),
        &startup_state.available_models,
        startup_state.legacy_mode_state.as_ref(),
        startup_state.prompt_capabilities,
        next_seq,
        updated_at.clone(),
    );
    validate_canonical_live_config_current(&snapshot)?;
    let source_seq = snapshot.source_seq;
    let current_control_keys = snapshot
        .current
        .control_values
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let current_model_present = snapshot.current.model_id.is_some();
    if let Some(model_id) = snapshot
        .normalized_controls
        .model
        .as_ref()
        .and_then(|control| control.current_value.clone())
    {
        startup_state.current_model_id = Some(model_id);
    }
    if let Some(mode_id) = snapshot
        .normalized_controls
        .mode
        .as_ref()
        .and_then(|control| control.current_value.clone())
    {
        startup_state.current_mode_id = Some(mode_id);
    }

    store.upsert_live_config_snapshot(&snapshot_to_record(session_id, &snapshot)?)?;
    tracing::info!(
        session_id,
        harness_kind = source_agent_kind,
        source_seq,
        current_model_present,
        current_control_keys = ?current_control_keys,
        event = "session.live_config.changed",
        "persisted a higher-sequence full live configuration snapshot"
    );
    persist_current_config_state_from_startup(
        store,
        event_sink,
        session_id,
        persisted_config_state,
        startup_state,
        updated_at.clone(),
    )
    .await?;

    let mut sink = event_sink.lock().await;
    sink.config_option_update(ConfigOptionUpdatePayload {
        live_config: snapshot,
    });
    Ok(())
}

pub(in crate::live::sessions::actor) fn load_startup_restore_snapshot(
    store: &dyn SessionStateDurable,
    session_id: &str,
    resumes_durable_history: bool,
) -> anyhow::Result<Option<SessionLiveConfigSnapshot>> {
    if !resumes_durable_history {
        return Ok(None);
    }

    store
        .find_live_config_snapshot(session_id)?
        .map(|record| snapshot_from_record(&record))
        .transpose()
}

pub(in crate::live::sessions::actor) fn emit_startup_state(
    sink: &mut SessionEventSink,
    startup_state: &SessionStartupState,
) {
    if let Some(current_mode_id) = &startup_state.current_mode_id {
        sink.current_mode_update(CurrentModeUpdatePayload {
            current_mode_id: current_mode_id.clone(),
        });
    }
}

/// Shared startup-stage logging for `emit_live_config_update`/
/// `restore_persisted_live_config_if_needed` call sites: a failed call logs
/// both a short warning and the `[workspace-latency]` failure record; success
/// logs the matching completion record. `stage` names the metric
/// (`session.actor.<stage>.{failed,completed}`).
pub(in crate::live::sessions::actor) fn log_config_stage_result<E: std::fmt::Display>(
    session_id: &str,
    workspace_id: &str,
    result: &Result<(), E>,
    elapsed: std::time::Duration,
    short_failure_message: &str,
    stage: &str,
) {
    match result {
        Err(error) => {
            tracing::warn!(session_id = %session_id, error = %error, "{}", short_failure_message);
            tracing::warn!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                error = %error,
                elapsed_ms = elapsed.as_millis(),
                "[workspace-latency] session.actor.{}.failed",
                stage
            );
        }
        Ok(()) => {
            tracing::info!(
                session_id = %session_id,
                workspace_id = %workspace_id,
                elapsed_ms = elapsed.as_millis(),
                "[workspace-latency] session.actor.{}.completed",
                stage
            );
        }
    }
}
