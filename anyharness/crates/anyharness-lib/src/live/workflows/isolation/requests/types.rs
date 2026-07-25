//! Validated broker request, output, and resource-limit vocabulary.

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

use super::super::policy::valid_policy_digest;
use super::super::{WorkflowIsolationError, WorkflowProcessIdentity};
use super::{
    WORKFLOW_AGENT_CPU_TIME_LIMIT, WORKFLOW_AGENT_MEMORY_LIMIT, WORKFLOW_AGENT_OUTPUT_LIMIT,
    WORKFLOW_AGENT_PROCESS_LIMIT, WORKFLOW_AGENT_WALL_TIME_LIMIT,
};
use crate::process_env::{WorkflowAgentEnvironment, WorkflowOperationEnvironment};

#[derive(Clone)]
pub struct WorkflowAgentLaunchRequest {
    pub identity: WorkflowProcessIdentity,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Complete child environment. Implementations MUST call `env_clear()` and
    /// then apply only these pairs; ambient inheritance invalidates attestation.
    pub env: WorkflowAgentEnvironment,
    pub resources: WorkflowAgentResourceLimits,
}

impl fmt::Debug for WorkflowAgentLaunchRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowAgentLaunchRequest")
            .field("identity", &self.identity)
            .field("program", &self.program)
            .field("arg_count", &self.args.len())
            .field("cwd", &self.cwd)
            .field(
                "env_keys",
                &self
                    .env
                    .pairs()
                    .iter()
                    .map(|(key, _)| key)
                    .collect::<Vec<_>>(),
            )
            .field("resources", &self.resources)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowAgentResourceLimits {
    pub wall_time: Duration,
    pub cpu_time: Duration,
    pub max_processes: u32,
    pub max_memory_bytes: u64,
    pub max_stdout_bytes: usize,
    pub max_stderr_bytes: usize,
    pub max_combined_bytes: usize,
}

impl WorkflowAgentResourceLimits {
    pub fn phase_a_maximums() -> Self {
        Self {
            wall_time: WORKFLOW_AGENT_WALL_TIME_LIMIT,
            cpu_time: WORKFLOW_AGENT_CPU_TIME_LIMIT,
            max_processes: WORKFLOW_AGENT_PROCESS_LIMIT,
            max_memory_bytes: WORKFLOW_AGENT_MEMORY_LIMIT,
            max_stdout_bytes: WORKFLOW_AGENT_OUTPUT_LIMIT,
            max_stderr_bytes: WORKFLOW_AGENT_OUTPUT_LIMIT,
            max_combined_bytes: WORKFLOW_AGENT_OUTPUT_LIMIT,
        }
    }

    pub(super) fn is_valid(&self) -> bool {
        !self.wall_time.is_zero()
            && self.wall_time <= WORKFLOW_AGENT_WALL_TIME_LIMIT
            && !self.cpu_time.is_zero()
            && self.cpu_time <= WORKFLOW_AGENT_CPU_TIME_LIMIT
            && self.max_processes > 0
            && self.max_processes <= WORKFLOW_AGENT_PROCESS_LIMIT
            && self.max_memory_bytes > 0
            && self.max_memory_bytes <= WORKFLOW_AGENT_MEMORY_LIMIT
            && self.max_stdout_bytes > 0
            && self.max_stdout_bytes <= WORKFLOW_AGENT_OUTPUT_LIMIT
            && self.max_stderr_bytes > 0
            && self.max_stderr_bytes <= WORKFLOW_AGENT_OUTPUT_LIMIT
            && self.max_combined_bytes > 0
            && self.max_combined_bytes <= WORKFLOW_AGENT_OUTPUT_LIMIT
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowExecutableAuthorization {
    pub identity: WorkflowProcessIdentity,
    pub requested_program: PathBuf,
    pub canonical_program: PathBuf,
    pub sha256: String,
    pub execution_generation: i64,
    pub broker_generation: u64,
}

impl WorkflowExecutableAuthorization {
    pub fn try_new(
        identity: WorkflowProcessIdentity,
        requested_program: PathBuf,
        canonical_program: PathBuf,
        sha256: impl Into<String>,
        execution_generation: i64,
        broker_generation: u64,
    ) -> Result<Self, WorkflowIsolationError> {
        let sha256 = sha256.into();
        if requested_program.as_os_str().is_empty()
            || !canonical_program.is_absolute()
            || !valid_policy_digest(&sha256)
            || execution_generation <= 0
            || broker_generation == 0
        {
            return Err(WorkflowIsolationError::ExecutableDenied);
        }
        Ok(Self {
            identity,
            requested_program,
            canonical_program,
            sha256,
            execution_generation,
            broker_generation,
        })
    }
}

#[derive(Clone)]
pub struct WorkflowCommandRequest {
    pub identity: WorkflowProcessIdentity,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Complete child environment; same `env_clear()` contract as agent launch.
    pub env: WorkflowOperationEnvironment,
    pub timeout: Duration,
    /// Adapters must enforce these while streaming, never after buffering.
    pub max_stdout_bytes: usize,
    pub max_stderr_bytes: usize,
    pub max_combined_bytes: usize,
    pub max_processes: u32,
    pub max_memory_bytes: u64,
}

impl fmt::Debug for WorkflowCommandRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowCommandRequest")
            .field("identity", &self.identity)
            .field("program", &self.program)
            .field("arg_count", &self.args.len())
            .field("cwd", &self.cwd)
            .field(
                "env_keys",
                &self
                    .env
                    .pairs()
                    .iter()
                    .map(|(key, _)| key)
                    .collect::<Vec<_>>(),
            )
            .field("timeout", &self.timeout)
            .field("max_stdout_bytes", &self.max_stdout_bytes)
            .field("max_stderr_bytes", &self.max_stderr_bytes)
            .field("max_combined_bytes", &self.max_combined_bytes)
            .field("max_processes", &self.max_processes)
            .field("max_memory_bytes", &self.max_memory_bytes)
            .finish()
    }
}

#[derive(Clone)]
pub struct WorkflowWorktreeMaterializationRequest {
    pub identity: WorkflowProcessIdentity,
    pub source_root: PathBuf,
    pub target_root: PathBuf,
    pub branch: String,
    pub base_commit_oid: String,
    /// Complete helper environment; the adapter must `env_clear()` before use.
    pub env: WorkflowOperationEnvironment,
}

impl fmt::Debug for WorkflowWorktreeMaterializationRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowWorktreeMaterializationRequest")
            .field("identity", &self.identity)
            .field("source_root", &self.source_root)
            .field("target_root", &self.target_root)
            .field("branch", &self.branch)
            .field("base_commit_oid", &self.base_commit_oid)
            .field(
                "env_keys",
                &self
                    .env
                    .pairs()
                    .iter()
                    .map(|(key, _)| key)
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowWorktreeMaterializationOutput {
    pub canonical_source_root: PathBuf,
    pub canonical_target_root: PathBuf,
    pub branch: String,
    pub base_commit_oid: String,
    pub head_oid: String,
    pub execution_generation: i64,
    pub broker_generation: u64,
}

#[derive(Debug, Clone)]
pub struct WorkflowWorktreeInspectionRequest {
    pub identity: WorkflowProcessIdentity,
    pub root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowWorktreeInspectionOutput {
    pub canonical_root: PathBuf,
    pub branch: String,
    pub head_oid: String,
    pub execution_generation: i64,
    pub broker_generation: u64,
}

#[derive(Debug, Clone)]
pub struct WorkflowWorktreeCleanupRequest {
    pub identity: WorkflowProcessIdentity,
    pub source_root: PathBuf,
    pub target_root: PathBuf,
    pub branch: String,
    pub base_commit_oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowWorktreeCleanupOutput {
    pub identity: WorkflowProcessIdentity,
    pub canonical_source_root: PathBuf,
    pub canonical_target_root: PathBuf,
    pub branch: String,
    pub base_commit_oid: String,
    /// Explicit proof for the two user-visible Git artifacts. These are in
    /// addition to the broker-ledger-wide seal below; neither is inferred from
    /// a workspace-row deletion or a control-process Git command.
    pub checkout_absent: bool,
    pub branch_ref_absent: bool,
    /// True only after the broker has reconciled its operation ledger and
    /// proven every artifact created by this materialization is absent.
    pub all_operation_artifacts_absent: bool,
    pub execution_generation: i64,
    pub broker_generation: u64,
}

pub struct WorkflowCommandOutput {
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl fmt::Debug for WorkflowCommandOutput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WorkflowCommandOutput")
            .field("exit_code", &self.exit_code)
            .field("stdout_bytes", &self.stdout.len())
            .field("stderr_bytes", &self.stderr.len())
            .finish()
    }
}
