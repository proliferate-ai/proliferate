//! The live workflow cell: `WorkflowManager` owns the run-id → actor registry
//! and is the only door into the actors — the HTTP layer hands it a command
//! and awaits a oneshot, the session extension hands it a notification and
//! moves on. No durable truth lives here: actor state is a cache of the rows,
//! rebuilt from them on first touch.

mod actor;
#[cfg(test)]
mod lifecycle_tests;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, oneshot};

use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workflows::invariants;
use crate::domains::workflows::projection::RunProjection;
use crate::domains::workflows::store::WorkflowStore;
use crate::domains::workflows::transition::{IllegalTransition, TurnFinished, WorkflowCommand};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::observability::WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET;

use actor::{CommandReply, WorkflowActor, WorkflowActorDeps};

/// One mailbox entry. `ReadProjection` is a read that queues like a command:
/// the PUT path uses it so its reply orders AFTER the spawn launch (and any
/// in-flight step) instead of racing the actor for the rows.
pub(super) enum ActorRequest {
    Command(WorkflowCommand),
    ReadProjection,
}

/// Commands queue while the actor performs a side effect; their callers see a
/// slightly later, still-correct projection.
const COMMAND_MAILBOX_CAPACITY: usize = 32;

/// How a command failed to produce a projection. `Illegal` is the API's 409
/// carrying the transition table's refusal; `RunNotFound` its 404.
#[derive(Debug)]
pub enum WorkflowCommandError {
    RunNotFound,
    Illegal(IllegalTransition),
    Internal(anyhow::Error),
}

#[derive(Clone)]
struct WorkflowHandle {
    commands: mpsc::Sender<(ActorRequest, CommandReply)>,
    notifications: mpsc::UnboundedSender<TurnFinished>,
}

pub struct WorkflowManager {
    deps: Arc<WorkflowActorDeps>,
    registry: Mutex<HashMap<String, WorkflowHandle>>,
}

impl WorkflowManager {
    pub fn new(
        store: WorkflowStore,
        session_runtime: Arc<SessionRuntime>,
        session_store: SessionStore,
        workspace_store: WorkspaceStore,
    ) -> Self {
        Self {
            deps: Arc::new(WorkflowActorDeps {
                store,
                session_runtime,
                session_store,
                workspace_store,
            }),
            registry: Mutex::new(HashMap::new()),
        }
    }

    /// Ensure the run's actor and return the rows-backed projection. The
    /// actor's spawn path launches the current node when it is running with
    /// no linked session — the create-then-start seam (PUT) and the fence's
    /// Resume both reduce to that one rule.
    pub fn start_run(&self, run_id: &str) -> Result<RunProjection, WorkflowCommandError> {
        self.ensure_actor(run_id)?;
        match self.deps.store.run_detail(run_id) {
            Ok(Some(projection)) => Ok(projection),
            Ok(None) => Err(WorkflowCommandError::RunNotFound),
            Err(error) => Err(WorkflowCommandError::Internal(error)),
        }
    }

    /// The PUT path's synced start: ensure the actor (whose spawn launches a
    /// running-unlinked current node) and read the projection THROUGH the
    /// mailbox, so the reply reflects the launch instead of racing it — the
    /// actor serves queued requests only after the pre-loop launch completes.
    pub async fn start_run_synced(
        self: &Arc<Self>,
        run_id: &str,
    ) -> Result<RunProjection, WorkflowCommandError> {
        self.request(run_id, ActorRequest::ReadProjection).await
    }

    /// Route one command to the run's actor and await the oneshot. The reply
    /// is the eventual HTTP response body: Ok = the fresh full projection,
    /// Illegal = the 409.
    pub async fn command(
        self: &Arc<Self>,
        run_id: &str,
        command: WorkflowCommand,
    ) -> Result<RunProjection, WorkflowCommandError> {
        self.request(run_id, ActorRequest::Command(command)).await
    }

    async fn request(
        self: &Arc<Self>,
        run_id: &str,
        request: ActorRequest,
    ) -> Result<RunProjection, WorkflowCommandError> {
        // Actor rematerialization reads rows; keep that SQLite load off the
        // async runtime's worker threads.
        let handle = {
            let manager = self.clone();
            let run_id = run_id.to_string();
            tokio::task::spawn_blocking(move || manager.ensure_actor(&run_id))
                .await
                .map_err(|error| {
                    WorkflowCommandError::Internal(anyhow::anyhow!(
                        "workflow ensure-actor task failed: {error}"
                    ))
                })??
        };
        let (reply_tx, reply_rx) = oneshot::channel();
        handle
            .commands
            .send((request, reply_tx))
            .await
            .map_err(|_| {
                WorkflowCommandError::Internal(anyhow::anyhow!("workflow actor mailbox closed"))
            })?;
        match reply_rx.await {
            Ok(Ok(projection)) => Ok(projection),
            Ok(Err(illegal)) => Err(WorkflowCommandError::Illegal(illegal)),
            Err(_dropped) => Err(WorkflowCommandError::Internal(anyhow::anyhow!(
                "workflow actor dropped the reply"
            ))),
        }
    }

    /// Fire-and-forget from the session extension: never blocks the session
    /// actor. A registry miss is by construction a stale report — every live
    /// workflow session in this process was launched by an actor — so it is
    /// dropped with the stale event rather than rematerializing anything.
    pub fn notify(&self, run_id: &str, turn: TurnFinished) {
        let handle = {
            let registry = self.registry.lock().expect("workflow registry poisoned");
            registry.get(run_id).cloned()
        };
        match handle {
            Some(handle) => {
                // A closed channel means process shutdown; nothing to do.
                let _ = handle.notifications.send(turn);
            }
            None => {
                tracing::warn!(
                    target: WORKFLOW_NOTIFICATION_STALE_TRACING_TARGET,
                    run_id = %run_id,
                    node_row_id = %turn.node_row_id,
                    detail = "no live actor",
                    "stale workflow turn report dropped",
                );
            }
        }
    }

    /// Registry hit hands back the mailbox; a miss on any existing run
    /// rematerializes the actor from rows first (terminal runs included:
    /// fail-and-redo is legal on them). The state loads OUTSIDE the lock —
    /// `notify` takes the same std mutex on the session actor's task, and a
    /// lock held across a SQLite read would park `finish_prompt_result` —
    /// with a re-check under the lock, so two racing callers still never mint
    /// two actors for one run (the loser's loaded state is discarded).
    fn ensure_actor(&self, run_id: &str) -> Result<WorkflowHandle, WorkflowCommandError> {
        {
            let registry = self.registry.lock().expect("workflow registry poisoned");
            if let Some(handle) = registry.get(run_id) {
                return Ok(handle.clone());
            }
        }
        let state = self
            .deps
            .store
            .load_run_state(run_id)
            .map_err(WorkflowCommandError::Internal)?
            .ok_or(WorkflowCommandError::RunNotFound)?;
        // The rebuild tripwire, ALL builds: rows a fresh actor is about to
        // trust must hold the invariant laws. This is `sweep`, not
        // `sweep_at_rest` — the create-then-start seam legally rests a
        // running-unlinked current node here (the spawn launch heals it).
        invariants::report(&invariants::sweep(&state));
        let mut registry = self.registry.lock().expect("workflow registry poisoned");
        if let Some(handle) = registry.get(run_id) {
            return Ok(handle.clone());
        }
        let (commands_tx, commands_rx) = mpsc::channel(COMMAND_MAILBOX_CAPACITY);
        let (notifications_tx, notifications_rx) = mpsc::unbounded_channel();
        let actor = WorkflowActor {
            run_id: run_id.to_string(),
            deps: self.deps.clone(),
            commands: commands_rx,
            notifications: notifications_rx,
        };
        tokio::spawn(actor.run(state));
        let handle = WorkflowHandle {
            commands: commands_tx,
            notifications: notifications_tx,
        };
        registry.insert(run_id.to_string(), handle.clone());
        Ok(handle)
    }
}
