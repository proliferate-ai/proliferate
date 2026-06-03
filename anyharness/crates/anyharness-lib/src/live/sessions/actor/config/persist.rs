use std::sync::Arc;

use anyharness_contract::v1::{
    ConfigOptionUpdatePayload, CurrentModeUpdatePayload, NormalizedSessionControl,
    SessionLiveConfigSnapshot,
};
use tokio::sync::Mutex;

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::live_config::{
    build_live_config_snapshot, normalized_key_rank, snapshot_from_record, snapshot_to_record,
    NormalizedControlKind,
};
use crate::domains::sessions::store::SessionStore;
use crate::live::sessions::actor::config::types::{ConfigPurpose, PersistedSessionConfigState};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::event_sink::SessionEventSink;
pub(in crate::live::sessions::actor) async fn persist_session_config_state_if_changed(
    store: &SessionStore,
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
    store: &SessionStore,
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
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    session_id: &str,
    state: &mut PersistedSessionConfigState,
    startup_state: &SessionStartupState,
    updated_at: String,
) -> anyhow::Result<bool> {
    let mut next = state.clone();
    next.current_model_id = startup_state.current_model_id.clone();
    next.current_mode_id = startup_state.current_mode_id.clone();

    persist_session_config_state_if_changed(store, event_sink, session_id, state, next, updated_at)
        .await
}

pub(in crate::live::sessions::actor) async fn emit_live_config_update(
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
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
    store: &SessionStore,
    session_id: &str,
    source_agent_kind: &str,
    resumes_durable_history: bool,
) -> anyhow::Result<Option<SessionLiveConfigSnapshot>> {
    if !resumes_durable_history || source_agent_kind != AgentKind::Claude.as_str() {
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

pub(in crate::live::sessions::actor) fn persisted_control_values(
    controls: &anyharness_contract::v1::NormalizedSessionControls,
) -> Vec<(usize, String, String)> {
    let mut values = Vec::new();
    push_persisted_control(
        &mut values,
        controls.model.as_ref(),
        NormalizedControlKind::Model,
    );
    push_persisted_control(
        &mut values,
        controls.collaboration_mode.as_ref(),
        NormalizedControlKind::CollaborationMode,
    );
    push_persisted_control(
        &mut values,
        controls.mode.as_ref(),
        NormalizedControlKind::Mode,
    );
    push_persisted_control(
        &mut values,
        controls.reasoning.as_ref(),
        NormalizedControlKind::Reasoning,
    );
    push_persisted_control(
        &mut values,
        controls.effort.as_ref(),
        NormalizedControlKind::Effort,
    );
    push_persisted_control(
        &mut values,
        controls.fast_mode.as_ref(),
        NormalizedControlKind::FastMode,
    );
    values.extend(controls.extras.iter().filter_map(|control| {
        control.current_value.as_ref().map(|value| {
            (
                normalized_key_rank(NormalizedControlKind::Extra),
                control.raw_config_id.clone(),
                value.clone(),
            )
        })
    }));
    values.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    values
}

pub(in crate::live::sessions::actor) fn push_persisted_control(
    values: &mut Vec<(usize, String, String)>,
    control: Option<&NormalizedSessionControl>,
    kind: NormalizedControlKind,
) {
    let Some(control) = control else {
        return;
    };
    let Some(current_value) = control.current_value.as_ref() else {
        return;
    };

    values.push((
        normalized_key_rank(kind),
        control.raw_config_id.clone(),
        current_value.clone(),
    ));
}
