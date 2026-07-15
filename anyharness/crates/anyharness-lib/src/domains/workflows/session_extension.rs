//! The workflow completion hook. It maps a generic session turn completion
//! into the domain completion input, matches exact session and prompt identity,
//! returns immediately on the per-session actor runtime, and schedules the
//! checked SQLite completion on the process/main runtime's blocking pool. It
//! depends only on the service and the captured main Tokio handle.

use std::sync::Arc;

use tokio::runtime::Handle;

use crate::domains::sessions::extensions::{
    SessionExtension, SessionTurnFinishedContext, SessionTurnOutcome,
};
use crate::domains::workflows::model::{WorkflowTurnOutcome, WORKFLOW_PROMPT_ID_PREFIX};
use crate::domains::workflows::service::WorkflowRunService;

pub struct WorkflowRunSessionExtension {
    service: Arc<WorkflowRunService>,
    main_handle: Handle,
}

impl WorkflowRunSessionExtension {
    pub fn new(service: Arc<WorkflowRunService>, main_handle: Handle) -> Self {
        Self {
            service,
            main_handle,
        }
    }
}

impl SessionExtension for WorkflowRunSessionExtension {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        // Only workflow-owned prompts terminalize a workflow run. A missing or
        // non-workflow prompt id is ignored: session-only matching could
        // terminalize a workflow for an unrelated or queued turn.
        let Some(prompt_id) = ctx.prompt_id else {
            return;
        };
        if !prompt_id.starts_with(WORKFLOW_PROMPT_ID_PREFIX) {
            return;
        }

        let session_id = ctx.session_id;
        // Treat an empty-string turn id from the context as absent.
        let turn_id = if ctx.turn_id.is_empty() {
            None
        } else {
            Some(ctx.turn_id)
        };
        let outcome = match ctx.outcome {
            SessionTurnOutcome::Completed => WorkflowTurnOutcome::Completed,
            SessionTurnOutcome::Failed => WorkflowTurnOutcome::Failed,
            SessionTurnOutcome::Cancelled => WorkflowTurnOutcome::Cancelled,
        };

        let service = self.service.clone();
        self.main_handle.spawn_blocking(move || {
            if let Err(_error) =
                service.finish_turn(&session_id, &prompt_id, turn_id.as_deref(), outcome)
            {
                // Leave rows nonterminal for the next startup fence; never claim
                // completion. Log correlation IDs only.
                tracing::error!(
                    session_id = %session_id,
                    prompt_id = %prompt_id,
                    "workflow completion write failed"
                );
            }
        });
    }
}
