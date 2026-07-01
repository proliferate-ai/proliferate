use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::{ConfigApplyState, SessionLiveConfigSnapshot};
use tokio::sync::Mutex;

use crate::live::sessions::actor::command::SetConfigOptionCommandError;
use crate::live::sessions::actor::config::persist::{
    emit_live_config_update, persist_requested_config_value_if_changed, persisted_control_values,
};
use crate::live::sessions::actor::config::queue::config_request_matches_current_state;
use crate::live::sessions::actor::config::selection::{
    current_select_value, find_select_option_by_purpose, find_select_option_for_request,
    find_select_option_for_value, is_mode_config_request, is_model_config_request,
    option_matches_purpose, select_option_contains_value,
};
use crate::live::sessions::actor::config::types::{
    tracked_config_purpose, ConfigApplyOutcome, ConfigPurpose, PersistedSessionConfigState,
};
use crate::live::sessions::actor::state::SessionStartupState;
use crate::live::sessions::model::SessionStateDurable;
use crate::live::sessions::sink::SessionEventSink;
pub(in crate::live::sessions::actor) async fn try_apply_model_preference(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    desired_model_id: &str,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<ConfigApplyOutcome> {
    if let Some(option) =
        find_select_option_by_purpose(&startup_state.config_options, ConfigPurpose::Model)
    {
        let config_id = option.id.to_string();
        let option_contains_desired = select_option_contains_value(option, desired_model_id);
        // Create validated this model via the catalog; the harness proved it
        // launchable (probe trial), so an unadvertised id is still sent.
        let outcome = apply_select_config_option_with_policy(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            desired_model_id,
            true,
        )
        .await?;
        let will_try_direct_setter =
            outcome == ConfigApplyOutcome::NotApplied && !option_contains_desired;
        tracing::info!(
            native_session_id,
            desired_model_id,
            ?outcome,
            option_contains_desired,
            will_try_direct_setter,
            has_direct_model_control = startup_state.has_direct_model_control(),
            "[config-switch] model preference via config option"
        );
        if will_try_direct_setter {
            return apply_model_via_direct_setter(
                conn,
                native_session_id,
                startup_state,
                desired_model_id,
            )
            .await;
        }
        // NOTE(switch-diagnostics): when a model option exists but rejected a
        // foreign (catalog) value, there is no direct-setter fallback here —
        // candidate cause of "model doesn't stick" for adapters that expose a
        // model config option (e.g. Claude).
        return Ok(outcome);
    }

    apply_model_via_direct_setter(conn, native_session_id, startup_state, desired_model_id).await
}

pub(in crate::live::sessions::actor) async fn try_apply_config_option(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    purpose: ConfigPurpose,
    desired_value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    if purpose == ConfigPurpose::Model {
        let Some(option) =
            find_select_option_by_purpose(&startup_state.config_options, ConfigPurpose::Model)
        else {
            return Ok(ConfigApplyOutcome::NotApplied);
        };
        let config_id = option.id.to_string();
        return apply_select_config_option(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            desired_value,
        )
        .await;
    }

    let Some(option) =
        find_select_option_for_value(&startup_state.config_options, purpose, desired_value)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };

    let config_id = option.id.to_string();
    apply_select_config_option(
        conn,
        native_session_id,
        startup_state,
        &config_id,
        desired_value,
    )
    .await
}

pub(in crate::live::sessions::actor) async fn apply_select_config_option(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    apply_select_config_option_with_policy(
        conn,
        native_session_id,
        startup_state,
        config_id,
        desired_value,
        false,
    )
    .await
}

/// `allow_foreign_value`: send a value the option does not advertise (model
/// switches authorized by the catalog, startup model preferences proven by
/// the probe). The post-set verification below still decides the outcome —
/// `AppliedAuthoritative` only when the harness confirms the value, so a
/// refusing adapter degrades to `NotApplied`, never to a lie.
pub(in crate::live::sessions::actor) async fn apply_select_config_option_with_policy(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
    allow_foreign_value: bool,
) -> anyhow::Result<ConfigApplyOutcome> {
    let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };

    if !select_option_contains_value(option, desired_value) && !allow_foreign_value {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    if current_select_value(option).as_deref() == Some(desired_value) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    let response = conn
        .send_request(acp::schema::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            desired_value,
        ))
        .block_task()
        .await?;

    startup_state.config_options = response.config_options;

    if select_option_current_value_matches(&startup_state.config_options, config_id, desired_value)
    {
        Ok(ConfigApplyOutcome::AppliedAuthoritative)
    } else {
        Ok(ConfigApplyOutcome::NotApplied)
    }
}

pub(in crate::live::sessions::actor) async fn apply_specific_config_option(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
    catalog_authorized_model: bool,
) -> Result<ConfigApplyState, SetConfigOptionCommandError> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);
    let tracked_purpose = tracked_config_purpose(config_id, option);
    let model_value_authorized = is_model_request && catalog_authorized_model;

    if option.is_none() && !is_model_request && !is_mode_request {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' is not exposed by the active session."
        )));
    }

    if let Some(option) = option {
        if !select_option_contains_value(option, desired_value)
            && !model_value_authorized
            && (!is_mode_request || !startup_state.legacy_mode_contains_value(desired_value))
        {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{desired_value}' is not valid for config option '{config_id}'."
            )));
        }
    }

    if is_model_request
        && option.is_none()
        && !model_value_authorized
        && !should_apply_model_via_direct_setter(startup_state, desired_value)
    {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Value '{desired_value}' is not valid for config option '{config_id}'."
        )));
    }

    // Captured before the &mut apply below to avoid holding `option`'s borrow.
    let value_in_live_option = option
        .map(|option| select_option_contains_value(option, desired_value))
        .unwrap_or(false);
    let outcome = apply_config_option_if_possible_with_policy(
        conn,
        native_session_id,
        startup_state,
        config_id,
        desired_value,
        model_value_authorized,
    )
    .await
    .map_err(|error| {
        SetConfigOptionCommandError::Rejected(format!(
            "Failed to update config option '{config_id}' to '{desired_value}': {error}"
        ))
    })?;
    tracing::info!(
        native_session_id,
        config_id,
        desired_value,
        is_model_request,
        is_mode_request,
        value_in_live_option,
        ?outcome,
        "[config-switch] apply_specific outcome"
    );
    if outcome == ConfigApplyOutcome::NotApplied {
        if config_request_matches_current_state(startup_state, config_id, desired_value) {
            persist_requested_config_value_if_changed(
                store,
                event_sink,
                session_id,
                persisted_config_state,
                tracked_purpose,
                desired_value,
                chrono::Utc::now().to_rfc3339(),
            )
            .await
            .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;
            return Ok(ConfigApplyState::Applied);
        }

        if is_mode_request && !startup_state.legacy_mode_contains_value(desired_value) {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{desired_value}' is not valid for config option '{config_id}'."
            )));
        }

        if let Some(option) =
            find_select_option_for_request(&startup_state.config_options, config_id)
        {
            if !select_option_contains_value(option, desired_value) && !is_model_request {
                return Err(SetConfigOptionCommandError::Rejected(format!(
                    "Value '{desired_value}' is not valid for config option '{config_id}'."
                )));
            }
        }

        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' did not apply value '{desired_value}'."
        )));
    }

    persist_requested_config_value_if_changed(
        store,
        event_sink,
        session_id,
        persisted_config_state,
        tracked_purpose,
        desired_value,
        chrono::Utc::now().to_rfc3339(),
    )
    .await
    .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;

    if outcome == ConfigApplyOutcome::AppliedAuthoritative {
        emit_live_config_update(
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        .map_err(|error| SetConfigOptionCommandError::Rejected(error.to_string()))?;
    }

    Ok(ConfigApplyState::Applied)
}

pub(in crate::live::sessions::actor) async fn restore_persisted_live_config_if_needed(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &dyn SessionStateDurable,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    persisted_snapshot: Option<&SessionLiveConfigSnapshot>,
) -> anyhow::Result<()> {
    let Some(snapshot) = persisted_snapshot else {
        return Ok(());
    };
    let desired = persisted_control_values(&snapshot.normalized_controls);
    if desired.is_empty() {
        return Ok(());
    }

    let mut changed = false;
    for (_, config_id, value) in desired {
        if apply_config_option_if_possible(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            &value,
        )
        .await?
            == ConfigApplyOutcome::AppliedAuthoritative
        {
            changed = true;
        }
    }

    if changed {
        emit_live_config_update(
            source_agent_kind,
            session_id,
            store,
            event_sink,
            persisted_config_state,
            startup_state,
            chrono::Utc::now().to_rfc3339(),
        )
        .await?;
    }

    Ok(())
}

pub(in crate::live::sessions::actor) async fn apply_config_option_if_possible(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    apply_config_option_if_possible_with_policy(
        conn,
        native_session_id,
        startup_state,
        config_id,
        desired_value,
        false,
    )
    .await
}

pub(in crate::live::sessions::actor) async fn apply_config_option_if_possible_with_policy(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
    model_value_authorized: bool,
) -> anyhow::Result<ConfigApplyOutcome> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    if let Some(option) = option {
        if current_select_value(option).as_deref() == Some(desired_value) {
            return Ok(ConfigApplyOutcome::NoChange);
        }

        if is_model_request {
            if !select_option_contains_value(option, desired_value) && !model_value_authorized {
                return Ok(ConfigApplyOutcome::NotApplied);
            }
            let option_id = option.id.to_string();
            return apply_select_config_option_with_policy(
                conn,
                native_session_id,
                startup_state,
                &option_id,
                desired_value,
                model_value_authorized,
            )
            .await;
        }

        if !select_option_contains_value(option, desired_value) && is_mode_request {
            return apply_mode_via_direct_setter_legacy(
                conn,
                native_session_id,
                startup_state,
                desired_value,
            )
            .await;
        }

        if !select_option_contains_value(option, desired_value) {
            return Ok(ConfigApplyOutcome::NotApplied);
        }
    } else if is_model_request {
        return apply_model_via_direct_setter(
            conn,
            native_session_id,
            startup_state,
            desired_value,
        )
        .await;
    } else if is_mode_request {
        return apply_mode_via_direct_setter_legacy(
            conn,
            native_session_id,
            startup_state,
            desired_value,
        )
        .await;
    }

    let response = conn
        .send_request(acp::schema::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            desired_value,
        ))
        .block_task()
        .await?;
    startup_state.config_options = response.config_options;
    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

/// Wire method for the legacy `session/set_model` RPC. ACP 0.14 dropped the
/// typed `SetSessionModelRequest`, but harnesses that predate the
/// model-as-config-option migration (e.g. Gemini CLI, via its
/// `unstable_setSessionModel` handler) still listen on this method. We reach it
/// through ACP's extension-method channel: the method string is serialized
/// verbatim, so the lack of a `_` prefix (which only gates *inbound* ext
/// routing) is irrelevant on the outbound path.
const ACP_SET_SESSION_MODEL_METHOD: &str = "session/set_model";

/// Switch the model on a session whose harness exposes no `model` config option
/// (so `set_session_config_option` has no target). Mirrors
/// [`apply_mode_via_direct_setter_legacy`], but the typed request was removed in
/// ACP 0.14, so we send the legacy `session/set_model` as an extension method.
/// The agent is the sole authority: a rejection comes back as an error and
/// surfaces cleanly (the session stays Idle, the connection intact).
pub(in crate::live::sessions::actor) async fn apply_model_via_direct_setter(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    desired_model_id: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    if startup_state.current_model_id.as_deref() == Some(desired_model_id) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    if !should_apply_model_via_direct_setter(startup_state, desired_model_id) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    // Params mirror acp.SetSessionModelRequest: { sessionId, modelId }.
    let params: Arc<serde_json::value::RawValue> =
        serde_json::value::to_raw_value(&serde_json::json!({
            "sessionId": native_session_id,
            "modelId": desired_model_id,
        }))?
        .into();
    let ext = acp::schema::ExtRequest::new(ACP_SET_SESSION_MODEL_METHOD, params);
    tracing::info!(
        method = ACP_SET_SESSION_MODEL_METHOD,
        native_session_id,
        model_id = desired_model_id,
        "[model-switch] sending session/set_model"
    );
    let response = match conn
        .send_request(acp::AgentRequest::ExtMethodRequest(ext))
        .block_task()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(
                native_session_id,
                model_id = desired_model_id,
                error = %error,
                "[model-switch] agent rejected session/set_model"
            );
            return Err(error.into());
        }
    };
    tracing::info!(
        native_session_id,
        model_id = desired_model_id,
        response = %response,
        "[model-switch] agent accepted session/set_model"
    );

    startup_state.current_model_id = Some(desired_model_id.to_string());
    set_select_option_current_value_for_purpose(
        &mut startup_state.config_options,
        ConfigPurpose::Model,
        desired_model_id,
    );

    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

pub(in crate::live::sessions::actor) fn should_apply_model_via_direct_setter(
    startup_state: &SessionStartupState,
    _desired_model_id: &str,
) -> bool {
    // Attempt the legacy `session/set_model` only when the harness reports no live
    // model control at all. ACP 0.14 drops the legacy models block, so Gemini-style
    // harnesses surface neither a `model` config option nor `available_models` — the
    // write cannot be gated locally, and the agent is the sole authority on validity.
    // When a live model list IS present, membership is enforced upstream; don't
    // override that.
    !startup_state.has_direct_model_control()
}

pub(in crate::live::sessions::actor) async fn apply_mode_via_direct_setter_legacy(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    desired_mode_id: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    if startup_state.current_mode_id.as_deref() == Some(desired_mode_id) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    if !startup_state.legacy_mode_contains_value(desired_mode_id) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }

    conn.send_request(acp::schema::SetSessionModeRequest::new(
        native_session_id.to_string(),
        desired_mode_id.to_string(),
    ))
    .block_task()
    .await?;

    startup_state.set_current_mode_id(desired_mode_id.to_string());
    set_select_option_current_value_for_purpose(
        &mut startup_state.config_options,
        ConfigPurpose::Mode,
        desired_mode_id,
    );

    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

pub(in crate::live::sessions::actor) fn set_select_option_current_value_for_purpose(
    config_options: &mut [acp::schema::SessionConfigOption],
    purpose: ConfigPurpose,
    desired_value: &str,
) -> bool {
    let Some(option) = config_options
        .iter_mut()
        .find(|option| option_matches_purpose(option, purpose))
    else {
        return false;
    };

    let acp::schema::SessionConfigKind::Select(select) = &mut option.kind else {
        return false;
    };

    select.current_value = desired_value.to_string().into();
    true
}

pub(in crate::live::sessions::actor) fn select_option_current_value_matches(
    config_options: &[acp::schema::SessionConfigOption],
    config_id: &str,
    desired_value: &str,
) -> bool {
    find_select_option_for_request(config_options, config_id)
        .and_then(current_select_value)
        .as_deref()
        .is_some_and(|current| current == desired_value)
}
