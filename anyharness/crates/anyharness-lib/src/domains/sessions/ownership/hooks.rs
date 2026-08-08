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

    // The same fence and the same order the synchronous close took
    // (PR1227-LOCK-01: session mutation permit, THEN the workspace lease). It
    // is re-taken rather than carried because the requesting call returned long
    // ago — and because control can be acquired in between: a workflow that
    // took this session over after the request must not have it closed out from
    // under it. A refusal leaves the request armed for the next finished turn.
    let _permit = match admit_peer_mutation(&admission, &ctx.session_id, SessionMutationKind::Close)
        .await
    {
        Ok(permit) => permit,
        Err(error) => {
            tracing::info!(
                session_id = %ctx.session_id,
                error = %error,
                "deferred agent close is still blocked; leaving the request armed"
            );
            return Ok(());
        }
    };
    let _lease = match lease_target_workspace_for_peer_write(
        &operation_gate,
        &access_gate,
        &ctx.workspace.id,
    )
    .await
    {
        Ok(lease) => lease,
        Err(error) => {
            tracing::info!(
                session_id = %ctx.session_id,
                workspace_id = %ctx.workspace.id,
                error = %error,
                "deferred agent close cannot write to the workspace; leaving the request armed"
            );
            return Ok(());
        }
    };

    tracing::info!(
        session_id = %ctx.session_id,
        session_link_id = %request.id,
        closed_by_session_id = ?request.closed_by_session_id,
        turn_id = %ctx.turn_id,
        "closing an agent whose end was requested mid-turn"
    );
    session_runtime
        .close_live_session(&ctx.session_id)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    // The close cascade stamps the inbound ownership row, so the request is
    // consumed by the same path a synchronous close uses. Belt and braces for
    // the retryable case where the live close succeeded but the row did not.
    let settled = ownership.reload_link(&request)?;
    if settled.closed_at.is_none() {
        ownership.close_link(&settled, &chrono::Utc::now().to_rfc3339())?;
    }
    Ok(())
}
