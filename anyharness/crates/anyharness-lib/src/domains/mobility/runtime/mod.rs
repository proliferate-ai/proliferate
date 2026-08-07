//! The mobility runtime valve.
//!
//! `service.rs` owns the durable-only use case (archive export). Every
//! mobility use case that must reach live truth — live terminals directly, or
//! live sessions through another domain's facade — enters here instead. This
//! module is the ONLY mobility code allowed to import `crate::live`; see the
//! valve rule in `anyharness-structure.md`.
//!
//! Direction is one-way: the runtime wraps the service and delegates down
//! (preflight calls `export_workspace_archive` for its size estimate), never
//! the reverse.
//!
//! Each use case here reads as one pipeline: resolve every fact, hand them to
//! `mobility_policy` for the decision, then execute. `mobility_policy.rs` is the
//! single decision home for the live mobility use cases; the durable export
//! path's own pure rules stay next to it in `service.rs` (the runtime cannot
//! move them without inverting the direction above), and the policy delegates
//! to them rather than restating them.

use std::sync::Arc;

use crate::domains::mobility::model::{
    WorkspaceMobilityArchiveData, WorkspaceMobilityExportOptions,
};
use crate::domains::mobility::service::{MobilityError, MobilityService};
use crate::domains::mobility::store::MobilityStore;
use crate::domains::reviews::store::ReviewStore;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::service::SessionService;
use crate::domains::sessions::subagents::service::SubagentService;
use crate::domains::terminals::model::TerminalRecord;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::live::terminals::TerminalService;

mod destroy_source;
mod install;
mod mobility_policy;
#[cfg(test)]
mod mobility_policy_tests;
mod preflight;
mod prepare_destination;

pub struct MobilityRuntime {
    mobility_service: Arc<MobilityService>,
    mobility_store: MobilityStore,
    workspace_runtime: Arc<WorkspaceRuntime>,
    session_service: Arc<SessionService>,
    session_runtime: Arc<SessionRuntime>,
    subagent_service: Arc<SubagentService>,
    review_store: ReviewStore,
    access_gate: Arc<WorkspaceAccessGate>,
    terminal_service: Arc<TerminalService>,
}

impl MobilityRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        mobility_service: Arc<MobilityService>,
        mobility_store: MobilityStore,
        workspace_runtime: Arc<WorkspaceRuntime>,
        session_service: Arc<SessionService>,
        session_runtime: Arc<SessionRuntime>,
        subagent_service: Arc<SubagentService>,
        review_store: ReviewStore,
        access_gate: Arc<WorkspaceAccessGate>,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            mobility_service,
            mobility_store,
            workspace_runtime,
            session_service,
            session_runtime,
            subagent_service,
            review_store,
            access_gate,
            terminal_service,
        }
    }

    /// Delegates straight down to the durable service. Export needs no live
    /// truth, but routing it through the valve keeps `AppState` holding a single
    /// mobility handle instead of two overlapping ones.
    pub fn export_workspace_archive(
        &self,
        workspace_id: &str,
        options: &WorkspaceMobilityExportOptions,
    ) -> Result<WorkspaceMobilityArchiveData, MobilityError> {
        self.mobility_service
            .export_workspace_archive(workspace_id, options)
    }

    async fn active_terminals_async(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        self.terminal_service
            .list_terminals(workspace_id)
            .await
            .into_iter()
            .filter(mobility_policy::terminal_is_active)
            .collect()
    }

    fn active_terminals_blocking(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        self.terminal_service
            .list_terminals_blocking(workspace_id)
            .into_iter()
            .filter(mobility_policy::terminal_is_active)
            .collect()
    }
}
