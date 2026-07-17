//! The workflow completion hook. It maps a generic session turn completion
//! into the domain completion input, matches exact session and prompt
//! identity, returns immediately on the per-session actor runtime, and
//! performs the checked terminal CAS on the process/main runtime under the
//! shared per-run gate (spec workflow-run-control §6.2), so a cancel request
//! and a terminal callback cannot cross in an unobservable interval. The run
//! key comes from an exact session+prompt store lookup; the deterministic
//! prompt ID is never parsed.

use std::sync::Arc;

use tokio::runtime::Handle;

use crate::domains::sessions::admission::{
    SessionMutationAdmission, SessionMutationKind, SessionMutationSource,
};
use crate::domains::sessions::extensions::{
    SessionExtension, SessionTurnFinishedContext, SessionTurnOutcome,
};
use crate::domains::workflows::control::WorkflowRunGates;
use crate::domains::workflows::model::{WorkflowTurnOutcome, WORKFLOW_PROMPT_ID_PREFIX};
use crate::domains::workflows::service::WorkflowRunService;

pub struct WorkflowRunSessionExtension {
    service: Arc<WorkflowRunService>,
    gates: Arc<WorkflowRunGates>,
    admission: Arc<SessionMutationAdmission>,
    main_handle: Handle,
}

impl WorkflowRunSessionExtension {
    pub fn new(
        service: Arc<WorkflowRunService>,
        gates: Arc<WorkflowRunGates>,
        admission: Arc<SessionMutationAdmission>,
        main_handle: Handle,
    ) -> Self {
        Self {
            service,
            gates,
            admission,
            main_handle,
        }
    }
}

impl SessionExtension for WorkflowRunSessionExtension {
    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        // Only workflow-owned prompts terminalize a workflow run. The prefix
        // is a cheap pre-filter; identity is established by the exact
        // session+prompt store lookup below, never by parsing the prompt ID.
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
        let gates = self.gates.clone();
        let admission = self.admission.clone();
        // Return immediately on the per-session actor runtime; durable work
        // rides the main runtime — the session permit below is awaited HERE,
        // never on the actor thread (spec 2b nonblocking rule).
        self.main_handle.spawn(async move {
            // Opaque run key via exact session+prompt lookup.
            let key_service = service.clone();
            let key_session_id = session_id.clone();
            let key_prompt_id = prompt_id.clone();
            let run_key = tokio::task::spawn_blocking(move || {
                key_service.find_run_id_by_session_and_prompt(&key_session_id, &key_prompt_id)
            })
            .await;
            let run_key = match run_key {
                Ok(Ok(Some(run_key))) => run_key,
                Ok(Ok(None)) => return,
                Ok(Err(_)) | Err(_) => {
                    // Leave rows nonterminal for the next startup fence; never
                    // claim completion. Correlation IDs only.
                    tracing::error!(
                        session_id = %session_id,
                        prompt_id = %prompt_id,
                        "workflow completion key lookup failed"
                    );
                    return;
                }
            };

            // Serialize the terminal CAS on the shared per-run gate.
            let gate = match gates.slot(&run_key) {
                Ok(gate) => gate,
                Err(_poisoned) => {
                    tracing::error!(
                        run_id = %run_key,
                        "workflow run gate unavailable for completion"
                    );
                    return;
                }
            };
            let _guard = gate.lock_owned().await;

            // Spec 2b: the terminal CAS holds the controlled session's
            // mutation permit under the run gate (canonical order). The
            // extension's callback session IS the bound session.
            let _permit = match admission
                .acquire(
                    &session_id,
                    SessionMutationKind::WorkflowTerminal,
                    &SessionMutationSource::workflow_run(&run_key),
                )
                .await
            {
                Ok(permit) => Some(permit),
                Err(_conflict) => {
                    tracing::error!(
                        run_id = %run_key,
                        session_id = %session_id,
                        "session permit unavailable for workflow completion; proceeding under run gate alone"
                    );
                    None
                }
            };

            let finish_session_id = session_id.clone();
            let finish_prompt_id = prompt_id.clone();
            let joined = tokio::task::spawn_blocking(move || {
                service.finish_turn(
                    &finish_session_id,
                    &finish_prompt_id,
                    turn_id.as_deref(),
                    outcome,
                )
            })
            .await;
            match joined {
                Ok(Ok(_outcome)) => {}
                Ok(Err(_)) | Err(_) => {
                    tracing::error!(
                        session_id = %session_id,
                        prompt_id = %prompt_id,
                        "workflow completion write failed"
                    );
                }
            }
        });
    }
}
