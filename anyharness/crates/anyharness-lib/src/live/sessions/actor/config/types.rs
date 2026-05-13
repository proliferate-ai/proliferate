use crate::live::sessions::actor::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::live::sessions::actor) struct PersistedSessionConfigState {
    pub(in crate::live::sessions::actor) requested_model_id: Option<String>,
    pub(in crate::live::sessions::actor) current_model_id: Option<String>,
    pub(in crate::live::sessions::actor) requested_mode_id: Option<String>,
    pub(in crate::live::sessions::actor) current_mode_id: Option<String>,
}

impl PersistedSessionConfigState {
    pub(in crate::live::sessions::actor) fn from_session(session: &SessionRecord) -> Self {
        Self {
            requested_model_id: session.requested_model_id.clone(),
            current_model_id: session.current_model_id.clone(),
            requested_mode_id: session.requested_mode_id.clone(),
            current_mode_id: session.current_mode_id.clone(),
        }
    }

    pub(in crate::live::sessions::actor) fn to_event_payload(&self) -> SessionStateUpdatePayload {
        SessionStateUpdatePayload {
            model_id: self.current_model_id.clone(),
            requested_model_id: self.requested_model_id.clone(),
            mode_id: self.current_mode_id.clone(),
            requested_mode_id: self.requested_mode_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions) enum ConfigPurpose {
    Model,
    Mode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::live::sessions::actor) enum ConfigApplyOutcome {
    NoChange,
    AppliedAuthoritative,
    RequestedOnly,
    NotApplied,
}

pub(in crate::live::sessions::actor) fn tracked_config_purpose(
    config_id: &str,
    option: Option<&acp::SessionConfigOption>,
) -> Option<ConfigPurpose> {
    if is_model_config_request(config_id, option) {
        Some(ConfigPurpose::Model)
    } else if is_mode_config_request(config_id, option) {
        Some(ConfigPurpose::Mode)
    } else {
        None
    }
}
