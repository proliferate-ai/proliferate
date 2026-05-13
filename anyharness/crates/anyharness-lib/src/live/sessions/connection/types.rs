use crate::sessions::live_config::{LegacyModeOption, LegacyModeState};
use agent_client_protocol as acp;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStartupStrategy {
    Fresh,
    ResumeSeqFreshNative,
    LoadNative(String),
    LoadNativeNoFallback(String),
    ForkFromNative { parent_native_session_id: String },
}

impl SessionStartupStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::ResumeSeqFreshNative => "resume_seq_fresh_native",
            Self::LoadNative(_) => "load_native",
            Self::LoadNativeNoFallback(_) => "load_native_no_fallback",
            Self::ForkFromNative { .. } => "fork_from_native",
        }
    }

    pub fn resumes_durable_history(&self) -> bool {
        !matches!(self, Self::Fresh)
    }

    pub(in crate::live::sessions) fn allows_missing_load_fallback(&self) -> bool {
        matches!(self, Self::LoadNative(_))
    }
}

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
    pub(in crate::live::sessions) config_options: Vec<acp::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_model_ids: Vec<String>,
}

impl NativeSessionStartupState {
    pub(in crate::live::sessions) fn from_new_session(response: &acp::NewSessionResponse) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: response
                .models
                .as_ref()
                .map(|models| models.current_model_id.to_string()),
            available_model_ids: response
                .models
                .as_ref()
                .map(|models| {
                    models
                        .available_models
                        .iter()
                        .map(|model| model.model_id.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub(in crate::live::sessions) fn from_load_session(
        response: &acp::LoadSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: response
                .models
                .as_ref()
                .map(|models| models.current_model_id.to_string()),
            available_model_ids: response
                .models
                .as_ref()
                .map(|models| {
                    models
                        .available_models
                        .iter()
                        .map(|model| model.model_id.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    pub(in crate::live::sessions) fn from_fork_session(
        response: &acp::ForkSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.to_string()),
            legacy_mode_state: response.modes.as_ref().map(into_legacy_mode_state),
            config_options: response.config_options.clone().unwrap_or_default(),
            current_model_id: response
                .models
                .as_ref()
                .map(|models| models.current_model_id.to_string()),
            available_model_ids: response
                .models
                .as_ref()
                .map(|models| {
                    models
                        .available_models
                        .iter()
                        .map(|model| model.model_id.to_string())
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

fn into_legacy_mode_state(modes: &acp::SessionModeState) -> LegacyModeState {
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
