use crate::domains::sessions::live_config::{
    LegacyModeOption, LegacyModeState, SessionModelOption,
};
use agent_client_protocol as acp;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions) enum NativeSessionStartupDisposition {
    CreatedFresh,
    LoadedExisting,
}

impl NativeSessionStartupDisposition {
    pub(in crate::live::sessions) fn as_str(self) -> &'static str {
        match self {
            Self::CreatedFresh => "created_fresh_native",
            Self::LoadedExisting => "loaded_existing_native",
        }
    }
}

#[derive(Debug, Clone)]
pub(in crate::live::sessions) struct NativeSessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state: Option<LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::schema::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_models: Vec<SessionModelOption>,
}

impl NativeSessionStartupState {
    pub(in crate::live::sessions) fn from_new_session(response: &acp::schema::NewSessionResponse) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: None,
            available_models: vec![],
        }
    }

    pub(in crate::live::sessions) fn from_load_session(
        response: &acp::schema::LoadSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: None,
            available_models: vec![],
        }
    }

    pub(in crate::live::sessions) fn from_fork_session(
        response: &acp::schema::ForkSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: None,
            available_models: vec![],
        }
    }
}

fn into_legacy_mode_state(modes: &acp::schema::SessionModeState) -> LegacyModeState {
    LegacyModeState {
        current_mode_id: modes.current_mode_id.to_string(),
        available_modes: modes
            .available_modes
            .iter()
            .map(|mode| LegacyModeOption {
                id: mode.id.to_string(),
                name: mode.name.clone(),
                description: mode.description.clone(),
            })
            .collect(),
    }
}
