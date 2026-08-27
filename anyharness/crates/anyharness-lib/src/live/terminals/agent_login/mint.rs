//! The seat-mint half of the agent login-terminal service (seats v1,
//! agent_auth spec §3 flow 2): per-terminal capture state, the atomic
//! single-flight slot check, the one-time token handoff, and every teardown
//! path — claim, close, replacement, expiry, and exit — each of which wipes
//! the capture buffer, removes the scratch dir, and purges the replay copy
//! as applicable.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, RwLock};

use crate::domains::agent_auth::auth::login_terminal::{
    MintCapture, MintCaptureStatus, MintClaimError,
};

use super::{AgentLoginTerminalRecord, AgentLoginTerminalService, AgentLoginTerminalStatus};

/// How long a capture that completed Ready (terminal exited with a captured
/// token) stays claimable before the runtime tears it down on its own. The
/// happy path claims within one poll tick (~1.2s); the window exists so an
/// ABANDONED mint (browser crash after the token printed, pane never
/// revisited) cannot keep the token in process memory — and replayable over
/// the ws route — for the life of the process.
pub const MINT_POST_EXIT_CLAIM_WINDOW: Duration = Duration::from_secs(300);

/// One mint terminal's in-memory state. The capture holds the only copy of a
/// captured token; the scratch dir is the isolated directory the mint command
/// ran in, removed on every teardown path.
pub(super) struct MintState {
    pub(super) capture: MintCapture,
    pub(super) kind: String,
    pub(super) scratch_dir: Option<PathBuf>,
}

impl MintState {
    /// Wipe the capture and remove the scratch dir (best-effort, idempotent).
    pub(super) fn teardown(&mut self) {
        self.capture.fail();
        self.remove_scratch();
    }

    pub(super) fn remove_scratch(&mut self) {
        if let Some(dir) = self.scratch_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

pub(super) type MintRegistry = Arc<RwLock<HashMap<String, Arc<Mutex<MintState>>>>>;

impl AgentLoginTerminalService {
    /// The one-time mint-token handoff (seats v1): returns the captured token
    /// exactly when the capture is complete, wiping the runtime's buffer in
    /// the same breath — the courier holds the only remaining copy. The
    /// scratch dir goes with it, and so does the terminal-output replay
    /// buffer: the token line the CLI printed flowed into it, and "buffer
    /// wiped on handoff" must cover every runtime copy, not just the capture
    /// (a ws reconnect must not be able to replay the claimed token).
    pub async fn claim_mint_token(&self, terminal_id: &str) -> Result<String, MintClaimError> {
        let state = {
            let mints = self.mints.read().await;
            mints.get(terminal_id).cloned()
        }
        .ok_or(MintClaimError::NotFound)?;
        let mut state = state.lock().await;
        let now = Instant::now();
        match state.capture.claim(now) {
            Some(token) => {
                state.remove_scratch();
                drop(state);
                self.purge_replay(terminal_id).await;
                Ok(token)
            }
            None => Err(MintClaimError::NotReady(state.capture.status(now))),
        }
    }

    /// The capture's lifecycle for a mint terminal (`None` for native ones).
    pub async fn mint_status(&self, terminal_id: &str) -> Option<MintCaptureStatus> {
        let state = {
            let mints = self.mints.read().await;
            mints.get(terminal_id).cloned()
        }?;
        let state = state.lock().await;
        Some(state.capture.status(Instant::now()))
    }

    /// The single-flight check, run with the `mint_by_kind` write lock HELD
    /// (the caller keeps holding it through spawn and reserve, which is what
    /// makes the guard atomic): returns the still-open mint terminal for the
    /// kind, if any. A finished or vanished terminal releases the slot — and
    /// is torn down on the spot, so an exited-but-unclaimed Ready capture is
    /// wiped rather than stranded behind its replacement.
    pub(super) async fn check_mint_slot_locked(
        &self,
        by_kind: &mut HashMap<String, String>,
        kind: &str,
    ) -> Option<AgentLoginTerminalRecord> {
        let terminal_id = by_kind.get(kind).cloned()?;
        if let Some(record) = self.get_terminal(&terminal_id).await {
            if matches!(
                record.status,
                AgentLoginTerminalStatus::Starting | AgentLoginTerminalStatus::Running
            ) {
                return Some(record);
            }
        }
        by_kind.remove(kind);
        self.teardown_mint_remnant(&terminal_id).await;
        None
    }

    /// Wipe what an abandoned mint left behind: the capture buffer (with any
    /// unclaimed token), the scratch dir, and the replay copy of its output.
    /// The terminal record itself stays readable (a poll sees Exited).
    async fn teardown_mint_remnant(&self, terminal_id: &str) {
        let mint = {
            let mut mints = self.mints.write().await;
            mints.remove(terminal_id)
        };
        if let Some(mint) = mint {
            let mut state = mint.lock().await;
            state.teardown();
        }
        self.purge_replay(terminal_id).await;
    }

    /// Zero and drop the terminal's buffered output frames (the ws replay
    /// source). Live subscribers are unaffected; a reconnect sees a gap.
    async fn purge_replay(&self, terminal_id: &str) {
        let hub = {
            let hubs = self.output_hubs.read().await;
            hubs.get(terminal_id).cloned()
        };
        if let Some(hub) = hub {
            hub.purge_replay().await;
        }
    }

    /// Terminal exit is one of the two completion signals (the other is the
    /// grace window, evaluated lazily at read/claim time). The scratch dir is
    /// removed unconditionally — the exited CLI can no longer need its config
    /// dir, and the dir's credential state must not outlive the terminal
    /// (runtime.rs's "an aborted mint leaves nothing on disk"). A capture
    /// that completed Ready but is never claimed is torn down after
    /// [`MINT_POST_EXIT_CLAIM_WINDOW`], bounding how long an abandoned mint
    /// keeps the token in memory.
    pub(super) async fn complete_mint_capture(&self, terminal_id: &str) {
        let state = {
            let map = self.mints.read().await;
            map.get(terminal_id).cloned()
        };
        let Some(state) = state else {
            return;
        };
        let ready = {
            let mut state = state.lock().await;
            let now = Instant::now();
            state.capture.on_exit(now);
            state.remove_scratch();
            state.capture.status(now) == MintCaptureStatus::Ready
        };
        if ready {
            let service = self.clone();
            let tid = terminal_id.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(MINT_POST_EXIT_CLAIM_WINDOW).await;
                service.expire_unclaimed_mint(&tid).await;
            });
        }
    }

    /// The post-exit claim window lapsed: if the capture was never claimed,
    /// wipe it (and the replay copy). The mints entry stays, so a late claim
    /// gets a truthful `NotReady(Failed)` instead of `NotFound`.
    async fn expire_unclaimed_mint(&self, terminal_id: &str) {
        let state = {
            let map = self.mints.read().await;
            map.get(terminal_id).cloned()
        };
        let Some(state) = state else {
            return;
        };
        {
            let mut state = state.lock().await;
            if state.capture.status(Instant::now()) == MintCaptureStatus::Consumed {
                return;
            }
            state.teardown();
        }
        self.purge_replay(terminal_id).await;
    }
}

pub(super) async fn feed_mint_capture(mints: &MintRegistry, terminal_id: &str, data: &[u8]) {
    let state = {
        let map = mints.read().await;
        map.get(terminal_id).cloned()
    };
    if let Some(state) = state {
        let mut state = state.lock().await;
        state.capture.feed(data, Instant::now());
    }
}
