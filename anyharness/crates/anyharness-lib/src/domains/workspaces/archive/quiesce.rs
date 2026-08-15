//! Stop POLICY. The mechanisms — process-group TERM → 5s grace → KILL, PTY
//! session enumeration, cancellation-safe escalation — all live one layer down
//! in the three planes (R3). What lives here is the composition and the single
//! failure mode.
//!
//! Archive stops everything, tolerates anything already dead, and fails in
//! exactly one way: the deadline. A plane that errors is a plane with nothing
//! left to kill, which is success with a zero census, not a reason to abort an
//! archive.
//!
//! The deadline is not a nicety. If a writer is still alive when the capture
//! runs, `add -A` freezes torn mid-write content into a snapshot the product
//! calls "100% reversible". So a deadline trip aborts phase 1 and leaves the
//! workspace active and untouched — the ONE case where refusing to archive is
//! the safe answer.
//!
//! Scope bound worth stating: this protects against writers THIS runtime
//! spawned. A process orphaned by an earlier runtime incarnation is outside
//! every registry, and no amount of killing here reaches it.

use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::adapters::git::types::QuiesceReport;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::live::terminals::TerminalService;

/// One parallel grace window plus margin. The three planes are killed
/// concurrently, so the budget is ONE escalation (5s), not three.
pub const QUIESCE_DEADLINE: Duration = Duration::from_secs(8);

/// The deadline tripped: a process outlived even SIGKILL delivery (a D-state
/// process can). One variant, because there is exactly one way this fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the workspace could not be quiesced within the deadline")]
pub struct QuiesceTimeout;

/// The three live planes, held here rather than in the service struct so the
/// `crate::live::` reach — which the `DOMAIN_LIVE_VALVE` boundary rule governs
/// and which is allowlisted for exactly this file — stays confined to the one
/// module whose job is to reach them.
#[derive(Clone)]
pub struct QuiescePlanes {
    pub setup: Arc<WorkspaceSetupRuntime>,
    pub sessions: Arc<SessionRuntime>,
    pub terminals: Arc<TerminalService>,
}

/// Kill everything running in `workspace_id` and return the evidence.
///
/// The deadline is supplied by the caller rather than read from
/// [`QUIESCE_DEADLINE`] here, because the orchestrator owns it: production
/// passes the constant, and the quiesce-timeout suite passes a short one so the
/// ONE way this can fail is reachable without three real planes that take eight
/// seconds on demand.
pub async fn stop_everything(
    planes: &QuiescePlanes,
    workspace_id: &str,
    deadline: Duration,
) -> Result<QuiesceReport, QuiesceTimeout> {
    let result = tokio::time::timeout(
        deadline,
        futures::future::join3(
            planes.setup.kill_setup_run(workspace_id),
            planes.sessions.stop_all_for_workspace(workspace_id),
            planes.terminals.close_all_for_workspace(workspace_id),
        ),
    )
    .await;

    match result {
        Ok((setup, sessions, terminals)) => {
            // A plane error means that plane had nothing left to kill. Folding
            // it to a zero census is deliberate: the census is evidence for the
            // kill-debris repair, and a plane that could not report is a plane
            // that proves nothing, not a plane that failed the archive.
            let planes = [setup, sessions, terminals].map(|plane| match plane {
                Ok(kills) => kills,
                Err(error) => {
                    tracing::warn!(
                        workspace_id = %workspace_id,
                        error = %error,
                        "a quiesce plane reported an error; counting zero kills from it"
                    );
                    Default::default()
                }
            });
            Ok(QuiesceReport {
                killed: planes.iter().map(|kills| kills.total).sum(),
                killed_git: planes.iter().map(|kills| kills.git).sum(),
                completed_at: SystemTime::now(),
            })
        }
        Err(_) => Err(QuiesceTimeout),
    }
}
