use agent_client_protocol as acp;

use crate::live::sessions::actor::config::selection::{
    current_select_value, find_select_option_for_request, is_mode_config_request,
    is_model_config_request,
};
use crate::live::sessions::actor::config::types::ConfigApplyOutcome;
use crate::live::sessions::actor::state::SessionStartupState;

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

pub(in crate::live::sessions::actor) fn config_value_matches_current_state(
    startup_state: &SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> bool {
    if let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id) {
        return current_select_value(option).as_deref() == Some(desired_value);
    }

    if is_model_config_request(config_id, None) {
        return startup_state.current_model_id.as_deref() == Some(desired_value);
    }
    if is_mode_config_request(config_id, None) {
        return startup_state.current_mode_id.as_deref() == Some(desired_value);
    }

    false
}

pub(in crate::live::sessions::actor) fn ensure_config_values_confirmed(
    startup_state: &SessionStartupState,
    desired: &[(usize, String, String)],
    value_source: &str,
) -> anyhow::Result<()> {
    for (_, config_id, value) in desired {
        anyhow::ensure!(
            config_value_matches_current_state(startup_state, config_id, value),
            "{value_source} control '{config_id}' final value does not equal '{value}'"
        );
    }
    Ok(())
}

pub(in crate::live::sessions::actor) fn select_setter_response_outcome(
    startup_state: &SessionStartupState,
    config_id: &str,
    desired_value: &str,
) -> ConfigApplyOutcome {
    if config_value_matches_current_state(startup_state, config_id, desired_value) {
        ConfigApplyOutcome::AppliedAuthoritative
    } else {
        ConfigApplyOutcome::NotApplied
    }
}
