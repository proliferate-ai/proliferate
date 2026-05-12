use std::time::{Duration, Instant};

use agent_client_protocol as acp;

use crate::domains::agents::model::AgentKind;

pub(super) const IDLE_RESUME_REPLAY_QUIET_WINDOW: Duration = Duration::from_millis(100);

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

    pub(super) fn allows_missing_load_fallback(&self) -> bool {
        matches!(self, Self::LoadNative(_))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum NativeSessionStartupDisposition {
    CreatedFresh,
    LoadedExisting,
}

impl NativeSessionStartupDisposition {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::CreatedFresh => "created_fresh_native",
            Self::LoadedExisting => "loaded_existing_native",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ResumeReplayNotificationClass {
    UserEcho,
    Transcript,
    ConfigState,
    Other,
}

#[derive(Debug, Clone, Copy)]
enum ResumeReplayFilterState {
    Monitoring,
    Suppressing { last_transcript_at: Instant },
    Disabled,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ResumeReplayFilter {
    state: ResumeReplayFilterState,
}

impl ResumeReplayFilter {
    pub(super) fn new(
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
    pub(super) fn disabled() -> Self {
        Self {
            state: ResumeReplayFilterState::Disabled,
        }
    }

    pub(super) fn disable(&mut self) {
        self.state = ResumeReplayFilterState::Disabled;
    }

    pub(super) fn should_suppress(
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

fn classify_resume_replay_notification(
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
