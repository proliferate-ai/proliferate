use super::SessionEventSink;
use anyharness_contract::v1::{
    AvailableCommandsUpdatePayload, ConfigOptionUpdatePayload, CurrentModeUpdatePayload,
    SessionEvent, SessionInfoUpdatePayload, SessionStateUpdatePayload, UsageUpdatePayload,
};

impl SessionEventSink {
    pub fn available_commands_update(&mut self, payload: AvailableCommandsUpdatePayload) {
        self.emit_with_ids(SessionEvent::AvailableCommandsUpdate(payload), None, None);
    }

    pub fn current_mode_update(&mut self, payload: CurrentModeUpdatePayload) {
        self.emit_with_ids(SessionEvent::CurrentModeUpdate(payload), None, None);
    }

    pub fn config_option_update(&mut self, payload: ConfigOptionUpdatePayload) {
        self.emit_with_ids(SessionEvent::ConfigOptionUpdate(payload), None, None);
    }

    pub fn session_state_update(&mut self, payload: SessionStateUpdatePayload) {
        self.emit_with_ids(SessionEvent::SessionStateUpdate(payload), None, None);
    }

    pub fn session_info_update(&mut self, payload: SessionInfoUpdatePayload) {
        self.emit_with_ids(SessionEvent::SessionInfoUpdate(payload), None, None);
    }

    pub fn usage_update(&mut self, payload: UsageUpdatePayload) {
        self.emit_with_ids(SessionEvent::UsageUpdate(payload), None, None);
    }
}
