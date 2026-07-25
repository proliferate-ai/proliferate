//! Immutable delivery and process-subject identities.

use std::path::{Path, PathBuf};

use super::policy::{canonical_declared_root, valid_policy_digest};
use super::WorkflowIsolationError;
use crate::domains::workflows::plan::valid_worktree_identity_token;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowDeliveryIdentity {
    run_id: String,
    plan_hash: String,
    binding_hash: String,
    execution_generation: i64,
}

impl WorkflowDeliveryIdentity {
    pub fn try_new(
        run_id: impl Into<String>,
        plan_hash: Option<&str>,
        binding_hash: Option<&str>,
        execution_generation: Option<i64>,
    ) -> Result<Self, WorkflowIsolationError> {
        let run_id = run_id.into();
        if !valid_worktree_identity_token(&run_id) {
            return Err(WorkflowIsolationError::IdentityIncomplete("run_id"));
        }
        let plan_hash = required_identity_hash(plan_hash, "plan_hash")?;
        let binding_hash = required_identity_hash(binding_hash, "binding_hash")?;
        let execution_generation = execution_generation
            .filter(|generation| *generation > 0)
            .ok_or(WorkflowIsolationError::IdentityIncomplete(
                "execution_generation",
            ))?;
        Ok(Self {
            run_id,
            plan_hash,
            binding_hash,
            execution_generation,
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn plan_hash(&self) -> &str {
        &self.plan_hash
    }

    pub fn binding_hash(&self) -> &str {
        &self.binding_hash
    }

    pub fn execution_generation(&self) -> i64 {
        self.execution_generation
    }
}

fn required_identity_field(
    value: Option<&str>,
    name: &'static str,
) -> Result<String, WorkflowIsolationError> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or(WorkflowIsolationError::IdentityIncomplete(name))
}

fn required_identity_hash(
    value: Option<&str>,
    name: &'static str,
) -> Result<String, WorkflowIsolationError> {
    let value = required_identity_field(value, name)?;
    if !valid_policy_digest(&value) {
        return Err(WorkflowIsolationError::IdentityIncomplete(name));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowProcessSubject {
    Session {
        slot_id: String,
        session_id: String,
        root: PathBuf,
    },
    Step {
        step_key: String,
        attempt: i64,
        kind: WorkflowCommandKind,
        root: PathBuf,
    },
    LaneMerge {
        lane_id: String,
        root: PathBuf,
    },
    Materialization {
        scope_id: String,
        source_root: PathBuf,
        target_root: PathBuf,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowCommandKind {
    Shell,
    Verify,
    Scm,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowProcessIdentity {
    delivery: WorkflowDeliveryIdentity,
    subject: WorkflowProcessSubject,
}

impl WorkflowProcessIdentity {
    #[cfg(test)]
    pub(crate) fn new(delivery: WorkflowDeliveryIdentity, subject: WorkflowProcessSubject) -> Self {
        Self { delivery, subject }
    }

    pub fn try_session(
        delivery: WorkflowDeliveryIdentity,
        slot_id: impl Into<String>,
        session_id: impl Into<String>,
        root: impl Into<PathBuf>,
    ) -> Result<Self, WorkflowIsolationError> {
        let slot_id = required_process_identity_value(slot_id.into(), "slot_id")?;
        let session_id = required_process_identity_value(session_id.into(), "session_id")?;
        let root = canonical_declared_root(&root.into())?;
        Ok(Self {
            delivery,
            subject: WorkflowProcessSubject::Session {
                slot_id,
                session_id,
                root,
            },
        })
    }

    pub fn try_step(
        delivery: WorkflowDeliveryIdentity,
        step_key: impl Into<String>,
        attempt: i64,
        kind: WorkflowCommandKind,
        root: impl Into<PathBuf>,
    ) -> Result<Self, WorkflowIsolationError> {
        let step_key = required_process_identity_value(step_key.into(), "step_key")?;
        if attempt <= 0 {
            return Err(WorkflowIsolationError::InvalidProcessIdentity("attempt"));
        }
        let root = canonical_declared_root(&root.into())?;
        Ok(Self {
            delivery,
            subject: WorkflowProcessSubject::Step {
                step_key,
                attempt,
                kind,
                root,
            },
        })
    }

    pub fn try_lane_merge(
        delivery: WorkflowDeliveryIdentity,
        lane_id: impl Into<String>,
        root: impl Into<PathBuf>,
    ) -> Result<Self, WorkflowIsolationError> {
        let lane_id = required_process_identity_value(lane_id.into(), "lane_id")?;
        let root = canonical_declared_root(&root.into())?;
        Ok(Self {
            delivery,
            subject: WorkflowProcessSubject::LaneMerge { lane_id, root },
        })
    }

    pub fn try_materialization(
        delivery: WorkflowDeliveryIdentity,
        scope_id: impl Into<String>,
        source_root: impl Into<PathBuf>,
        target_root: impl Into<PathBuf>,
    ) -> Result<Self, WorkflowIsolationError> {
        let scope_id = required_process_identity_value(scope_id.into(), "scope_id")?;
        let source_root = canonical_declared_root(&source_root.into())?;
        let target_root = canonical_declared_root(&target_root.into())?;
        Ok(Self {
            delivery,
            subject: WorkflowProcessSubject::Materialization {
                scope_id,
                source_root,
                target_root,
            },
        })
    }

    pub fn delivery(&self) -> &WorkflowDeliveryIdentity {
        &self.delivery
    }

    pub fn subject(&self) -> &WorkflowProcessSubject {
        &self.subject
    }

    pub fn allows_cwd(&self, cwd: &Path) -> bool {
        let Ok(cwd) = canonical_declared_root(cwd) else {
            return false;
        };
        match &self.subject {
            WorkflowProcessSubject::Session { root, .. }
            | WorkflowProcessSubject::Step { root, .. }
            | WorkflowProcessSubject::LaneMerge { root, .. } => &cwd == root,
            WorkflowProcessSubject::Materialization {
                source_root,
                target_root,
                ..
            } => &cwd == source_root || &cwd == target_root,
        }
    }

    pub fn allows_materialization(&self, source: &Path, target: &Path) -> bool {
        let (Ok(source), Ok(target)) = (
            canonical_declared_root(source),
            canonical_declared_root(target),
        ) else {
            return false;
        };
        matches!(
            &self.subject,
            WorkflowProcessSubject::Materialization {
                source_root,
                target_root,
                ..
            } if &source == source_root && &target == target_root
        )
    }
}

fn required_process_identity_value(
    value: String,
    field: &'static str,
) -> Result<String, WorkflowIsolationError> {
    if matches!(field, "lane_id" | "scope_id") {
        if !valid_worktree_identity_token(&value) {
            return Err(WorkflowIsolationError::InvalidProcessIdentity(field));
        }
        return Ok(value);
    }
    let (max_bytes, allow_colon) = match field {
        "step_key" => (512, true),
        "slot_id" | "session_id" | "lane_id" | "scope_id" => (128, false),
        _ => (128, false),
    };
    if !valid_identity_token(&value, max_bytes, allow_colon) {
        return Err(WorkflowIsolationError::InvalidProcessIdentity(field));
    }
    Ok(value)
}

fn valid_identity_token(value: &str, max_bytes: usize, allow_colon: bool) -> bool {
    !value.is_empty()
        && value.len() <= max_bytes
        && value == value.trim()
        && !matches!(value, "." | "..")
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(byte, b'-' | b'_' | b'.')
                || (allow_colon && byte == b':')
        })
}
