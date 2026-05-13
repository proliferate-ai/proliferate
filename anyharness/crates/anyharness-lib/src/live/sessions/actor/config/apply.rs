use crate::live::sessions::actor::*;
pub(in crate::live::sessions::actor) async fn try_apply_model_preference(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    desired_model_id: &str,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<ConfigApplyOutcome> {
    if let Some(option) =
        find_select_option_by_purpose(&startup_state.config_options, ConfigPurpose::Model)
    {
        let config_id = option.id.to_string();
        return apply_select_config_option(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            desired_model_id,
        )
        .await;
    }

    apply_model_via_direct_setter(conn, native_session_id, startup_state, desired_model_id).await
}

pub(in crate::live::sessions::actor) async fn try_apply_config_option(
    conn: &acp::ClientSideConnection,
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
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };

    if current_select_value(option).as_deref() == Some(desired_value) {
        return Ok(ConfigApplyOutcome::NoChange);
    }

    let response = conn
        .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            desired_value,
        ))
        .await?;

    startup_state.config_options = response.config_options;

    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

pub(in crate::live::sessions::actor) async fn apply_specific_config_option(
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
    event_sink: &Arc<Mutex<SessionEventSink>>,
    persisted_config_state: &mut PersistedSessionConfigState,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> Result<ConfigApplyState, SetConfigOptionCommandError> {
    let option = find_select_option_for_request(&startup_state.config_options, config_id);
    let is_model_request = is_model_config_request(config_id, option);
    let is_mode_request = is_mode_config_request(config_id, option);
    let tracked_purpose = tracked_config_purpose(config_id, option);

    if option.is_none() && !is_model_request && !is_mode_request {
        return Err(SetConfigOptionCommandError::Rejected(format!(
            "Config option '{config_id}' is not exposed by the active session."
        )));
    }

    if let Some(option) = option {
        if !select_option_contains_value(option, desired_value)
            && !is_model_request
            && !is_mode_request
        {
            return Err(SetConfigOptionCommandError::Rejected(format!(
                "Value '{desired_value}' is not valid for config option '{config_id}'."
            )));
        }
    }

    let outcome = apply_config_option_if_possible(
        conn,
        native_session_id,
        startup_state,
        config_id,
        desired_value,
    )
    .await
    .map_err(|error| {
        SetConfigOptionCommandError::Rejected(format!(
            "Failed to update config option '{config_id}' to '{desired_value}': {error}"
        ))
    })?;
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
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    source_agent_kind: &str,
    session_id: &str,
    store: &SessionStore,
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
    conn: &acp::ClientSideConnection,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    desired_value: &str,
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
            let option_id = option.id.to_string();
            return apply_select_config_option(
                conn,
                native_session_id,
                startup_state,
                &option_id,
                desired_value,
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
        .set_session_config_option(acp::SetSessionConfigOptionRequest::new(
            native_session_id.to_string(),
            config_id.to_string(),
            desired_value,
        ))
        .await?;
    startup_state.config_options = response.config_options;
    Ok(ConfigApplyOutcome::AppliedAuthoritative)
}

pub(in crate::live::sessions::actor) async fn apply_model_via_direct_setter(
    conn: &acp::ClientSideConnection,
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

    conn.set_session_model(acp::SetSessionModelRequest::new(
        native_session_id.to_string(),
        desired_model_id.to_string(),
    ))
    .await?;

    Ok(ConfigApplyOutcome::RequestedOnly)
}

pub(in crate::live::sessions::actor) fn should_apply_model_via_direct_setter(
    startup_state: &SessionStartupState,
    desired_model_id: &str,
) -> bool {
    startup_state.available_model_ids.is_empty()
        || startup_state
            .available_model_ids
            .iter()
            .any(|id| id == desired_model_id)
}

pub(in crate::live::sessions::actor) async fn apply_mode_via_direct_setter_legacy(
    conn: &acp::ClientSideConnection,
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

    conn.set_session_mode(acp::SetSessionModeRequest::new(
        native_session_id.to_string(),
        desired_mode_id.to_string(),
    ))
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
    config_options: &mut [acp::SessionConfigOption],
    purpose: ConfigPurpose,
    desired_value: &str,
) -> bool {
    let Some(option) = config_options
        .iter_mut()
        .find(|option| option_matches_purpose(option, purpose))
    else {
        return false;
    };

    let acp::SessionConfigKind::Select(select) = &mut option.kind else {
        return false;
    };

    select.current_value = desired_value.to_string().into();
    true
}
