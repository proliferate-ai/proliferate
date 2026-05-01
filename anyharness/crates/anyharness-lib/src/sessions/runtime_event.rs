use anyharness_contract::v1::{
    ReviewRunUpdatedPayload, SessionEvent, SessionEventEnvelope, SessionInfoUpdatePayload,
    SessionLinkTurnCompletedPayload, SubagentTurnCompletedPayload,
};

/// Curated event variants that runtime code may inject outside ACP
/// notification handling.
///
/// Events added here must be runtime-owned, not derived from ACP
/// notifications, and must not be part of an in-progress turn. While a live
/// actor exists, injection still routes through that actor so
/// `SessionEventSink` remains the only live seq owner.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone)]
pub(crate) enum RuntimeInjectedSessionEvent {
    SessionInfoUpdate {
        title: Option<String>,
        updated_at: Option<String>,
    },
    SubagentTurnCompleted(SubagentTurnCompletedPayload),
    SessionLinkTurnCompleted(SessionLinkTurnCompletedPayload),
    ReviewRunUpdated(ReviewRunUpdatedPayload),
}

impl RuntimeInjectedSessionEvent {
    pub(crate) fn updates_session_activity_at(&self) -> bool {
        matches!(
            self,
            Self::SubagentTurnCompleted(_)
                | Self::SessionLinkTurnCompleted(_)
                | Self::ReviewRunUpdated(_)
        )
    }

    pub(crate) fn into_session_event(self) -> SessionEvent {
        match self {
            Self::SessionInfoUpdate { title, updated_at } => {
                SessionEvent::SessionInfoUpdate(SessionInfoUpdatePayload { title, updated_at })
            }
            Self::SubagentTurnCompleted(payload) => SessionEvent::SubagentTurnCompleted(payload),
            Self::SessionLinkTurnCompleted(payload) => {
                SessionEvent::SessionLinkTurnCompleted(payload)
            }
            Self::ReviewRunUpdated(payload) => SessionEvent::ReviewRunUpdated(payload),
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, thiserror::Error)]
pub(crate) enum RuntimeEventInjectionError {
    #[error("session actor is not available")]
    ActorUnavailable,
    #[error("runtime events cannot be injected into replay sessions")]
    SessionReplaying,
    #[error("failed to persist runtime event: {0}")]
    PersistenceFailed(String),
}

pub(crate) type RuntimeEventInjectionResult =
    Result<SessionEventEnvelope, RuntimeEventInjectionError>;
