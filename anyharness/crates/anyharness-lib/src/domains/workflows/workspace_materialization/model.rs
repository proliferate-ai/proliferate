//! Domain model for Workflow workspace materialization (spec
//! `workflow-workspace-placement`). The Workflows domain owns the durable
//! materialization record and its coordination; the Workspace domain owns the
//! identity/paths/repo-roots/worktrees/provenance seam it drives.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::domains::workspaces::workflow_placement::{
    ResolvedWorkflowPlacement, WorkflowPlacementError, WorkflowPlacementRequest,
};

/// The exactly-1 schema version this slice accepts.
pub const MATERIALIZATION_SCHEMA_VERSION: u32 = 1;

/// The hard upper bound (in bytes) for a stored `failure_message`. The frozen
/// contract requires a bounded, secret-free failure detail; this enforces the
/// bound at the durable boundary regardless of the caller-supplied string
/// (FAILURE-01).
pub const MAX_FAILURE_MESSAGE_LEN: usize = 512;

/// Bound a failure message to [`MAX_FAILURE_MESSAGE_LEN`] bytes on a UTF-8
/// character boundary, appending a truncation marker when it was oversized.
/// Private to the module: the durable boundary only ever receives a
/// [`MaterializationFailureDetail`], whose constructors apply this bound. No
/// caller can hand a raw `&str` to the failure column.
fn bound_failure_message(message: &str) -> String {
    if message.len() <= MAX_FAILURE_MESSAGE_LEN {
        return message.to_string();
    }
    const MARKER: &str = "…[truncated]";
    let budget = MAX_FAILURE_MESSAGE_LEN.saturating_sub(MARKER.len());
    let mut end = budget;
    while end > 0 && !message.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{MARKER}", &message[..end])
}

/// The durable status of one materialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializationStatus {
    Accepted,
    Materializing,
    Ready,
    Failed,
}

impl MaterializationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Materializing => "materializing",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "accepted" => Some(Self::Accepted),
            "materializing" => Some(Self::Materializing),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Ready | Self::Failed)
    }
}

/// A bounded, secret-free failure code. Never carries prompts, arguments,
/// credentials, environment values, command output, or raw Git stderr.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializationFailureCode {
    RepoRootNotFound,
    BaseRefUnresolvable,
    PlacementMismatch,
    GitFailed,
    WorkspaceFailed,
    Internal,
}

impl MaterializationFailureCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RepoRootNotFound => "repo_root_not_found",
            Self::BaseRefUnresolvable => "base_ref_unresolvable",
            Self::PlacementMismatch => "placement_mismatch",
            Self::GitFailed => "git_failed",
            Self::WorkspaceFailed => "workspace_failed",
            Self::Internal => "internal",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "repo_root_not_found" => Some(Self::RepoRootNotFound),
            "base_ref_unresolvable" => Some(Self::BaseRefUnresolvable),
            "placement_mismatch" => Some(Self::PlacementMismatch),
            "git_failed" => Some(Self::GitFailed),
            "workspace_failed" => Some(Self::WorkspaceFailed),
            "internal" => Some(Self::Internal),
            _ => None,
        }
    }

    /// The fixed, secret-free human string for this code. Never carries
    /// prompts, arguments, credentials, environment values, command output, or
    /// raw Git stderr.
    fn detail_str(self) -> &'static str {
        match self {
            Self::RepoRootNotFound => "repository root not found",
            Self::BaseRefUnresolvable => "base ref could not be resolved",
            Self::PlacementMismatch => "placement mismatch",
            Self::GitFailed => "git/workspace operation failed",
            Self::WorkspaceFailed => "workspace operation failed",
            Self::Internal => "internal error",
        }
    }

    /// Map a workspace-owned placement error into a bounded materialization
    /// failure code plus a secret-free, typed failure detail. All free-form
    /// error payloads are discarded at this durable boundary.
    pub fn from_placement_error(
        error: &WorkflowPlacementError,
    ) -> (Self, MaterializationFailureDetail) {
        match error {
            WorkflowPlacementError::RepoRootNotFound => (
                Self::RepoRootNotFound,
                MaterializationFailureDetail::from_code(Self::RepoRootNotFound),
            ),
            WorkflowPlacementError::BaseRefUnresolvable => (
                Self::BaseRefUnresolvable,
                MaterializationFailureDetail::from_code(Self::BaseRefUnresolvable),
            ),
            WorkflowPlacementError::Mismatch(_) => (
                Self::PlacementMismatch,
                MaterializationFailureDetail::from_code(Self::PlacementMismatch),
            ),
            WorkflowPlacementError::Git(_) => (
                Self::GitFailed,
                MaterializationFailureDetail::from_code(Self::GitFailed),
            ),
        }
    }
}

/// A bounded, secret-free failure detail persisted in the durable
/// `failure_message` column. The inner string is PRIVATE and can only be built
/// through constructors that are safe by construction: from a
/// [`MaterializationFailureCode`] and its fixed constant human string. Every
/// constructed detail is already length-bounded to [`MAX_FAILURE_MESSAGE_LEN`].
/// This makes it impossible for a caller to route arbitrary free-form text
/// (git stderr, tokens, prompts) to the durable failure boundary (FAILURE-01).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationFailureDetail(String);

impl MaterializationFailureDetail {
    /// The fixed constant human string for a failure code.
    pub fn from_code(code: MaterializationFailureCode) -> Self {
        Self(bound_failure_message(code.detail_str()))
    }

    /// Reconstruct a trusted detail read back from the durable column. The
    /// stored value can only have been written through this type, so it is
    /// re-bounded defensively and otherwise trusted.
    pub(super) fn from_stored(stored: String) -> Self {
        Self(bound_failure_message(&stored))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for MaterializationFailureDetail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The durable materialization row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationRecord {
    pub run_id: String,
    pub schema_version: u32,
    pub request_json: String,
    pub resolved_placement_json: Option<String>,
    pub status: MaterializationStatus,
    pub workspace_id: Option<String>,
    pub failure_code: Option<MaterializationFailureCode>,
    pub failure_message: Option<MaterializationFailureDetail>,
    pub created_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
}

impl MaterializationRecord {
    /// The stored resolved placement, if it has been persisted.
    pub fn resolved_placement(&self) -> Option<ResolvedWorkflowPlacement> {
        self.resolved_placement_json
            .as_deref()
            .and_then(|json| serde_json::from_str(json).ok())
    }

    /// The requested placement, decoded from the canonical `request_json`.
    pub fn placement_request(&self) -> Option<WorkflowPlacementRequest> {
        let canonical: CanonicalRequest = serde_json::from_str(&self.request_json).ok()?;
        match canonical.placement.kind.as_str() {
            "scratch" => Some(WorkflowPlacementRequest::Scratch {
                run_id: self.run_id.clone(),
            }),
            "repositoryWorktree" => Some(WorkflowPlacementRequest::RepositoryWorktree {
                run_id: self.run_id.clone(),
                repo_root_id: canonical.placement.repo_root_id?,
                base_ref: canonical.placement.base_ref?,
            }),
            _ => None,
        }
    }
}

/// The strict, validated materialization request derived from the wire body.
/// `request_json` is canonical exact-replay authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationRequest {
    pub run_id: String,
    pub placement: WorkflowPlacementRequest,
    /// The canonical request JSON: the sole replay authority.
    pub request_json: String,
}

/// The domain-owned canonical request serialization: a stable field shape and
/// order, independent of wire whitespace/key order.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalRequest {
    schema_version: u32,
    placement: CanonicalPlacement,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalPlacement {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    repo_root_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_ref: Option<String>,
}

/// The canonical `request_json` for a placement: the exact-replay authority.
pub fn canonical_request_json(placement: &WorkflowPlacementRequest) -> String {
    let canonical = match placement {
        WorkflowPlacementRequest::Scratch { .. } => CanonicalRequest {
            schema_version: MATERIALIZATION_SCHEMA_VERSION,
            placement: CanonicalPlacement {
                kind: "scratch".to_string(),
                repo_root_id: None,
                base_ref: None,
            },
        },
        WorkflowPlacementRequest::RepositoryWorktree {
            repo_root_id,
            base_ref,
            ..
        } => CanonicalRequest {
            schema_version: MATERIALIZATION_SCHEMA_VERSION,
            placement: CanonicalPlacement {
                kind: "repositoryWorktree".to_string(),
                repo_root_id: Some(repo_root_id.clone()),
                base_ref: Some(base_ref.clone()),
            },
        },
    };
    serde_json::to_string(&canonical).expect("canonical request serialization cannot fail")
}
