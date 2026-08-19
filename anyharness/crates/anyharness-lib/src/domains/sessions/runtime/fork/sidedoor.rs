use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::{ForkOperationPhase, SessionRecord};
use crate::live::sessions::{LiveSessionCommandError, SidedoorForkCommandError};

use super::{ForkSessionError, SessionRuntime};

impl SessionRuntime {
    /// Rung 3 dispatch. A targeted fork on an OpenCode parent that advertises
    /// `targeted_fork` (the side-door bridge) resolves its
    /// product anchor to a vendor message id here and dispatches through the
    /// parent actor's side-door. Every OTHER targeted case keeps the exact
    /// current error: a targeted anchor with no wired bridge means a
    /// capability was advertised without a dispatch implementation.
    pub(super) fn resolve_sidedoor_message_id(
        &self,
        session_id: &str,
        is_targeted: bool,
        parent: &SessionRecord,
        targeted_fork_enabled: bool,
        anchor_turn_id: &Option<String>,
        anchor_item_id: &Option<String>,
    ) -> Result<Option<String>, ForkSessionError> {
        if !is_targeted {
            return Ok(None);
        }
        if parent.agent_kind == AgentKind::OpenCode.as_str() && targeted_fork_enabled {
            // Translate the resolved (turn_id, item_id) boundary to the
            // captured vendor message id. Absent ⇒ the stable
            // TARGET_NOT_FOUND reason: no fallback, no ordinal guessing
            // (the vendor silently full-copies an unknown id).
            let turn_id = anchor_turn_id.as_deref().unwrap_or_default();
            let item_id = anchor_item_id.as_deref().unwrap_or_default();
            let mapped = self
                .session_service
                .store()
                .find_opencode_message_id(session_id, turn_id, item_id)
                .map_err(ForkSessionError::Internal)?
                .ok_or(ForkSessionError::TargetNotFound)?;
            Ok(Some(mapped))
        } else {
            Err(ForkSessionError::Unsupported(
                "targeted fork native dispatch is not wired for this agent".to_string(),
            ))
        }
    }

    /// The resolved vendor version for side-door provenance (never hardcoded):
    /// the exact `(adapter, native)` pin this session was stamped under.
    pub(super) fn resolve_sidedoor_native_version(
        &self,
        session_id: &str,
        sidedoor_message_id: &Option<String>,
    ) -> Option<String> {
        sidedoor_message_id.as_ref().and_then(|_| {
            self.session_service
                .store()
                .find_adapter_marker(session_id)
                .ok()
                .flatten()
                .and_then(|marker| marker.native_version)
        })
    }

    /// Classify a side-door fork dispatch error for the phase machine. A
    /// dropped response / unavailable actor is an unknown outcome that blocks
    /// blind redispatch; a definite rejection is terminal (ADR 4.4).
    pub(super) fn mark_fork_sidedoor_failure(
        &self,
        operation_id: &str,
        error: &LiveSessionCommandError<SidedoorForkCommandError>,
        now: &str,
    ) {
        let phase = match error {
            LiveSessionCommandError::ResponseDropped
            | LiveSessionCommandError::ActorUnavailable => ForkOperationPhase::NativeOutcomeUnknown,
            LiveSessionCommandError::Rejected(_) => ForkOperationPhase::Failed,
        };
        self.mark_fork_phase(operation_id, phase, now);
    }
}

/// Map a side-door fork dispatch error to the shared fork error taxonomy. The
/// validation failures resolved on the actor (unknown/non-user id, listing
/// mismatch) surface as the existing TARGET_NOT_FOUND/INVALID_FORK_TARGET
/// reasons; a non-Ready side-door is `Unsupported` (never a silent tip fork).
pub(super) fn map_live_sidedoor_fork_error(
    error: LiveSessionCommandError<SidedoorForkCommandError>,
) -> ForkSessionError {
    match error {
        LiveSessionCommandError::ActorUnavailable => {
            ForkSessionError::Internal(anyhow::anyhow!("session actor channel closed"))
        }
        LiveSessionCommandError::ResponseDropped => ForkSessionError::Internal(anyhow::anyhow!(
            "session actor dropped side-door fork response"
        )),
        LiveSessionCommandError::Rejected(inner) => match inner {
            SidedoorForkCommandError::NotReady(detail) => ForkSessionError::Unsupported(detail),
            SidedoorForkCommandError::TargetNotFound => ForkSessionError::TargetNotFound,
            SidedoorForkCommandError::InvalidForkTarget(detail) => {
                ForkSessionError::InvalidForkTarget(detail)
            }
            SidedoorForkCommandError::Busy => ForkSessionError::Busy,
            SidedoorForkCommandError::Failed(detail) => {
                ForkSessionError::Internal(anyhow::anyhow!(detail))
            }
        },
    }
}
