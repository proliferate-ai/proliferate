use super::*;
use crate::live::sessions::actor::config::selection::find_select_option_by_purpose;
use crate::live::sessions::actor::config::types::ConfigPurpose;

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
pub(in crate::live::sessions) struct SessionStartupState {
    pub(in crate::live::sessions) current_mode_id: Option<String>,
    pub(in crate::live::sessions) legacy_mode_state: Option<LegacyModeState>,
    pub(in crate::live::sessions) config_options: Vec<acp::SessionConfigOption>,
    pub(in crate::live::sessions) current_model_id: Option<String>,
    pub(in crate::live::sessions) available_model_ids: Vec<String>,
    pub(in crate::live::sessions) prompt_capabilities: anyharness_contract::v1::PromptCapabilities,
}

impl SessionStartupState {
    pub(in crate::live::sessions) fn from_new_session(response: &acp::NewSessionResponse) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|m| m.current_mode_id.to_string()),
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
            prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        }
    }

    pub(in crate::live::sessions) fn from_load_session(
        response: &acp::LoadSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|m| m.current_mode_id.to_string()),
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
            prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        }
    }

    pub(in crate::live::sessions) fn from_fork_session(
        response: &acp::ForkSessionResponse,
    ) -> Self {
        Self {
            current_mode_id: response
                .modes
                .as_ref()
                .map(|m| m.current_mode_id.to_string()),
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
            prompt_capabilities: anyharness_contract::v1::PromptCapabilities::default(),
        }
    }

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

pub(in crate::live::sessions) fn into_legacy_mode_state(
    modes: &acp::SessionModeState,
) -> LegacyModeState {
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
