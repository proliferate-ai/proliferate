use std::time::{Duration, Instant};

use agent_client_protocol as acp;

use crate::domains::agents::model::AgentKind;
use crate::live::sessions::driver::types::NativeSessionStartupDisposition;
pub(in crate::live::sessions::actor) const IDLE_RESUME_REPLAY_QUIET_WINDOW: Duration =
    Duration::from_millis(100);

pub(in crate::live::sessions::actor) enum ResumeReplayNotificationClass {
    UserEcho,
    Transcript,
    ConfigState,
    Other,
}

#[derive(Debug, Clone, Copy)]
pub(in crate::live::sessions::actor) enum ResumeReplayFilterState {
    Monitoring,
    Suppressing { last_transcript_at: Instant },
    Disabled,
}

#[derive(Debug, Clone, Copy)]
pub(in crate::live::sessions::actor) struct ResumeReplayFilter {
    state: ResumeReplayFilterState,
}

impl ResumeReplayFilter {
    pub(in crate::live::sessions::actor) fn new(
        source_agent_kind: &str,
        startup_disposition: NativeSessionStartupDisposition,
        _session_status: &str,
    ) -> Self {
        let state = if startup_disposition == NativeSessionStartupDisposition::LoadedExisting
            && matches!(
                source_agent_kind,
                kind if kind == AgentKind::Claude.as_str() || kind == AgentKind::Codex.as_str()
            ) {
            ResumeReplayFilterState::Monitoring
        } else {
            ResumeReplayFilterState::Disabled
        };

        Self { state }
    }

    #[cfg(test)]
    pub(in crate::live::sessions::actor) fn disabled() -> Self {
        Self {
            state: ResumeReplayFilterState::Disabled,
        }
    }

    pub(in crate::live::sessions::actor) fn disable(&mut self) {
        self.state = ResumeReplayFilterState::Disabled;
    }

    pub(in crate::live::sessions::actor) fn should_suppress(
        &mut self,
        notification: &acp::SessionNotification,
        now: Instant,
    ) -> bool {
        if let ResumeReplayFilterState::Suppressing { last_transcript_at } = self.state {
            if now.duration_since(last_transcript_at) >= IDLE_RESUME_REPLAY_QUIET_WINDOW {
                self.state = ResumeReplayFilterState::Monitoring;
            }
        }

        let class = classify_resume_replay_notification(&notification.update);
        match (self.state, class) {
            (ResumeReplayFilterState::Monitoring, ResumeReplayNotificationClass::UserEcho) => {
                self.state = ResumeReplayFilterState::Suppressing {
                    last_transcript_at: now,
                };
                true
            }
            (
                ResumeReplayFilterState::Suppressing { .. },
                ResumeReplayNotificationClass::UserEcho
                | ResumeReplayNotificationClass::Transcript
                | ResumeReplayNotificationClass::ConfigState,
            ) => {
                self.state = ResumeReplayFilterState::Suppressing {
                    last_transcript_at: now,
                };
                true
            }
            _ => false,
        }
    }
}

pub(in crate::live::sessions::actor) fn classify_resume_replay_notification(
    update: &acp::SessionUpdate,
) -> ResumeReplayNotificationClass {
    use acp::SessionUpdate::*;
    match update {
        UserMessageChunk(_) => ResumeReplayNotificationClass::UserEcho,
        AgentMessageChunk(_) | AgentThoughtChunk(_) | ToolCall(_) | ToolCallUpdate(_) | Plan(_) => {
            ResumeReplayNotificationClass::Transcript
        }
        CurrentModeUpdate(_) | ConfigOptionUpdate(_) => ResumeReplayNotificationClass::ConfigState,
        _ => ResumeReplayNotificationClass::Other,
    }
}
