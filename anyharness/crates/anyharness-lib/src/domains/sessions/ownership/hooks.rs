//! The turn-finish half of a soft close.
//!
//! `close_agent` on a WORKING agent does not interrupt it. It authorizes the
//! close, stamps the ownership row, and returns "end requested"; the agent
//! finishes the step it is on and this hook closes the tree at turn finish.
//! That is what §4's confirm copy promises — "it will finish the current step,
//! then stop" — and it is why the close request is durable: a runtime that
//! restarts mid-turn still owes the close, and the next finished turn pays it.
//!
//! This runs for EVERY session that finishes a turn, like the wake hook next
//! door, because any session can be the one somebody asked to stop. The lookup
//! it costs is one indexed point read
//! (`idx_session_links_pending_close_request`).

use std::sync::{Arc, OnceLock, Weak};

use super::service::AgentOwnershipService;
use crate::domains::sessions::admission::{SessionMutationAdmission, SessionMutationKind};
use crate::domains::sessions::agent_ops::peer_ops::{
    admit_peer_mutation, lease_target_workspace_for_peer_write,
};
use crate::domains::sessions::extensions::{SessionExtension, SessionTurnFinishedContext};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::access_gate::WorkspaceAccessGate;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;

pub struct AgentCloseSessionHooks {
    ownership: Arc<AgentOwnershipService>,
    session_admission: Arc<SessionMutationAdmission>,
    workspace_operation_gate: Arc<WorkspaceOperationGate>,
    workspace_access_gate: Arc<WorkspaceAccessGate>,
    /// Injected after `SessionRuntime::new`, which cannot be otherwise: the
    /// runtime owns the extension list, so holding an `Arc` back to it would be
    /// a reference cycle. Same two-phase shape the workflow wiring uses.
    session_runtime: OnceLock<Weak<SessionRuntime>>,
}

impl AgentCloseSessionHooks {
    pub fn new(
        ownership: Arc<AgentOwnershipService>,
        session_admission: Arc<SessionMutationAdmission>,
        workspace_operation_gate: Arc<WorkspaceOperationGate>,
        workspace_access_gate: Arc<WorkspaceAccessGate>,
    ) -> Self {
        Self {
            ownership,
            session_admission,
            workspace_operation_gate,
            workspace_access_gate,
            session_runtime: OnceLock::new(),
        }
    }

    /// Phase two of the wiring. Until this is called the hook is inert, which
    /// is the correct behavior for the window before the runtime exists: no
    /// turn can have finished yet.
    pub fn attach_session_runtime(&self, session_runtime: &Arc<SessionRuntime>) {
        let _ = self.session_runtime.set(Arc::downgrade(session_runtime));
    }

    fn session_runtime(&self) -> Option<Arc<SessionRuntime>> {
        self.session_runtime.get().and_then(Weak::upgrade)
    }

    /// Settle every close this runtime already owed when it started.
    ///
    /// The turn-finish hook can only pay a debt whose turn finishes. If the
    /// runtime died mid-turn instead, nothing will ever finish that turn: the
    /// agent was told it would stop after its current step, and would otherwise
    /// sit there open forever, with the request still armed and nothing to fire
    /// it. Worse, the only thing that COULD fire it is somebody prompting an
    /// agent that has already been told to stop — which the turn-start fence
    /// now (correctly) refuses.
    ///
    /// So the debt is settled here instead, at boot, through the ordinary close
    /// path: same gates, same close tree, attribution untouched.
    pub fn spawn_startup_pass(self: Arc<Self>) {
        tokio::spawn(async move {
            match self.reconcile_pending_closes().await {
                Ok(0) => {}
                Ok(settled) => tracing::info!(
                    settled,
                    "closed agents whose end was requested before this runtime started"
                ),
                Err(error) => {
                    tracing::warn!(error = %error, "the requested-close startup pass failed")
                }
            }
        });
    }

    /// The startup pass body. Returns how many closes it settled.
    ///
    /// A request whose target still has a LIVE handle is left alone: that agent
    /// is running now, so its turn-finish hook owes the close and will pay it
    /// without cutting a step short.
    pub async fn reconcile_pending_closes(&self) -> anyhow::Result<usize> {
        let Some(session_runtime) = self.session_runtime() else {
            return Ok(0);
        };
        let mut settled = 0usize;
        for request in self.ownership.pending_close_requests()? {
            let Some(target) = self
                .ownership
                .session_store()
                .find_by_id(&request.child_session_id)?
            else {
                continue;
            };
            if target.closed_at.is_some() || target.status == "closed" {
                // The session went down but the row outlived it. Settle the row
                // so the request stops being pending; nothing to shut down.
                self.ownership
                    .close_link(&request, &chrono::Utc::now().to_rfc3339())?;
                settled += 1;
                continue;
            }
            if session_runtime
                .session_execution_summary(&target)
                .await
                .has_live_handle
            {
                continue;
            }
            match complete_close_request(
                &self.ownership,
                &session_runtime,
                &self.session_admission,
                &self.workspace_operation_gate,
                &self.workspace_access_gate,
                &target.id,
                &target.workspace_id,
                &request,
            )
            .await
            {
                Ok(true) => settled += 1,
                Ok(false) => {}
                Err(error) => tracing::warn!(
                    session_id = %target.id,
                    error = %error,
                    "failed to settle a close owed from before this runtime started"
                ),
            }
        }
        Ok(settled)
    }
}

impl SessionExtension for AgentCloseSessionHooks {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let Some(session_runtime) = self.session_runtime() else {
            return;
        };
        let ownership = self.ownership.clone();
        let admission = self.session_admission.clone();
        let operation_gate = self.workspace_operation_gate.clone();
        let access_gate = self.workspace_access_gate.clone();
        // Off the actor's turn-finish callback before anything is awaited: the
        // close shuts this very actor down, and the gates below can block.
        tokio::spawn(async move {
            if let Err(error) = complete_requested_close(
                ownership,
                session_runtime,
                admission,
                operation_gate,
                access_gate,
                ctx,
            )
            .await
            {
                tracing::warn!(error = %error, "failed to complete a requested agent close");
            }
        });
    }
}

async fn complete_requested_close(
    ownership: Arc<AgentOwnershipService>,
    session_runtime: Arc<SessionRuntime>,
    admission: Arc<SessionMutationAdmission>,
    operation_gate: Arc<WorkspaceOperationGate>,
    access_gate: Arc<WorkspaceAccessGate>,
    ctx: SessionTurnFinishedContext,
) -> anyhow::Result<()> {
    let Some(request) = ownership.pending_close_request(&ctx.session_id)? else {
        return Ok(());
    };
    tracing::info!(
        session_id = %ctx.session_id,
        session_link_id = %request.id,
        closed_by_session_id = ?request.closed_by_session_id,
        turn_id = %ctx.turn_id,
        "closing an agent whose end was requested mid-turn"
    );
    complete_close_request(
        &ownership,
        &session_runtime,
        &admission,
        &operation_gate,
        &access_gate,
        &ctx.session_id,
        &ctx.workspace.id,
        &request,
    )
    .await?;
    Ok(())
}

/// Shut the agent down and settle its ownership row. One body, two callers: the
/// turn-finish hook above and the boot-time reconciliation pass, which owe the
/// same close for the same reason and must therefore take the same gates and
/// leave the same record.
///
/// `Ok(false)` means the gates refused and the request is still armed — never
/// that the close is unnecessary.
#[allow(clippy::too_many_arguments)]
async fn complete_close_request(
    ownership: &AgentOwnershipService,
    session_runtime: &SessionRuntime,
    admission: &SessionMutationAdmission,
    operation_gate: &WorkspaceOperationGate,
    access_gate: &WorkspaceAccessGate,
    session_id: &str,
    workspace_id: &str,
    request: &crate::domains::sessions::links::model::SessionLinkRecord,
) -> anyhow::Result<bool> {
    // The same fence and the same order the synchronous close took
    // (PR1227-LOCK-01: session mutation permit, THEN the workspace lease). It
    // is re-taken rather than carried because the requesting call returned long
    // ago — and because control can be acquired in between: a workflow that
    // took this session over after the request must not have it closed out from
    // under it. A refusal leaves the request armed for the next finished turn.
    let _permit = match admit_peer_mutation(admission, session_id, SessionMutationKind::Close).await
    {
        Ok(permit) => permit,
        Err(error) => {
            tracing::info!(
                session_id = %session_id,
                error = %error,
                "deferred agent close is still blocked; leaving the request armed"
            );
            return Ok(false);
        }
    };
    let _lease =
        match lease_target_workspace_for_peer_write(operation_gate, access_gate, workspace_id).await
        {
            Ok(lease) => lease,
            Err(error) => {
                tracing::info!(
                    session_id = %session_id,
                    workspace_id = %workspace_id,
                    error = %error,
                    "deferred agent close cannot write to the workspace; leaving the request armed"
                );
                return Ok(false);
            }
        };

    session_runtime
        .close_live_session(session_id)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    // The close cascade stamps the inbound ownership row, so the request is
    // consumed by the same path a synchronous close uses. Belt and braces for
    // the retryable case where the live close succeeded but the row did not.
    let settled = ownership.reload_link(request)?;
    if settled.closed_at.is_none() {
        ownership.close_link(&settled, &chrono::Utc::now().to_rfc3339())?;
    }
    Ok(true)
}
