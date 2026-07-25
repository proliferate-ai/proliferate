//! Workflow hold authorization and rollback-only Interactive restoration.

use super::{
    EnsureLiveSessionError, SessionProcessPolicy, SessionProcessPolicyError, SessionRuntime,
};
use crate::live::workflows::SessionProcessTransitionGuard;

impl SessionRuntime {
    pub(crate) async fn lock_session_process_transition(
        &self,
        session_id: &str,
    ) -> SessionProcessTransitionGuard {
        self.workflow_owned_sessions
            .lock_process_transition(session_id)
            .await
    }

    pub(super) fn authorize_session_process_policy_under_transition(
        &self,
        session_id: &str,
        process_policy: &SessionProcessPolicy,
        transition: &SessionProcessTransitionGuard,
    ) -> Result<(), SessionProcessPolicyError> {
        if !transition.matches(session_id) {
            return Err(SessionProcessPolicyError::WorkflowIdentityMismatch);
        }
        self.authorize_session_process_policy(session_id, process_policy)
    }
}

pub(super) fn map_process_policy_error_to_ensure(
    error: SessionProcessPolicyError,
) -> EnsureLiveSessionError {
    match error {
        SessionProcessPolicyError::WorkflowHeld { run_id } => {
            EnsureLiveSessionError::WorkflowHeld { run_id }
        }
        SessionProcessPolicyError::WorkflowIdentityMismatch => EnsureLiveSessionError::Internal(
            anyhow::anyhow!("session process policy identity mismatch"),
        ),
    }
}

pub(super) fn map_internal_start_error_to_ensure(error: anyhow::Error) -> EnsureLiveSessionError {
    if let Some(policy_error) = error.downcast_ref::<SessionProcessPolicyError>() {
        return match policy_error {
            SessionProcessPolicyError::WorkflowHeld { run_id } => {
                EnsureLiveSessionError::WorkflowHeld {
                    run_id: run_id.clone(),
                }
            }
            SessionProcessPolicyError::WorkflowIdentityMismatch => {
                EnsureLiveSessionError::Internal(error)
            }
        };
    }
    EnsureLiveSessionError::Internal(error)
}
