//! Platform isolation broker port, unavailable implementation, and errors.

use std::sync::Arc;

use super::{
    BrokeredWorkflowAgentProcess, TrustedLocalGatewayBinding, WorkflowAgentLaunchRequest,
    WorkflowCommandOutput, WorkflowCommandRequest, WorkflowDeliveryIdentity,
    WorkflowExecutableAuthorization, WorkflowIsolationAttestation, WorkflowIsolationCapability,
    WorkflowIsolationPolicy, WorkflowProcessGroup, WorkflowProcessIdentity,
    WorkflowWorktreeCleanupOutput, WorkflowWorktreeCleanupRequest,
    WorkflowWorktreeInspectionOutput, WorkflowWorktreeInspectionRequest,
    WorkflowWorktreeMaterializationOutput, WorkflowWorktreeMaterializationRequest,
};

pub const WORKFLOW_AGENT_ISOLATION_UNAVAILABLE: &str = "WORKFLOW_AGENT_ISOLATION_UNAVAILABLE";

#[async_trait::async_trait]
/// Phase-A fail-closed port. This is deliberately not a production adapter
/// registration contract yet: Phase B must add an unguessable challenge nonce,
/// expiry, platform-instance identity, and monotonic broker generation to make
/// attestations replay-resistant across runtime/broker restarts. `AppState`
/// exposes no injection seam until that protocol exists.
pub trait WorkflowIsolationBroker: Send + Sync {
    fn attest(
        &self,
        identity: &WorkflowDeliveryIdentity,
        policy: &WorkflowIsolationPolicy,
    ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError>;

    fn spawn_agent(
        &self,
        capability: &WorkflowIsolationCapability,
        request: WorkflowAgentLaunchRequest,
    ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError>;

    /// Resolve a requested program through the platform-owned, immutable
    /// executable catalog. The returned digest and canonical path must name the
    /// exact artifact the adapter will execute. The default is deny.
    fn authorize_executable(
        &self,
        _capability: &WorkflowIsolationCapability,
        _identity: &WorkflowProcessIdentity,
        _requested_program: &std::path::Path,
    ) -> Result<WorkflowExecutableAuthorization, WorkflowIsolationError> {
        Err(WorkflowIsolationError::ExecutableDenied)
    }

    fn bind_local_gateway(
        &self,
        capability: &WorkflowIsolationCapability,
        identity: &WorkflowProcessIdentity,
    ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError>;

    fn revoke_local_gateway(
        &self,
        _capability: &WorkflowIsolationCapability,
        _identity: &WorkflowProcessIdentity,
    ) -> Result<(), WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    /// Revoke exactly one not-yet-activated attestation. This operation must
    /// never revoke another capability for the same run. It is the only safe
    /// loser cleanup for a future concurrent activation CAS; the default is
    /// deny because legacy run-wide cancellation is not equivalent.
    fn revoke_capability(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn run_command(
        &self,
        capability: &WorkflowIsolationCapability,
        request: WorkflowCommandRequest,
    ) -> Result<WorkflowCommandOutput, WorkflowIsolationError>;

    /// Materialize one policy-declared worktree in the isolated principal.
    /// Phase-A's default implementation is deliberately unavailable; platform
    /// adapters must reject hooks/filters escaping the sandbox and return the
    /// exact canonical target root they created.
    async fn materialize_worktree(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowWorktreeMaterializationRequest,
    ) -> Result<WorkflowWorktreeMaterializationOutput, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn inspect_worktree(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowWorktreeInspectionRequest,
    ) -> Result<WorkflowWorktreeInspectionOutput, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    /// Compensate a failed or contract-mismatched materialization by operation
    /// identity. The adapter must remove every artifact created by that
    /// operation, not merely the path echoed by an untrusted/malformed output.
    /// A successful receipt also seals that operation identity: an in-flight or
    /// response-lost materialization may not create artifacts after cleanup
    /// reports them absent.
    async fn cleanup_materialization(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowWorktreeCleanupRequest,
    ) -> Result<WorkflowWorktreeCleanupOutput, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    /// Revoke the group's local authority, terminate every descendant, wait
    /// for/reap the root and descendants, and return only after quiescence is
    /// proven. Sending a signal is not success.
    async fn cancel_process_group(
        &self,
        capability: &WorkflowIsolationCapability,
        process_group: &WorkflowProcessGroup,
    ) -> Result<(), WorkflowIsolationError>;

    /// Revoke the run capability, terminate every descendant/process group,
    /// wait for/reap them, and remove ephemeral broker bindings. `Ok(())` is a
    /// synchronous quiescence receipt; best-effort cancellation must return an
    /// error so ownership stays fenced for cleanup retry.
    async fn cancel_run(
        &self,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError>;

    fn notify_step_transition(
        &self,
        capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError>;
}

#[derive(Default)]
pub struct UnavailableWorkflowIsolationBroker;

pub fn unavailable_workflow_isolation_broker() -> Arc<dyn WorkflowIsolationBroker> {
    Arc::new(UnavailableWorkflowIsolationBroker)
}

#[async_trait::async_trait]
impl WorkflowIsolationBroker for UnavailableWorkflowIsolationBroker {
    fn attest(
        &self,
        _identity: &WorkflowDeliveryIdentity,
        _policy: &WorkflowIsolationPolicy,
    ) -> Result<WorkflowIsolationAttestation, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    fn spawn_agent(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowAgentLaunchRequest,
    ) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    fn bind_local_gateway(
        &self,
        _capability: &WorkflowIsolationCapability,
        _identity: &WorkflowProcessIdentity,
    ) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn run_command(
        &self,
        _capability: &WorkflowIsolationCapability,
        _request: WorkflowCommandRequest,
    ) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn cleanup_materialization(
        &self,
        capability: &WorkflowIsolationCapability,
        request: WorkflowWorktreeCleanupRequest,
    ) -> Result<WorkflowWorktreeCleanupOutput, WorkflowIsolationError> {
        let (source_root, target_root) = match request.identity.subject() {
            super::WorkflowProcessSubject::Materialization {
                source_root,
                target_root,
                ..
            } => (source_root.clone(), target_root.clone()),
            _ => return Err(WorkflowIsolationError::RequestIdentityMismatch),
        };
        // This broker never starts an operation, so its operation ledger proves
        // there are no artifacts attributable to this identity. A foreign path
        // at the target is not this unavailable broker's artifact and is never
        // removed here.
        Ok(WorkflowWorktreeCleanupOutput {
            identity: request.identity,
            canonical_source_root: source_root,
            canonical_target_root: target_root,
            branch: request.branch,
            base_commit_oid: request.base_commit_oid,
            checkout_absent: true,
            branch_ref_absent: true,
            all_operation_artifacts_absent: true,
            execution_generation: capability.identity().execution_generation(),
            broker_generation: capability.broker_generation(),
        })
    }

    async fn cancel_process_group(
        &self,
        _capability: &WorkflowIsolationCapability,
        _process_group: &WorkflowProcessGroup,
    ) -> Result<(), WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    async fn cancel_run(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }

    fn notify_step_transition(
        &self,
        _capability: &WorkflowIsolationCapability,
    ) -> Result<(), WorkflowIsolationError> {
        Err(WorkflowIsolationError::Unavailable)
    }
}

pub struct WorkflowProcessGroupGuard {
    broker: Arc<dyn WorkflowIsolationBroker>,
    capability: WorkflowIsolationCapability,
    process_group: WorkflowProcessGroup,
    armed: bool,
}

impl WorkflowProcessGroupGuard {
    pub fn new(
        broker: Arc<dyn WorkflowIsolationBroker>,
        capability: WorkflowIsolationCapability,
        process_group: WorkflowProcessGroup,
    ) -> Self {
        Self {
            broker,
            capability,
            process_group,
            armed: true,
        }
    }

    /// Ordinary shutdown path. Drop remains only an emergency retry for panic
    /// or abrupt unwinding and is never counted as cleanup proof.
    pub async fn quiesce(&mut self) -> Result<(), WorkflowIsolationError> {
        if !self.armed {
            return Ok(());
        }
        let result = if self.process_group.matches_capability(&self.capability) {
            cancel_workflow_process_group_bounded(
                self.broker.as_ref(),
                &self.capability,
                &self.process_group,
            )
            .await
        } else {
            cancel_workflow_run_bounded(self.broker.as_ref(), &self.capability).await
        };
        if result.is_ok() {
            self.armed = false;
        }
        result
    }
}

impl Drop for WorkflowProcessGroupGuard {
    fn drop(&mut self) {
        if self.armed {
            // Emergency retry only; terminal publication never treats this
            // detached task as proof. Do not block Drop or a Tokio worker on a
            // helper/sidecar IPC call.
            let broker = self.broker.clone();
            let capability = self.capability.clone();
            let process_group = self.process_group.clone();
            let group_matches = process_group.matches_capability(&capability);
            match tokio::runtime::Handle::try_current() {
                Ok(runtime) => {
                    runtime.spawn(async move {
                        let cleanup = if group_matches {
                            cancel_workflow_process_group_bounded(
                                broker.as_ref(),
                                &capability,
                                &process_group,
                            )
                            .await
                        } else {
                            cancel_workflow_run_bounded(broker.as_ref(), &capability).await
                        };
                        if cleanup.is_err() {
                            tracing::error!(
                                run_id = capability.identity().run_id(),
                                "emergency workflow process-group cleanup retry failed"
                            );
                        }
                    });
                }
                Err(_) => tracing::error!(
                    run_id = capability.identity().run_id(),
                    "armed workflow process-group guard dropped without an async runtime"
                ),
            }
        }
    }
}

#[cfg(not(test))]
const WORKFLOW_BROKER_QUIESCE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
#[cfg(test)]
const WORKFLOW_BROKER_QUIESCE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);

pub async fn cancel_workflow_run_bounded(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
) -> Result<(), WorkflowIsolationError> {
    tokio::time::timeout(
        WORKFLOW_BROKER_QUIESCE_TIMEOUT,
        broker.cancel_run(capability),
    )
    .await
    .map_err(|_| WorkflowIsolationError::CleanupRequired)?
}

pub async fn cancel_workflow_process_group_bounded(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    process_group: &WorkflowProcessGroup,
) -> Result<(), WorkflowIsolationError> {
    tokio::time::timeout(
        WORKFLOW_BROKER_QUIESCE_TIMEOUT,
        broker.cancel_process_group(capability, process_group),
    )
    .await
    .map_err(|_| WorkflowIsolationError::CleanupRequired)?
}

#[derive(Debug, thiserror::Error)]
pub enum WorkflowIsolationError {
    #[error("workflow agent isolation is unavailable")]
    Unavailable,
    #[error("workflow delivery identity is incomplete ({0})")]
    IdentityIncomplete(&'static str),
    #[error("workflow isolation attestation does not match the delivery identity")]
    AttestationIdentityMismatch,
    #[error("workflow isolation attestation does not match the runtime policy")]
    AttestationPolicyMismatch,
    #[error("workflow broker request identity does not match its capability")]
    RequestIdentityMismatch,
    #[error("workflow isolation attestation is invalid")]
    InvalidAttestation,
    #[error("workflow isolation policy is invalid")]
    InvalidPolicy,
    #[error("workflow broker request path is outside the attested roots")]
    RequestPathDenied,
    #[error("trusted local workflow gateway binding is invalid")]
    InvalidLocalGatewayBinding,
    #[error("workflow process group identity is invalid")]
    InvalidProcessGroup,
    #[error("workflow process identity is invalid ({0})")]
    InvalidProcessIdentity(&'static str),
    #[error("workflow broker launch failed")]
    LaunchFailed,
    #[error("workflow broker command failed")]
    CommandFailed,
    #[error("workflow broker command timed out")]
    TimedOut,
    #[error("workflow broker command was cancelled")]
    Cancelled,
    #[error("workflow broker command resource limits are invalid")]
    InvalidResourceLimits,
    #[error("workflow broker request grammar is invalid")]
    InvalidRequestGrammar,
    #[error("workflow broker command exceeded its output limit")]
    OutputLimitExceeded,
    #[error("workflow broker operation is not authorized for its process subject")]
    OperationDenied,
    #[error("workflow executable is not authorized by the immutable artifact catalog")]
    ExecutableDenied,
    #[error("workflow cleanup could not prove process and capability quiescence")]
    CleanupRequired,
}

impl WorkflowIsolationError {
    pub fn code(&self) -> &'static str {
        WORKFLOW_AGENT_ISOLATION_UNAVAILABLE
    }
}
