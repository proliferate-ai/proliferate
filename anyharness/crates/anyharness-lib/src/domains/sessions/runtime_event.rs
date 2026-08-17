use anyharness_contract::v1::{
    ReviewRunUpdatedPayload, SessionEvent, SessionEventEnvelope, SessionInfoUpdatePayload,
    SessionLinkTurnCompletedPayload, SubagentTurnCompletedPayload, SubagentTurnOutcome,
    WorkspacePinIntentPayload,
};

use crate::domains::sessions::extensions::SessionTurnOutcome;

/// Domain-side description of a completed subagent turn. Runtime code below
/// the mapper boundary hands this to
/// [`RuntimeInjectedSessionEvent::subagent_turn_completed`], which owns the
/// one mapping onto the wire payload.
#[derive(Debug, Clone)]
pub(crate) struct SubagentTurnCompletion {
    pub completion_id: String,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: SessionTurnOutcome,
    pub label: Option<String>,
}

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
    WorkspacePinIntent {
        request_id: String,
        runtime_id: String,
        source_session_id: String,
        workspace_id: String,
        pinned: bool,
    },
    SubagentTurnCompleted(SubagentTurnCompletedPayload),
    SessionLinkTurnCompleted(SessionLinkTurnCompletedPayload),
    ReviewRunUpdated(ReviewRunUpdatedPayload),
}

impl RuntimeInjectedSessionEvent {
    pub(crate) fn subagent_turn_completed(completion: SubagentTurnCompletion) -> Self {
        Self::SubagentTurnCompleted(SubagentTurnCompletedPayload {
            completion_id: completion.completion_id,
            session_link_id: completion.session_link_id,
            parent_session_id: completion.parent_session_id,
            child_session_id: completion.child_session_id,
            child_turn_id: completion.child_turn_id,
            child_last_event_seq: completion.child_last_event_seq,
            outcome: match completion.outcome {
                SessionTurnOutcome::Completed => SubagentTurnOutcome::Completed,
                SessionTurnOutcome::Failed => SubagentTurnOutcome::Failed,
                SessionTurnOutcome::Cancelled => SubagentTurnOutcome::Cancelled,
            },
            label: completion.label,
        })
    }

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
            Self::WorkspacePinIntent {
                request_id,
                runtime_id,
                source_session_id,
                workspace_id,
                pinned,
            } => SessionEvent::WorkspacePinIntent(WorkspacePinIntentPayload {
                request_id,
                runtime_id,
                source_session_id,
                workspace_id,
                pinned,
            }),
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
