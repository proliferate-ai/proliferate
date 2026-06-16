use agent_client_protocol as acp;
use anyharness_contract::v1::ConfigApplyState;

use crate::domains::sessions::model::SessionRecord;
use crate::live::sessions::actor::config::apply::{
    apply_mode_via_direct_setter_legacy, apply_specific_config_option, try_apply_config_option,
    try_apply_model_preference,
};
use crate::live::sessions::actor::config::persist::persist_requested_config_value_if_changed;
use crate::live::sessions::actor::config::queue::queue_pending_config_change;
use crate::live::sessions::actor::config::selection::{
    find_select_option_by_purpose, find_select_option_for_request, resolve_model_variant_value,
    select_option_values,
};
use crate::live::sessions::actor::config::types::{
    tracked_config_purpose, ConfigApplyOutcome, ConfigPurpose,
};
use crate::live::sessions::actor::state::{SessionActor, SessionStartupState};
pub(in crate::live::sessions::actor) async fn apply_requested_session_preferences(
    conn: &acp::ConnectionTo<acp::Agent>,
    native_session_id: &str,
    session: &SessionRecord,
    startup_state: &mut SessionStartupState,
) -> anyhow::Result<()> {
    if let Some(model_id) = session.requested_model_id.as_deref() {
        match try_apply_model_preference(conn, native_session_id, model_id, startup_state).await {
            Ok(ConfigApplyOutcome::NotApplied) => {
                tracing::warn!(
                    native_session_id,
                    requested_model_id = model_id,
                    current_model_id = ?startup_state.current_model_id,
                    available_model_ids = ?live_model_ids(startup_state),
                    "requested model is not available in active session; keeping agent-selected model"
                );
            }
            Ok(outcome) => {
                tracing::debug!(
                    native_session_id,
                    requested_model_id = model_id,
                    outcome = ?outcome,
                    "applied requested model preference"
                );
            }
            Err(error) => {
                // Model prefs are best-effort at startup because live ACP/provider IDs can
                // drift while the session remains usable. Mode prefs stay strict below.
                tracing::warn!(
                    native_session_id,
                    requested_model_id = model_id,
                    error = %error,
                    "failed to apply requested model; keeping agent-selected model"
                );
            }
        }
    }
    if let Some(mode_id) = session.requested_mode_id.as_deref() {
        let outcome = try_apply_config_option(
            conn,
            native_session_id,
            startup_state,
            ConfigPurpose::Mode,
            mode_id,
        )
        .await?;
        if outcome == ConfigApplyOutcome::NotApplied {
            let _ = apply_mode_via_direct_setter_legacy(
                conn,
                native_session_id,
                startup_state,
                mode_id,
            )
            .await?;
        }
    }

    Ok(())
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
        let option = find_select_option_for_request(&self.startup_state.config_options, config_id);
        // Resolve a bare variant base to the advertised composed value before
        // queueing/persisting, so the queued + persisted value match what the
        // idle replay will actually send (mirrors apply_specific_config_option).
        let resolved_value = match option {
            Some(option) => resolve_model_variant_value(option, value),
            None => value.to_string(),
        };
        let value = resolved_value.as_str();

        queue_pending_config_change(
            self.caps.state.as_ref(),
            &self.session_id,
            &self.startup_state,
            config_id,
            value,
            catalog_authorized_model,
        )?;

        if let Err(error) = persist_requested_config_value_if_changed(
            self.caps.state.as_ref(),
            &self.event_sink,
            &self.session_id,
            &mut self.persisted_config_state,
            tracked_config_purpose(config_id, option),
            value,
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
