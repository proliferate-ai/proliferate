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

use anyharness_contract::v1::{InteractionKind, InteractionOutcome};

use crate::domains::sessions::extensions::{
    SessionExtension, SessionInteractionRequestedContext, SessionInteractionResolvedContext,
    SessionLaunchContext, SessionLaunchExtras, SessionTurnFinishedContext, SessionTurnOutcome,
};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workflows::store::WorkflowStore;
use crate::domains::workflows::transition::{TurnFinished, TurnStopReason};
use crate::live::workflows::WorkflowManager;
use crate::observability::{
    WORKFLOW_NODE_INTERACTION_REQUESTED_TRACING_TARGET,
    WORKFLOW_NODE_INTERACTION_RESOLVED_TRACING_TARGET,
};

fn interaction_kind_str(kind: &InteractionKind) -> &'static str {
    match kind {
        InteractionKind::Permission => "permission",
        InteractionKind::UserInput => "user_input",
        InteractionKind::McpElicitation => "mcp_elicitation",
    }
}

fn interaction_outcome_str(outcome: &InteractionOutcome) -> &'static str {
    match outcome {
        InteractionOutcome::Selected { .. } => "selected",
        InteractionOutcome::Submitted { .. } => "submitted",
        InteractionOutcome::Accepted { .. } => "accepted",
        InteractionOutcome::Declined => "declined",
        InteractionOutcome::Cancelled => "cancelled",
        InteractionOutcome::Dismissed => "dismissed",
    }
}

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

    fn on_interaction_requested(&self, ctx: SessionInteractionRequestedContext) {
        let columns = match self.session_store.workflow_columns(&ctx.session_id) {
            Ok(columns) => columns,
            Err(error) => {
                tracing::error!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "workflow column lookup failed at interaction request; report dropped",
                );
                return;
            }
        };
        let Some((run_id, node_row_id)) = columns else {
            return; // ordinary session, or unlinked by undo-advance
        };
        tracing::info!(
            target: WORKFLOW_NODE_INTERACTION_REQUESTED_TRACING_TARGET,
            run_id = %run_id,
            node_row_id = %node_row_id,
            session_id = %ctx.session_id,
            request_id = %ctx.request_id,
            kind = interaction_kind_str(&ctx.kind),
            "workflow node interaction requested",
        );
    }

    fn on_interaction_resolved(&self, ctx: SessionInteractionResolvedContext) {
        let columns = match self.session_store.workflow_columns(&ctx.session_id) {
            Ok(columns) => columns,
            Err(error) => {
                tracing::error!(
                    session_id = %ctx.session_id,
                    error = %error,
                    "workflow column lookup failed at interaction resolution; report dropped",
                );
                return;
            }
        };
        let Some((run_id, node_row_id)) = columns else {
            return; // ordinary session, or unlinked by undo-advance
        };
        tracing::info!(
            target: WORKFLOW_NODE_INTERACTION_RESOLVED_TRACING_TARGET,
            run_id = %run_id,
            node_row_id = %node_row_id,
            session_id = %ctx.session_id,
            request_id = %ctx.request_id,
            kind = interaction_kind_str(&ctx.kind),
            outcome = interaction_outcome_str(&ctx.outcome),
            "workflow node interaction resolved",
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
        assert_eq!(
            map_stop_reason(Completed, None),
            TurnStopReason::CleanEndTurn
        );
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

    /// pr11b subscriber-capture proof: a workflow-linked session's interaction
    /// request emits the named `anyharness.workflow_node_interaction_requested`
    /// event with full run/node/session/request correlation; an unlinked
    /// session (no workflow columns) produces zero output — the extension's
    /// pre-filter, exercised without a bound manager (neither hook needs it).
    /// Negative control (recorded in the PR body): removing the
    /// `tracing::info!` call from `on_interaction_requested` fails this test;
    /// restoring it passes.
    #[test]
    fn on_interaction_requested_emits_full_correlation_for_a_linked_session() {
        let extension = linked_extension_fixture();
        let logged = capture_tracing_output(|| {
            extension.on_interaction_requested(SessionInteractionRequestedContext {
                session_id: "session-1".into(),
                request_id: "req-1".into(),
                kind: InteractionKind::Permission,
            });
            // Silence case: session-2 carries no workflow columns, so the
            // workflow_columns pre-filter drops the report — zero output.
            extension.on_interaction_requested(SessionInteractionRequestedContext {
                session_id: "session-2".into(),
                request_id: "req-2".into(),
                kind: InteractionKind::Permission,
            });
        });

        let matches: Vec<&str> = logged
            .lines()
            .filter(|line| line.contains("anyharness.workflow_node_interaction_requested"))
            .collect();
        assert_eq!(matches.len(), 1, "{logged}");
        let requested_line = matches[0];
        assert!(requested_line.contains("run-x"), "{requested_line}");
        assert!(requested_line.contains("node-x"), "{requested_line}");
        assert!(requested_line.contains("session-1"), "{requested_line}");
        assert!(requested_line.contains("req-1"), "{requested_line}");
        assert!(requested_line.contains("permission"), "{requested_line}");
    }

    /// The resolve-side sibling: a linked session's resolution emits the named
    /// `anyharness.workflow_node_interaction_resolved` event with the same
    /// correlation plus the `outcome` discriminant; an unlinked session stays
    /// silent. Negative control (recorded in the PR body): removing the
    /// `tracing::info!` call from `on_interaction_resolved` fails this test;
    /// restoring it passes.
    #[test]
    fn on_interaction_resolved_emits_the_outcome_for_a_linked_session() {
        let extension = linked_extension_fixture();
        let logged = capture_tracing_output(|| {
            extension.on_interaction_resolved(SessionInteractionResolvedContext {
                session_id: "session-1".into(),
                request_id: "req-1".into(),
                kind: InteractionKind::Permission,
                outcome: InteractionOutcome::Declined,
            });
            // Silence case: session-2 carries no workflow columns.
            extension.on_interaction_resolved(SessionInteractionResolvedContext {
                session_id: "session-2".into(),
                request_id: "req-2".into(),
                kind: InteractionKind::Permission,
                outcome: InteractionOutcome::Declined,
            });
        });

        let matches: Vec<&str> = logged
            .lines()
            .filter(|line| line.contains("anyharness.workflow_node_interaction_resolved"))
            .collect();
        assert_eq!(matches.len(), 1, "{logged}");
        let resolved_line = matches[0];
        assert!(resolved_line.contains("run-x"), "{resolved_line}");
        assert!(resolved_line.contains("node-x"), "{resolved_line}");
        assert!(resolved_line.contains("session-1"), "{resolved_line}");
        assert!(resolved_line.contains("req-1"), "{resolved_line}");
        assert!(resolved_line.contains("declined"), "{resolved_line}");
    }

    /// One linked (`session-1` → `run-x`/`node-x`) and one unlinked
    /// (`session-2`) session over an in-memory store, no bound manager —
    /// neither interaction hook needs it.
    fn linked_extension_fixture() -> WorkflowSessionExtension {
        use crate::app::test_support::{insert_session_row, seed_workspace_with_repo_root};
        use crate::persistence::Db;

        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_workspace_with_repo_root(&db, "workspace-1", "worktree", "/tmp/workspace-1");
        let session_store = SessionStore::new(db.clone());
        insert_session_row(&session_store, "workspace-1", "session-1", "idle");
        insert_session_row(&session_store, "workspace-1", "session-2", "idle");
        session_store
            .link_workflow_columns("session-1", "run-x", "node-x")
            .expect("link workflow columns");
        WorkflowSessionExtension::new(session_store, WorkflowStore::new(db))
    }

    /// Local twin of `store_tests::capture_tracing_output` (that helper is
    /// private to its module): runs `body` under a captured fmt subscriber and
    /// returns everything it logged.
    fn capture_tracing_output(body: impl FnOnce()) -> String {
        use std::io;
        use std::sync::{Arc, Mutex};

        #[derive(Clone)]
        struct SharedLogWriter(Arc<Mutex<Vec<u8>>>);

        impl io::Write for SharedLogWriter {
            fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
                self.0
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .extend_from_slice(buffer);
                Ok(buffer.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let log_bytes = Arc::new(Mutex::new(Vec::new()));
        let log_writer = Arc::clone(&log_bytes);
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_writer(move || SharedLogWriter(Arc::clone(&log_writer)))
            .finish();
        tracing::subscriber::with_default(subscriber, body);

        let bytes = log_bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        String::from_utf8(bytes).expect("formatted log is UTF-8")
    }
}
