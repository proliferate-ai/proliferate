//! Isolated Workflow workspace placement (spec `workflow-workspace-placement`).
//!
//! The Workflows domain owns the durable materialization state and its
//! coordination; the Workspace domain owns identity/paths/repo-roots/worktrees/
//! provenance/retention (driven through
//! [`crate::domains::workspaces::runtime::WorkspaceRuntime`]); Git adapters own
//! Git operations. This module exports the store, service, and async runtime
//! facade only.

pub mod model;
pub mod runtime;
pub mod service;
pub mod store;

#[cfg(test)]
mod adversarial_tests;
#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

pub use runtime::{
    WorkflowWorkspaceRuntime, WorkspaceGetError, WorkspacePutError, WorkspacePutSuccess,
};
pub use service::{RunAcceptanceGuard, WorkflowWorkspaceService};
pub use store::MaterializationStore;
