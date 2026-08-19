use agent_client_protocol as acp;
use anyharness_contract::v1::ConfigApplyState;

use crate::domains::sessions::launch_intent::ResolvedLaunchIntent;
use crate::live::sessions::actor::config::apply::{
    apply_mode_via_direct_setter_legacy, apply_specific_config_option, try_apply_model_preference,
};
use crate::live::sessions::actor::config::confirmation::config_value_matches_current_state;
use crate::live::sessions::actor::config::persist::persist_requested_config_value_if_changed;
use crate::live::sessions::actor::config::queue::queue_pending_config_change;
use crate::live::sessions::actor::config::selection::{
    find_select_option_by_purpose, find_select_option_for_request, select_option_values,
};
use crate::live::sessions::actor::config::types::{
    tracked_config_purpose, ConfigApplyOutcome, ConfigPurpose,
};
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};

/// Applies the immutable create-time intent and accepts only a value that the
/// live harness statement both advertises and positively confirms. Model is
/// first; controls follow the harness-advertised order.
pub(in crate::live::sessions::actor) async fn apply_resolved_launch_intent(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    session_id: &str,
    agent_kind: &str,
    intent: &ResolvedLaunchIntent,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    if let Some(model_id) = intent.model_id.as_deref() {
        if !live_model_ids(startup_state).iter().any(|value| value == model_id) {
            log_initial_config_apply(session_id, agent_kind, "model", "membership_rejected");
            anyhow::bail!("requested model '{model_id}' is absent from the live {agent_kind} session");
        }
        let outcome = match try_apply_model_preference(
            conn,
            native_session_id,
            model_id,
            startup_state,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, "model", "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            "model",
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested model '{model_id}' was not confirmed by the live {agent_kind} session"
        );
    }

    let mut pending = intent.control_values.clone();
    let ordered_ids = startup_state
        .config_options
        .iter()
        .map(|option| option.id.to_string())
        .collect::<Vec<_>>();
    for config_id in ordered_ids {
        let Some(value) = pending.remove(&config_id) else {
            continue;
        };
        let outcome = match try_apply_config_option_by_id(
            conn,
            native_session_id,
            startup_state,
            &config_id,
            &value,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, &config_id, "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            &config_id,
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested control '{config_id}' value '{value}' was not confirmed by the live {agent_kind} session"
        );
    }

    // ACP's legacy mode surface has no config-option row but is still an exact
    // live statement and can positively confirm through set_mode/read-back.
    if let Some(value) = pending.remove("mode") {
        if !startup_state.legacy_mode_contains_value(&value) {
            log_initial_config_apply(session_id, agent_kind, "mode", "membership_rejected");
            anyhow::bail!("requested control 'mode' value '{value}' is absent from the live {agent_kind} session");
        }
        let outcome = match apply_mode_via_direct_setter_legacy(
            conn,
            native_session_id,
            startup_state,
            &value,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                log_initial_config_apply(session_id, agent_kind, "mode", "apply_failed");
                return Err(error);
            }
        };
        log_initial_config_apply(
            session_id,
            agent_kind,
            "mode",
            confirmed_result_code(outcome),
        );
        anyhow::ensure!(
            matches!(outcome, ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative),
            "requested control 'mode' value '{value}' was not confirmed by the live {agent_kind} session"
        );
    }
    anyhow::ensure!(
        pending.is_empty(),
        "requested controls are absent from the live {agent_kind} session: {:?}",
        pending.keys().collect::<Vec<_>>()
    );
    if let Err(error) = ensure_resolved_launch_intent_confirmed(startup_state, intent) {
        log_initial_config_apply(session_id, agent_kind, "complete_intent", "final_mismatch");
        return Err(error);
    }
    tracing::info!(
        harness = agent_kind,
        selected_model = intent.model_id.is_some(),
        selected_control_count = intent.control_values.len(),
        event = "session.launch_intent.confirmed",
        "confirmed every explicit launch intent value"
    );
    Ok(())
}

pub(in crate::live::sessions::actor) fn ensure_resolved_launch_intent_confirmed(
    startup_state: &SessionStartupState,
    intent: &ResolvedLaunchIntent,
) -> anyhow::Result<()> {
    if let Some(model_id) = intent.model_id.as_deref() {
        anyhow::ensure!(
            config_value_matches_current_state(startup_state, "model", model_id),
            "final live model does not equal requested model '{model_id}'"
        );
    }
    for (config_id, value) in &intent.control_values {
        anyhow::ensure!(
            config_value_matches_current_state(startup_state, config_id, value),
            "final live control '{config_id}' does not equal requested value '{value}'"
        );
    }
    Ok(())
}

fn confirmed_result_code(outcome: ConfigApplyOutcome) -> &'static str {
    match outcome {
        ConfigApplyOutcome::NoChange | ConfigApplyOutcome::AppliedAuthoritative => "confirmed",
        ConfigApplyOutcome::AppliedRequested => "unconfirmed",
        ConfigApplyOutcome::NotApplied => "membership_rejected",
    }
}

fn log_initial_config_apply(
    session_id: &str,
    agent_kind: &str,
    requested_key: &str,
    result_code: &str,
) {
    tracing::info!(
        session_id,
        harness_kind = agent_kind,
        requested_key,
        result_code,
        event = "session.initial_config.apply",
        "initial session configuration apply result"
    );
}

async fn try_apply_config_option_by_id(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    startup_state: &mut SessionStartupState,
    config_id: &str,
    value: &str,
) -> anyhow::Result<ConfigApplyOutcome> {
    let Some(option) = find_select_option_for_request(&startup_state.config_options, config_id)
    else {
        return Ok(ConfigApplyOutcome::NotApplied);
    };
    if !select_option_values(option).iter().any(|candidate| candidate == value) {
        return Ok(ConfigApplyOutcome::NotApplied);
    }
    crate::live::sessions::actor::config::apply::apply_select_config_option(
        conn,
        native_session_id,
        startup_state,
        config_id,
        value,
    )
    .await
}

fn live_model_ids(startup_state: &SessionStartupState) -> Vec<String> {
    if let Some(option) =
        find_select_option_by_purpose(&startup_state.config_options, ConfigPurpose::Model)
    {
        let values = select_option_values(option);
        if !values.is_empty() {
            return values;
        }
    }

    startup_state
        .available_models
        .iter()
        .map(|model| model.id.clone())
        .collect()
}

impl SessionActor {
    pub(in crate::live::sessions::actor) async fn handle_idle_config_command(
        &mut self,
        config_id: &str,
        value: &str,
        catalog_authorized_model: bool,
    ) -> Result<ConfigApplyState, crate::live::sessions::actor::command::SetConfigOptionCommandError>
    {
        if !self.event_mutations_admitted().await {
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    "terminal transaction unresolved".to_string(),
                ),
            );
        }
        apply_specific_config_option(
            &self.conn,
            &self.native_session_id,
            &self.agent_kind,
            &self.session_id,
            self.caps.state.as_ref(),
            &self.event_sink,
            &mut self.persisted_config_state,
            &mut self.startup_state,
            config_id,
            value,
            catalog_authorized_model,
        )
        .await
    }

    pub(in crate::live::sessions::actor) async fn handle_busy_config_command(
        &mut self,
        config_id: &str,
        value: &str,
        catalog_authorized_model: bool,
    ) -> Result<ConfigApplyState, crate::live::sessions::actor::command::SetConfigOptionCommandError>
    {
        if !self.event_mutations_admitted().await {
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    "terminal transaction unresolved".to_string(),
                ),
            );
        }
        let resolved_value = queue_pending_config_change(
            self.caps.state.as_ref(),
            &self.session_id,
            &self.startup_state,
            config_id,
            value,
            catalog_authorized_model,
        )?;
        let option = find_select_option_for_request(&self.startup_state.config_options, config_id);

        if let Err(error) = persist_requested_config_value_if_changed(
            self.caps.state.as_ref(),
            &self.event_sink,
            &self.session_id,
            &mut self.persisted_config_state,
            tracked_config_purpose(config_id, option),
            &resolved_value,
            chrono::Utc::now().to_rfc3339(),
        )
        .await
        {
            let _ = self
                .caps
                .state
                .delete_pending_config_change(&self.session_id, config_id);
            return Err(
                crate::live::sessions::actor::command::SetConfigOptionCommandError::Rejected(
                    error.to_string(),
                ),
            );
        }

        Ok(ConfigApplyState::Queued)
    }
}
