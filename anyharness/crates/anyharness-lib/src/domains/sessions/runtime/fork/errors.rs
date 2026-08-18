use crate::domains::sessions::model::ForkOperationPhase;
use crate::domains::sessions::runtime::fork_boundary::ForkTargetError;
use crate::live::sessions::{ForkSessionCommandError, LiveSessionCommandError};

use super::{ForkSessionError, SessionRuntime, StartSessionError};

impl SessionRuntime {
    /// Classify a native fork dispatch error. A dropped response / unavailable
    /// actor is an unknown outcome that BLOCKS blind redispatch (ADR 4.4); a
    /// definite rejection is a terminal failure.
    pub(super) fn mark_fork_native_failure(
        &self,
        operation_id: &str,
        error: &LiveSessionCommandError<ForkSessionCommandError>,
        now: &str,
    ) {
        let phase = match error {
            LiveSessionCommandError::ResponseDropped
            | LiveSessionCommandError::ActorUnavailable => {
                ForkOperationPhase::NativeOutcomeUnknown
            }
            LiveSessionCommandError::Rejected(_) => ForkOperationPhase::Failed,
        };
        self.mark_fork_phase(operation_id, phase, now);
    }
}

pub(super) fn map_fork_target_error(error: ForkTargetError) -> ForkSessionError {
    match error {
        ForkTargetError::ItemIdRequired => {
            ForkSessionError::InvalidForkTarget("fork target requires item_id".to_string())
        }
        ForkTargetError::TargetNotFound => ForkSessionError::TargetNotFound,
        ForkTargetError::BoundaryNotCommitted => ForkSessionError::BoundaryNotCommitted,
    }
}

pub(super) fn map_start_error_to_fork(error: StartSessionError) -> ForkSessionError {
    match error {
        StartSessionError::WorkspaceNotFound => {
            ForkSessionError::Internal(anyhow::anyhow!("workspace not found for session"))
        }
        StartSessionError::WorkspaceDirectoryMissing { path } => {
            ForkSessionError::WorkspaceDirectoryMissing { path }
        }
        StartSessionError::AgentDescriptorNotFound(agent_kind) => {
            ForkSessionError::Internal(anyhow::anyhow!("agent descriptor not found: {agent_kind}"))
        }
        StartSessionError::Closed => ForkSessionError::Invalid("session is closed".to_string()),
        StartSessionError::MissingDataKey => ForkSessionError::MissingDataKey,
        StartSessionError::RestartRequired(detail) => ForkSessionError::Invalid(detail),
        StartSessionError::WorkspaceMcpAttachmentFailed(error) => {
            ForkSessionError::Internal(anyhow::Error::new(error))
        }
        StartSessionError::RouteAuth(error) => ForkSessionError::Invalid(error.to_string()),
        StartSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        } => ForkSessionError::AgentNotReady {
            agent_kind,
            status,
            detail,
        },
        StartSessionError::Internal(error) | StartSessionError::AcpStart(error) => {
            ForkSessionError::Internal(error)
        }
    }
}

pub(super) fn map_fork_command_error(error: ForkSessionCommandError) -> ForkSessionError {
    match error {
        ForkSessionCommandError::Busy => ForkSessionError::Busy,
        ForkSessionCommandError::Unsupported(detail) => ForkSessionError::Unsupported(detail),
        ForkSessionCommandError::Failed(detail) => {
            ForkSessionError::Internal(anyhow::anyhow!(detail))
        }
    }
}

pub(super) fn map_live_fork_command_error(
    error: LiveSessionCommandError<ForkSessionCommandError>,
    response_dropped_detail: &str,
) -> ForkSessionError {
    match error {
        LiveSessionCommandError::ActorUnavailable => {
            ForkSessionError::Internal(anyhow::anyhow!("session actor channel closed"))
        }
        LiveSessionCommandError::ResponseDropped => {
            ForkSessionError::Internal(anyhow::anyhow!(response_dropped_detail.to_string()))
        }
        LiveSessionCommandError::Rejected(error) => map_fork_command_error(error),
    }
}
