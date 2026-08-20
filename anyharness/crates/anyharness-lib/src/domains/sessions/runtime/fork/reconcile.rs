use crate::domains::sessions::links::model::SessionLinkRelation;
use crate::domains::sessions::model::{ForkOperationPhase, ForkOperationRecord};
use crate::domains::sessions::runtime::{ForkSessionError, ForkSessionOutcome, SessionRuntime};

impl SessionRuntime {
    /// Reconcile a fork operation found by idempotency key. Unknown or
    /// nonterminal native dispatch cannot be replayed; a durable child is
    /// returned with its actual startup status.
    pub(super) fn reconcile_existing_fork_operation(
        &self,
        existing: &ForkOperationRecord,
        request_digest: &str,
    ) -> Result<ForkSessionOutcome, ForkSessionError> {
        if existing.request_digest != request_digest {
            return Err(ForkSessionError::IdempotencyConflict);
        }
        use ForkOperationPhase::*;
        match existing.phase {
            NativeOutcomeUnknown | Prepared | NativeCallInFlight | NativeResultKnown => {
                Err(ForkSessionError::NativeOutcomeUnknown)
            }
            ChildPersisted | Completed | Failed => {
                let child = self
                    .session_service
                    .get_session(&existing.child_session_id)
                    .map_err(ForkSessionError::Internal)?
                    .ok_or_else(|| {
                        ForkSessionError::Internal(anyhow::anyhow!(
                            "fork operation child session missing: {}",
                            existing.child_session_id
                        ))
                    })?;
                let link = self
                    .session_link_service
                    .list_by_child(&existing.child_session_id)
                    .map_err(ForkSessionError::Internal)?
                    .into_iter()
                    .find(|link| {
                        link.relation == SessionLinkRelation::Fork
                            && link.parent_session_id == existing.parent_session_id
                    })
                    .ok_or_else(|| {
                        ForkSessionError::Internal(anyhow::anyhow!(
                            "fork operation child link missing: {}",
                            existing.child_session_id
                        ))
                    })?;
                let child_started = child.status != "errored" && child.status != "starting";
                Ok(ForkSessionOutcome {
                    session: child,
                    link,
                    child_started,
                })
            }
        }
    }
}
