//! Default-deny broker request DTOs and their validated wrapper functions.

use std::path::PathBuf;
use std::time::Duration;

use super::policy::{canonical_declared_root, valid_policy_digest};
use super::{
    cancel_workflow_run_bounded, BrokeredWorkflowAgentProcess, TrustedLocalGatewayBinding,
    WorkflowCommandKind, WorkflowIsolationBroker, WorkflowIsolationCapability,
    WorkflowIsolationError, WorkflowProcessIdentity, WorkflowProcessSubject,
};

mod types;
pub use types::*;

pub const WORKFLOW_COMMAND_STDOUT_LIMIT: usize = 1_048_576;
pub const WORKFLOW_COMMAND_STDERR_LIMIT: usize = 1_048_576;
pub const WORKFLOW_COMMAND_COMBINED_LIMIT: usize = 1_572_864;
pub const WORKFLOW_COMMAND_PROCESS_LIMIT: u32 = 64;
pub const WORKFLOW_COMMAND_MEMORY_LIMIT: u64 = 1_073_741_824;
pub const WORKFLOW_COMMAND_TIMEOUT_LIMIT: Duration = Duration::from_secs(3_600);
pub const WORKFLOW_AGENT_WALL_TIME_LIMIT: Duration = Duration::from_secs(86_400);
pub const WORKFLOW_AGENT_CPU_TIME_LIMIT: Duration = Duration::from_secs(43_200);
pub const WORKFLOW_AGENT_PROCESS_LIMIT: u32 = 256;
pub const WORKFLOW_AGENT_MEMORY_LIMIT: u64 = 4_294_967_296;
pub const WORKFLOW_AGENT_OUTPUT_LIMIT: usize = 8_388_608;
const WORKFLOW_AGENT_ARG_COUNT_LIMIT: usize = 256;
const WORKFLOW_AGENT_ARG_BYTES_LIMIT: usize = 65_536;
const WORKFLOW_AGENT_ENV_COUNT_LIMIT: usize = 128;
const WORKFLOW_AGENT_ENV_KEY_BYTES_LIMIT: usize = 128;
const WORKFLOW_AGENT_ENV_VALUE_BYTES_LIMIT: usize = 65_536;
const WORKFLOW_AGENT_ENV_TOTAL_BYTES_LIMIT: usize = 262_144;
const WORKFLOW_REQUEST_ARG_COUNT_LIMIT: usize = 256;
const WORKFLOW_REQUEST_ARG_BYTES_LIMIT: usize = 262_144;
#[cfg(not(test))]
const WORKFLOW_MATERIALIZATION_TIMEOUT: Duration = Duration::from_secs(300);
#[cfg(test)]
const WORKFLOW_MATERIALIZATION_TIMEOUT: Duration = Duration::from_millis(100);
#[cfg(not(test))]
const WORKFLOW_MATERIALIZATION_CLEANUP_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(test)]
const WORKFLOW_MATERIALIZATION_CLEANUP_TIMEOUT: Duration = Duration::from_millis(100);
#[cfg(not(test))]
const WORKFLOW_WORKTREE_INSPECTION_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(test)]
const WORKFLOW_WORKTREE_INSPECTION_TIMEOUT: Duration = Duration::from_millis(100);

fn validate_request_identity(
    capability: &WorkflowIsolationCapability,
    identity: &WorkflowProcessIdentity,
) -> Result<(), WorkflowIsolationError> {
    if identity.delivery() != capability.identity() {
        return Err(WorkflowIsolationError::RequestIdentityMismatch);
    }
    Ok(())
}

fn validate_request_cwd(
    capability: &WorkflowIsolationCapability,
    identity: &WorkflowProcessIdentity,
    cwd: &std::path::Path,
) -> Result<(), WorkflowIsolationError> {
    if !capability.policy().allows_cwd(cwd) || !identity.allows_cwd(cwd) {
        return Err(WorkflowIsolationError::RequestPathDenied);
    }
    Ok(())
}

pub async fn spawn_workflow_agent(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    mut request: WorkflowAgentLaunchRequest,
) -> Result<BrokeredWorkflowAgentProcess, WorkflowIsolationError> {
    validate_request_identity(capability, &request.identity)?;
    validate_request_cwd(capability, &request.identity, &request.cwd)?;
    if !matches!(
        request.identity.subject(),
        WorkflowProcessSubject::Session { .. }
    ) {
        return Err(WorkflowIsolationError::OperationDenied);
    }
    validate_agent_request_grammar(&request)?;
    request.program =
        authorize_executable(broker, capability, &request.identity, &request.program)?;
    let expected_identity = request.identity.clone();
    let mut brokered = broker.spawn_agent(capability, request)?;
    if !brokered
        .process_group
        .matches(capability, &expected_identity)
    {
        let (run_cleanup, root_cleanup) = tokio::join!(
            cancel_workflow_run_bounded(broker, capability),
            terminate_root_process_and_wait(&mut brokered.child),
        );
        if run_cleanup.is_err() || root_cleanup.is_err() {
            return Err(WorkflowIsolationError::CleanupRequired);
        }
        return Err(WorkflowIsolationError::InvalidProcessGroup);
    }
    Ok(brokered)
}

async fn terminate_root_process_and_wait(
    child: &mut tokio::process::Child,
) -> Result<(), WorkflowIsolationError> {
    if child
        .try_wait()
        .map_err(|_| WorkflowIsolationError::CleanupRequired)?
        .is_some()
    {
        return Ok(());
    }
    child
        .start_kill()
        .map_err(|_| WorkflowIsolationError::CleanupRequired)?;
    tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .map_err(|_| WorkflowIsolationError::CleanupRequired)?
        .map_err(|_| WorkflowIsolationError::CleanupRequired)?;
    Ok(())
}

fn validate_agent_request_grammar(
    request: &WorkflowAgentLaunchRequest,
) -> Result<(), WorkflowIsolationError> {
    if !request.resources.is_valid() {
        return Err(WorkflowIsolationError::InvalidResourceLimits);
    }
    if !valid_bounded_args(
        &request.args,
        WORKFLOW_AGENT_ARG_COUNT_LIMIT,
        WORKFLOW_AGENT_ARG_BYTES_LIMIT,
    ) {
        return Err(WorkflowIsolationError::InvalidRequestGrammar);
    }
    if !request.env.is_policy_valid() {
        return Err(WorkflowIsolationError::InvalidRequestGrammar);
    }
    validate_bounded_env(request.env.pairs())
}

fn valid_bounded_args(args: &[String], count_limit: usize, bytes_limit: usize) -> bool {
    args.len() <= count_limit
        && !args.iter().any(|arg| arg.contains('\0'))
        && args.iter().map(String::len).sum::<usize>() <= bytes_limit
}

fn validate_bounded_env(env: &[(String, String)]) -> Result<(), WorkflowIsolationError> {
    if env.len() > WORKFLOW_AGENT_ENV_COUNT_LIMIT {
        return Err(WorkflowIsolationError::InvalidRequestGrammar);
    }
    let mut keys = std::collections::BTreeSet::new();
    let mut total = 0usize;
    for (key, value) in env {
        total = total.saturating_add(key.len()).saturating_add(value.len());
        let valid_key = !key.is_empty()
            && key.len() <= WORKFLOW_AGENT_ENV_KEY_BYTES_LIMIT
            && key
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
            && !key.as_bytes()[0].is_ascii_digit();
        if !valid_key
            || value.len() > WORKFLOW_AGENT_ENV_VALUE_BYTES_LIMIT
            || value.contains('\0')
            || !keys.insert(key)
            || total > WORKFLOW_AGENT_ENV_TOTAL_BYTES_LIMIT
        {
            return Err(WorkflowIsolationError::InvalidRequestGrammar);
        }
    }
    Ok(())
}

pub async fn run_workflow_command(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    mut request: WorkflowCommandRequest,
) -> Result<WorkflowCommandOutput, WorkflowIsolationError> {
    validate_request_identity(capability, &request.identity)?;
    validate_request_cwd(capability, &request.identity, &request.cwd)?;
    if !valid_bounded_args(
        &request.args,
        WORKFLOW_REQUEST_ARG_COUNT_LIMIT,
        WORKFLOW_REQUEST_ARG_BYTES_LIMIT,
    ) {
        return Err(WorkflowIsolationError::InvalidRequestGrammar);
    }
    if !request.env.is_policy_valid() {
        return Err(WorkflowIsolationError::InvalidRequestGrammar);
    }
    validate_bounded_env(request.env.pairs())?;
    validate_command_operation(&request)?;
    if request.timeout.is_zero()
        || request.timeout > WORKFLOW_COMMAND_TIMEOUT_LIMIT
        || request.max_stdout_bytes == 0
        || request.max_stdout_bytes > WORKFLOW_COMMAND_STDOUT_LIMIT
        || request.max_stderr_bytes == 0
        || request.max_stderr_bytes > WORKFLOW_COMMAND_STDERR_LIMIT
        || request.max_combined_bytes == 0
        || request.max_combined_bytes > WORKFLOW_COMMAND_COMBINED_LIMIT
        || request.max_processes == 0
        || request.max_processes > WORKFLOW_COMMAND_PROCESS_LIMIT
        || request.max_memory_bytes == 0
        || request.max_memory_bytes > WORKFLOW_COMMAND_MEMORY_LIMIT
    {
        return Err(WorkflowIsolationError::InvalidResourceLimits);
    }
    request.program =
        authorize_executable(broker, capability, &request.identity, &request.program)?;
    let stdout_limit = request.max_stdout_bytes;
    let stderr_limit = request.max_stderr_bytes;
    let combined_limit = request.max_combined_bytes;
    let output = broker.run_command(capability, request).await?;
    if output.stdout.len() > stdout_limit
        || output.stderr.len() > stderr_limit
        || output.stdout.len().saturating_add(output.stderr.len()) > combined_limit
    {
        return Err(WorkflowIsolationError::OutputLimitExceeded);
    }
    Ok(output)
}

#[derive(Debug)]
pub struct WorkflowMaterializationFailure {
    pub cause: WorkflowIsolationError,
    /// Present only when the broker returned the complete validated cleanup
    /// receipt after the materialization failed or returned malformed output.
    pub cleanup_receipt: Option<WorkflowWorktreeCleanupOutput>,
}

impl WorkflowMaterializationFailure {
    fn unresolved(cause: WorkflowIsolationError) -> Self {
        Self {
            cause,
            cleanup_receipt: None,
        }
    }

    fn cleaned(
        cause: WorkflowIsolationError,
        cleanup_receipt: WorkflowWorktreeCleanupOutput,
    ) -> Self {
        Self {
            cause,
            cleanup_receipt: Some(cleanup_receipt),
        }
    }
}

impl std::fmt::Display for WorkflowMaterializationFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.cause.fmt(formatter)
    }
}

pub async fn materialize_workflow_worktree(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    request: WorkflowWorktreeMaterializationRequest,
) -> Result<WorkflowWorktreeMaterializationOutput, WorkflowMaterializationFailure> {
    validate_request_identity(capability, &request.identity)
        .map_err(WorkflowMaterializationFailure::unresolved)?;
    if !matches!(
        request.identity.subject(),
        WorkflowProcessSubject::Materialization { .. }
    ) {
        return Err(WorkflowMaterializationFailure::unresolved(
            WorkflowIsolationError::OperationDenied,
        ));
    }
    if !request.env.is_policy_valid() {
        return Err(WorkflowMaterializationFailure::unresolved(
            WorkflowIsolationError::InvalidRequestGrammar,
        ));
    }
    validate_bounded_env(request.env.pairs())
        .map_err(WorkflowMaterializationFailure::unresolved)?;
    if !capability
        .policy()
        .permits_materialization(&request.source_root, &request.target_root)
        || !request
            .identity
            .allows_materialization(&request.source_root, &request.target_root)
        || !valid_worktree_branch(&request.branch)
        || !valid_commit_oid(&request.base_commit_oid)
    {
        return Err(WorkflowMaterializationFailure::unresolved(
            WorkflowIsolationError::RequestPathDenied,
        ));
    }
    let expected_source = canonical_declared_root(&request.source_root)
        .map_err(WorkflowMaterializationFailure::unresolved)?;
    let expected_target = canonical_declared_root(&request.target_root)
        .map_err(WorkflowMaterializationFailure::unresolved)?;
    let expected_branch = request.branch.clone();
    let expected_base_commit_oid = request.base_commit_oid.clone();
    let cleanup_request = WorkflowWorktreeCleanupRequest {
        identity: request.identity.clone(),
        source_root: request.source_root.clone(),
        target_root: request.target_root.clone(),
        branch: request.branch.clone(),
        base_commit_oid: request.base_commit_oid.clone(),
    };
    // The durable caller records this operation before entering the broker. An
    // adapter error is ambiguous: it may have created a path, ref, or ledger
    // artifact before losing the response. Reconcile by operation identity on
    // every error; only an all-artifacts-absent receipt may preserve the original
    // error. Failed/ambiguous reconciliation becomes CleanupRequired.
    let materialization = tokio::time::timeout(
        WORKFLOW_MATERIALIZATION_TIMEOUT,
        broker.materialize_worktree(capability, request),
    )
    .await
    .unwrap_or(Err(WorkflowIsolationError::TimedOut));
    let output = match materialization {
        Ok(output) => output,
        Err(error) => {
            return match cleanup_workflow_materialization(broker, capability, cleanup_request).await
            {
                Ok(receipt) => Err(WorkflowMaterializationFailure::cleaned(error, receipt)),
                Err(_) => Err(WorkflowMaterializationFailure::unresolved(
                    WorkflowIsolationError::CleanupRequired,
                )),
            };
        }
    };
    let returned_source = canonical_declared_root(&output.canonical_source_root);
    let returned_target = canonical_declared_root(&output.canonical_target_root);
    if returned_source.as_ref().ok() != Some(&expected_source)
        || returned_target.as_ref().ok() != Some(&expected_target)
        || output.branch != expected_branch
        || output.base_commit_oid != expected_base_commit_oid
        || output.head_oid != expected_base_commit_oid
        || !valid_commit_oid(&output.head_oid)
        || output.execution_generation != capability.identity().execution_generation()
        || output.broker_generation != capability.broker_generation()
    {
        return match cleanup_workflow_materialization(broker, capability, cleanup_request).await {
            Ok(receipt) => Err(WorkflowMaterializationFailure::cleaned(
                WorkflowIsolationError::RequestPathDenied,
                receipt,
            )),
            Err(_) => Err(WorkflowMaterializationFailure::unresolved(
                WorkflowIsolationError::CleanupRequired,
            )),
        };
    }
    Ok(output)
}

pub async fn cleanup_workflow_materialization(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    request: WorkflowWorktreeCleanupRequest,
) -> Result<WorkflowWorktreeCleanupOutput, WorkflowIsolationError> {
    validate_request_identity(capability, &request.identity)?;
    let (identity_source, identity_target) = match request.identity.subject() {
        WorkflowProcessSubject::Materialization {
            source_root,
            target_root,
            ..
        } => (source_root, target_root),
        _ => return Err(WorkflowIsolationError::RequestIdentityMismatch),
    };
    let expected_source = canonical_declared_root(&request.source_root)?;
    let expected_target = canonical_declared_root(&request.target_root)?;
    if &expected_source != identity_source
        || &expected_target != identity_target
        || !capability
            .policy()
            .permits_materialization(&request.source_root, &request.target_root)
        || !request
            .identity
            .allows_materialization(&request.source_root, &request.target_root)
        || !valid_worktree_branch(&request.branch)
        || !valid_commit_oid(&request.base_commit_oid)
    {
        return Err(WorkflowIsolationError::RequestIdentityMismatch);
    }
    let expected_identity = request.identity.clone();
    let expected_branch = request.branch.clone();
    let expected_base_commit_oid = request.base_commit_oid.clone();
    let output = tokio::time::timeout(
        WORKFLOW_MATERIALIZATION_CLEANUP_TIMEOUT,
        broker.cleanup_materialization(capability, request),
    )
    .await
    .map_err(|_| WorkflowIsolationError::CleanupRequired)?
    .map_err(|_| WorkflowIsolationError::CleanupRequired)?;
    if output.identity != expected_identity
        || canonical_declared_root(&output.canonical_source_root)
            .ok()
            .as_ref()
            != Some(&expected_source)
        || canonical_declared_root(&output.canonical_target_root)
            .ok()
            .as_ref()
            != Some(&expected_target)
        || output.branch != expected_branch
        || output.base_commit_oid != expected_base_commit_oid
        || !output.checkout_absent
        || !output.branch_ref_absent
        || !output.all_operation_artifacts_absent
        || output.execution_generation != capability.identity().execution_generation()
        || output.broker_generation != capability.broker_generation()
    {
        return Err(WorkflowIsolationError::CleanupRequired);
    }
    Ok(output)
}

pub async fn inspect_workflow_worktree(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    request: WorkflowWorktreeInspectionRequest,
) -> Result<WorkflowWorktreeInspectionOutput, WorkflowIsolationError> {
    validate_request_identity(capability, &request.identity)?;
    if !matches!(
        request.identity.subject(),
        WorkflowProcessSubject::Materialization { .. }
    ) {
        return Err(WorkflowIsolationError::OperationDenied);
    }
    validate_request_cwd(capability, &request.identity, &request.root)?;
    let expected_root = canonical_declared_root(&request.root)?;
    let output = tokio::time::timeout(
        WORKFLOW_WORKTREE_INSPECTION_TIMEOUT,
        broker.inspect_worktree(capability, request),
    )
    .await
    .map_err(|_| WorkflowIsolationError::TimedOut)??;
    if canonical_declared_root(&output.canonical_root)? != expected_root
        || !valid_worktree_branch(&output.branch)
        || !valid_commit_oid(&output.head_oid)
        || output.execution_generation != capability.identity().execution_generation()
        || output.broker_generation != capability.broker_generation()
    {
        return Err(WorkflowIsolationError::RequestPathDenied);
    }
    Ok(output)
}

fn valid_commit_oid(oid: &str) -> bool {
    matches!(oid.len(), 40 | 64)
        && oid
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_worktree_branch(branch: &str) -> bool {
    !branch.is_empty()
        && branch.len() <= 255
        && !matches!(branch.as_bytes().first(), Some(b'-' | b'/' | b'.'))
        && !matches!(branch.as_bytes().last(), Some(b'/' | b'.'))
        && !branch.contains("..")
        && !branch.contains("//")
        && !branch.contains("@{")
        && branch.split('/').all(|component| {
            !component.is_empty() && !component.starts_with('.') && !component.ends_with(".lock")
        })
        && branch
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_/.".contains(&byte))
}

fn validate_command_operation(
    request: &WorkflowCommandRequest,
) -> Result<(), WorkflowIsolationError> {
    let allowed = match request.identity.subject() {
        WorkflowProcessSubject::Step { kind, .. } => match kind {
            WorkflowCommandKind::Shell | WorkflowCommandKind::Verify => {
                request.program == std::path::Path::new("/bin/sh")
                    && request.args.len() == 2
                    && request.args.first().is_some_and(|arg| arg == "-lc")
            }
            // Remote SCM effects are outside the Phase-A process primitive.
            // They require a durable claim, exact destination credential, and
            // reconciliation receipt before push/PR can be retried safely.
            WorkflowCommandKind::Scm => false,
        },
        // A generic `git merge` subprocess can honor repository hooks,
        // config, custom merge drivers, signing helpers, and attributes. Phase
        // A therefore parks lane reconciliation until a broker-owned immutable
        // merge/checkpoint operation returns a typed adoption receipt.
        WorkflowProcessSubject::LaneMerge { .. } => false,
        WorkflowProcessSubject::Session { .. } | WorkflowProcessSubject::Materialization { .. } => {
            false
        }
    };
    if !allowed {
        return Err(WorkflowIsolationError::OperationDenied);
    }
    Ok(())
}

fn authorize_executable(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: &WorkflowProcessIdentity,
    requested_program: &std::path::Path,
) -> Result<PathBuf, WorkflowIsolationError> {
    if requested_program.as_os_str().is_empty()
        || requested_program
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(WorkflowIsolationError::ExecutableDenied);
    }
    let authorization = broker.authorize_executable(capability, identity, requested_program)?;
    if &authorization.identity != identity
        || authorization.requested_program != requested_program
        || !authorization.canonical_program.is_absolute()
        || !valid_policy_digest(&authorization.sha256)
        || authorization.execution_generation != capability.identity().execution_generation()
        || authorization.broker_generation != capability.broker_generation()
    {
        return Err(WorkflowIsolationError::ExecutableDenied);
    }
    Ok(authorization.canonical_program)
}

pub fn bind_workflow_local_gateway(
    broker: &dyn WorkflowIsolationBroker,
    capability: &WorkflowIsolationCapability,
    identity: &WorkflowProcessIdentity,
) -> Result<TrustedLocalGatewayBinding, WorkflowIsolationError> {
    validate_request_identity(capability, identity)?;
    let binding = broker.bind_local_gateway(capability, identity)?;
    let WorkflowProcessSubject::Session { session_id, .. } = identity.subject() else {
        return Err(WorkflowIsolationError::RequestIdentityMismatch);
    };
    if binding.session_id() != session_id
        || binding.execution_generation() != capability.identity().execution_generation()
        || binding.broker_generation() != capability.broker_generation()
    {
        return Err(WorkflowIsolationError::RequestIdentityMismatch);
    }
    Ok(binding)
}
