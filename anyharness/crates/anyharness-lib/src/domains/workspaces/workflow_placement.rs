//! Workspace-owned Workflow placement types (spec
//! `workflow-workspace-placement`). The Workspace domain owns workspace
//! identity/records, deterministic paths, repo roots, worktrees, provenance, and
//! the narrow exact ensure/adopt seam. The Workflows domain requests placement
//! and owns only its materialization record.
//!
//! The resolved placement is the immutable, persist-before-effects description
//! of what must be materialized. Once persisted, replay uses it verbatim — a
//! moved mutable ref cannot change retry meaning.

use serde::{Deserialize, Serialize};

/// A Workflow placement request, keyed by the run UUID. The deterministic path
/// is never caller-supplied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkflowPlacementRequest {
    /// No user repository: an internal blank Git repository.
    Scratch { run_id: String },
    /// A new deterministic branch/worktree from one immutable source commit.
    RepositoryWorktree {
        run_id: String,
        repo_root_id: String,
        base_ref: String,
    },
}

impl WorkflowPlacementRequest {
    pub fn run_id(&self) -> &str {
        match self {
            Self::Scratch { run_id } | Self::RepositoryWorktree { run_id, .. } => run_id,
        }
    }
}

/// The resolved, immutable placement. Persisted as `resolved_placement_json`
/// before any filesystem/Git effect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvedWorkflowPlacement {
    #[serde(rename_all = "camelCase")]
    Scratch {
        run_id: String,
        /// The exact deterministic target path.
        target_path: String,
    },
    #[serde(rename_all = "camelCase")]
    RepositoryWorktree {
        run_id: String,
        repo_root_id: String,
        base_ref: String,
        /// The immutable base commit OID, resolved before effects.
        base_oid: String,
        /// The deterministic target branch, `workflow/<runId>`.
        branch: String,
        target_path: String,
    },
}

impl ResolvedWorkflowPlacement {
    pub fn run_id(&self) -> &str {
        match self {
            Self::Scratch { run_id, .. } | Self::RepositoryWorktree { run_id, .. } => run_id,
        }
    }

    pub fn target_path(&self) -> &str {
        match self {
            Self::Scratch { target_path, .. }
            | Self::RepositoryWorktree { target_path, .. } => target_path,
        }
    }

    /// The resolved base OID, for repository placements only.
    pub fn base_oid(&self) -> Option<&str> {
        match self {
            Self::RepositoryWorktree { base_oid, .. } => Some(base_oid.as_str()),
            Self::Scratch { .. } => None,
        }
    }
}

/// A fail-closed placement outcome. `Mismatch` is a terminal conflict: no
/// deletion, reset, checkout, rename, or suffix ever happens. `RepoRootNotFound`
/// and `BaseRefUnresolvable` are terminal coded failures before any Git effect.
/// `Git` is a bounded, secret-free Git/workspace failure that retains the row
/// and any ambiguous artifact for inspection.
#[derive(Debug, thiserror::Error)]
pub enum WorkflowPlacementError {
    #[error("workflow placement repo root not found")]
    RepoRootNotFound,
    #[error("workflow placement base ref could not be resolved")]
    BaseRefUnresolvable,
    #[error("workflow placement mismatch: {0}")]
    Mismatch(String),
    #[error("workflow placement git/workspace failure")]
    Git(#[source] anyhow::Error),
}
