//! The one sessions-domain touchpoint (gen-2). Two duties, both keyed by the
//! loose workflow columns on `sessions`:
//!
//! - At launch, `resolve_launch_extras` passes through the envelope's
//!   DSL-authored `systemPrompt.append` strings — and nothing else. The
//!   preamble instruction blocks never ride launch extras: the actor delivers
//!   them in-band, prepended to the first message payload, identically for
//!   every harness (Ruling D).
//! - At every turn end, `on_turn_finished` peeks the durable pending-prompt
//!   queue AT THAT INSTANT (the actor's mailbox introduces latency during
//!   which the session actor re-drains the queue itself; peeking early is what
//!   makes "a queued interjection holds the node open" race-free), maps the
//!   stop reason, and notifies the manager fire-and-forget. It never blocks
//!   the session actor.
//!
//! The manager is built after `SessionRuntime` (which consumes the extension
//! list), so the handle arrives late through a `OnceLock` — holding `Weak`,
//! because the manager's deps own that same runtime and an `Arc` here would
//! close the cycle and leak every actor task for the process lifetime.

use std::sync::{Arc, OnceLock, Weak};

use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext,
    SessionTurnOutcome,
};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workflows::store::WorkflowStore;
use crate::domains::workflows::transition::{TurnFinished, TurnStopReason};
use crate::live::workflows::WorkflowManager;

pub struct WorkflowSessionExtension {
    session_store: SessionStore,
    workflow_store: WorkflowStore,
    manager: OnceLock<Weak<WorkflowManager>>,
}

impl WorkflowSessionExtension {
    pub fn new(session_store: SessionStore, workflow_store: WorkflowStore) -> Self {
        Self {
            session_store,
            workflow_store,
            manager: OnceLock::new(),
        }
    }

    /// Wiring-order late bind; one shot, further binds are ignored. Stores a
    /// `Weak` so runtime → extension → manager → runtime never becomes an
    /// `Arc` cycle.
    pub fn bind_manager(&self, manager: &Arc<WorkflowManager>) {
        let _ = self.manager.set(Arc::downgrade(manager));
    }
}

/// The ruled mapping from the generic turn context to the table's vocabulary.
/// The session actor's empty-turn reclassification is the one `Failed` with a
/// clean `end_turn` stop (every other failure carries an error stop or none),
/// so that exact pair is the ADR's `empty_turn`. `forced_unload` is the
/// hook-only marker `finish_forced_unload_cancel` stamps on a non-terminal
/// actor unload: cancelled, but by the platform, not the user.
fn map_stop_reason(outcome: SessionTurnOutcome, stop_reason: Option<&str>) -> TurnStopReason {
    match outcome {
        SessionTurnOutcome::Cancelled => match stop_reason {
            Some("forced_unload") => TurnStopReason::ForcedUnload,
            _ => TurnStopReason::Cancelled,
        },
        SessionTurnOutcome::Failed => match stop_reason {
            Some("end_turn") => TurnStopReason::EmptyTurn,
            _ => TurnStopReason::Error,
        },
        SessionTurnOutcome::Completed => match stop_reason {
            Some("refusal") => TurnStopReason::Refusal,
            Some("max_tokens") | Some("max_turn_requests") => TurnStopReason::HarnessCap,
            _ => TurnStopReason::CleanEndTurn,
        },
    }
}

impl SessionExtension for WorkflowSessionExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        let columns = self.session_store.workflow_columns(&ctx.session.id)?;
        let Some((run_id, node_row_id)) = columns else {
            return Ok(SessionLaunchExtras::default());
        };
        let Some(state) = self.workflow_store.load_run_state(&run_id)? else {
            return Ok(SessionLaunchExtras::default());
        };
        let Some(envelope) = state
            .node(&node_row_id)
            .and_then(|node| node.rendered_envelope.as_ref())
        else {
            // A linked session with no stored envelope: the actor persists the
            // envelope before it creates the session, so this only means rows
            // moved underneath a straggler start. Launch plain.
            return Ok(SessionLaunchExtras::default());
        };
        // Only the DSL-authored appends; the preamble goes in-band with the
        // first message (Ruling D), so no harness receives it twice or not
        // at all.
        Ok(SessionLaunchExtras {
            system_prompt_append: envelope.system_prompt_append.clone(),
            ..SessionLaunchExtras::default()
        })
    }

    fn on_turn_finished(&self, ctx: SessionTurnFinishedContext) {
        let columns = match self.session_store.workflow_columns(&ctx.session_id) {
            Ok(columns) => columns,
            Err(error) => {
                tracing::error!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "workflow column lookup failed at turn end; report dropped",
                );
                return;
            }
        };
        let Some((run_id, node_row_id)) = columns else {
            return; // ordinary session, or unlinked by undo-advance
        };
        // Queue emptiness at the finish instant. A peek failure counts as
        // empty, mirroring the session actor's own drain posture.
        let queue_empty = self
            .session_store
            .peek_head_pending_prompt(&ctx.session_id)
            .map(|head| head.is_none())
            .unwrap_or(true);
        let stop_reason = map_stop_reason(ctx.outcome, ctx.stop_reason.as_deref());
        let Some(manager) = self.manager.get().and_then(Weak::upgrade) else {
            tracing::error!(
                session_id = %ctx.session_id,
                run_id = %run_id,
                "workflow manager unbound or dropped at turn end; report dropped",
            );
            return;
        };
        manager.notify(
            &run_id,
            TurnFinished {
                node_row_id,
                stop_reason,
                queue_empty,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_reason_mapping_covers_the_ruled_table() {
        use SessionTurnOutcome::*;
        assert_eq!(
            map_stop_reason(Completed, Some("end_turn")),
            TurnStopReason::CleanEndTurn
        );
        assert_eq!(
            map_stop_reason(Completed, Some("refusal")),
            TurnStopReason::Refusal
        );
        assert_eq!(
            map_stop_reason(Completed, Some("max_tokens")),
            TurnStopReason::HarnessCap
        );
        assert_eq!(
            map_stop_reason(Completed, Some("max_turn_requests")),
            TurnStopReason::HarnessCap
        );
        assert_eq!(map_stop_reason(Completed, None), TurnStopReason::CleanEndTurn);
        // The empty-turn reclassification: the only Failed that ends with a
        // clean end_turn stop (turn/finish.rs) is the zero-activity turn.
        assert_eq!(
            map_stop_reason(Failed, Some("end_turn")),
            TurnStopReason::EmptyTurn
        );
        assert_eq!(map_stop_reason(Failed, None), TurnStopReason::Error);
        assert_eq!(
            map_stop_reason(Failed, Some("something_else")),
            TurnStopReason::Error
        );
        assert_eq!(
            map_stop_reason(Cancelled, Some("cancelled")),
            TurnStopReason::Cancelled
        );
        // A platform unload is not a user cancel: it parks app_shutdown.
        assert_eq!(
            map_stop_reason(Cancelled, Some("forced_unload")),
            TurnStopReason::ForcedUnload
        );
    }
}
