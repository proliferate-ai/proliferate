//! Workflow session acquisition and rollback fence decisions.

use super::*;
use crate::live::workflows::exec_policy::{
    WorkflowSessionAcquireError, WorkflowSessionAcquisition,
};

#[derive(Debug, Clone, Copy)]
pub(in crate::live::workflows) struct PreparedSessionRollbackEvidence {
    pub(in crate::live::workflows) broker_revoked: bool,
    pub(in crate::live::workflows) actor_quiesced: bool,
    pub(in crate::live::workflows) durable_state_safe: bool,
}

pub(in crate::live::workflows) fn finalize_prepared_session_rollback(
    owned: &crate::live::workflows::exec_policy::WorkflowOwnedSessions,
    gateways: &crate::live::workflows::gateway::WorkflowGatewaySessions,
    session_id: &str,
    run_id: &str,
    evidence: PreparedSessionRollbackEvidence,
    ownership_acquired: bool,
    transition: &crate::live::workflows::exec_policy::SessionProcessTransitionGuard,
) -> Result<(), StepOutcome> {
    if !evidence.broker_revoked || !evidence.actor_quiesced {
        return Err(failed_msg(
            "workflow_agent_isolation_unavailable",
            "workflow session rollback evidence incomplete; ownership retained",
        ));
    }
    // Once external authority and the actor are both proven quiescent, the
    // prepared gateway capability has no legitimate consumer. Remove it even
    // when durable rollback fails; ownership remains the retry fence.
    gateways.remove(session_id);
    if !evidence.durable_state_safe {
        return Err(failed_msg(
            "workflow_agent_isolation_unavailable",
            "workflow durable rollback incomplete; ownership retained",
        ));
    }
    if ownership_acquired {
        owned
            .unmark_prepared(transition, session_id, run_id)
            .map_err(|_| {
                failed_msg(
                    "workflow_agent_isolation_unavailable",
                    "workflow rollback transition identity mismatch",
                )
            })?;
    }
    Ok(())
}

pub(in crate::live::workflows) fn validate_bind_target(
    bind_id: &str,
    session_harness: &str,
    slot_harness: &str,
) -> Result<(), StepOutcome> {
    if session_harness != slot_harness {
        return Err(failed_msg(
            "plan_malformed",
            format!(
                "bound session {bind_id} harness {session_harness} does not match slot harness \
                 {slot_harness}"
            ),
        ));
    }
    Ok(())
}

pub(super) fn acquire_workflow_session(
    owned: &crate::live::workflows::exec_policy::WorkflowOwnedSessions,
    transition: &crate::live::workflows::exec_policy::SessionProcessTransitionGuard,
    session_id: &str,
    run_id: &str,
) -> Result<WorkflowSessionAcquisition, StepOutcome> {
    owned
        .try_acquire(transition, session_id, run_id)
        .map_err(|error| match error {
            WorkflowSessionAcquireError::HeldByOther { run_id: owner } => failed_msg(
                "session_bind_held",
                format!("bound session {session_id} is already held by workflow run {owner}"),
            ),
            WorkflowSessionAcquireError::RunReleased => failed_msg(
                "workflow_agent_isolation_unavailable",
                "terminal workflow run cannot reacquire session ownership",
            ),
            WorkflowSessionAcquireError::TransitionMismatch => failed_msg(
                "workflow_agent_isolation_unavailable",
                "workflow session transition identity mismatch",
            ),
        })
}
