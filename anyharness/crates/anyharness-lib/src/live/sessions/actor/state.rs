use std::sync::Arc;

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionEventEnvelope;
use tokio::sync::broadcast;

use crate::domains::sessions::live_config::SessionModelOption;
use crate::live::sessions::actor::config::selection::find_select_option_by_purpose;
use crate::live::sessions::actor::config::types::ConfigPurpose;
use crate::live::sessions::driver::types::NativeSessionStartupState;
use crate::live::sessions::model::{ActorCapabilities, SessionHooks, SessionLaunch};
use crate::live::sessions::rendezvous::broker::InteractionRendezvous;

pub struct SessionActorConfig {
    /// Everything describing THIS launch (session row, agent, env, startup).
    pub launch: SessionLaunch,
    /// The never-varies durable capabilities + product reactors.
    pub caps: ActorCapabilities,
    /// Per-call powers (turn-finish callback, exit callback, latency context).
    pub hooks: SessionHooks,
    pub interaction_broker: Arc<InteractionRendezvous>,
    pub event_tx: broadcast::Sender<SessionEventEnvelope>,
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions) struct SessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state:
        Option<crate::domains::sessions::live_config::LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::schema::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_models: Vec<SessionModelOption>,
    pub(in crate::live::sessions) prompt_capabilities: anyharness_contract::v1::PromptCapabilities,
}

impl From<NativeSessionStartupState> for SessionStartupState {
    fn from(native: NativeSessionStartupState) -> Self {
        Self {
            current_mode_id: native.current_mode_id,
            legacy_mode_state: native.legacy_mode_state,
            config_options: native.config_options,
            current_model_id: native.current_model_id,
            available_models: native.available_models,
            prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        }
    }
}

impl SessionStartupState {
    pub(in crate::live::sessions) fn set_current_mode_id(
        &mut self,
        current_mode_id: impl Into<String>,
    ) {
        let current_mode_id = current_mode_id.into();
        self.current_mode_id = Some(current_mode_id.clone());
        if let Some(legacy_mode_state) = self.legacy_mode_state.as_mut() {
            legacy_mode_state.current_mode_id = current_mode_id;
        }
    }

    pub(in crate::live::sessions) fn has_legacy_mode_control(&self) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| !state.available_modes.is_empty())
            .unwrap_or(false)
    }

    pub(in crate::live::sessions) fn has_direct_model_control(&self) -> bool {
        self.current_model_id.is_some() || !self.available_models.is_empty()
    }

    pub(in crate::live::sessions) fn has_raw_or_legacy_mode_control(&self) -> bool {
        self.has_legacy_mode_control()
            || find_select_option_by_purpose(&self.config_options, ConfigPurpose::Mode).is_some()
    }

    pub(in crate::live::sessions) fn legacy_mode_contains_value(
        &self,
        desired_mode_id: &str,
    ) -> bool {
        self.legacy_mode_state
            .as_ref()
            .map(|state| {
                state
                    .available_modes
                    .iter()
                    .any(|mode| mode.id == desired_mode_id)
            })
            .unwrap_or(false)
    }
}
