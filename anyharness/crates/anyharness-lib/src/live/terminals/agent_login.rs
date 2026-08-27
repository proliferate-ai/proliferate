use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::domains::agents::auth::login_terminal::{MintCapture, MintCaptureStatus};
pub use crate::domains::agents::auth::login_terminal::{MintClaimError, MintTerminalOptions};
use crate::domains::terminals::model::{ResizeTerminalOptions, TerminalOutputEvent};
use crate::process_env::remove_runtime_private_pty_env;

use super::output_sink::TerminalOutputHub;

/// How long a capture that completed Ready (terminal exited with a captured
/// token) stays claimable before the runtime tears it down on its own. The
/// happy path claims within one poll tick (~1.2s); the window exists so an
/// ABANDONED mint (browser crash after the token printed, pane never
/// revisited) cannot keep the token in process memory — and replayable over
/// the ws route — for the life of the process.
pub const MINT_POST_EXIT_CLAIM_WINDOW: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentLoginTerminalStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone)]
pub struct AgentLoginTerminalRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: AgentLoginTerminalStatus,
    pub cwd: String,
    pub command_display: String,
    pub exit_code: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
    /// Present only on a mint (seat-capture) terminal; computed at read time
    /// from the in-memory capture — never persisted anywhere.
    pub mint_status: Option<MintCaptureStatus>,
}

#[derive(Debug, Clone)]
pub struct StartAgentLoginTerminalOptions {
    pub kind: String,
    pub title: String,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
    pub command_display: String,
    pub cols: u16,
    pub rows: u16,
    /// `Some` makes this a seat-mint terminal.
    pub mint: Option<MintTerminalOptions>,
}

/// One mint terminal's in-memory state. The capture holds the only copy of a
/// captured token; the scratch dir is the isolated directory the mint command
/// ran in, removed on every teardown path.
struct MintState {
    capture: MintCapture,
    kind: String,
    scratch_dir: Option<PathBuf>,
}

impl MintState {
    /// Wipe the capture and remove the scratch dir (best-effort, idempotent).
    fn teardown(&mut self) {
        self.capture.fail();
        self.remove_scratch();
    }

    fn remove_scratch(&mut self) {
        if let Some(dir) = self.scratch_dir.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

type AgentLoginPtyRef = Arc<Mutex<AgentLoginPty>>;
type AgentLoginRegistry = Arc<RwLock<HashMap<String, AgentLoginPtyRef>>>;
type AgentLoginOutputRegistry = Arc<RwLock<HashMap<String, TerminalOutputHub>>>;
type MintRegistry = Arc<RwLock<HashMap<String, Arc<Mutex<MintState>>>>>;

#[derive(Clone)]
pub struct AgentLoginTerminalService {
    terminals: AgentLoginRegistry,
    output_hubs: AgentLoginOutputRegistry,
    /// Mint capture per terminal id (mint terminals only).
    mints: MintRegistry,
    /// The single-flight guard: at most one LIVE mint terminal per harness
    /// kind — a second mint start returns the open terminal instead of
    /// spawning (the UI focuses it).
    mint_by_kind: Arc<RwLock<HashMap<String, String>>>,
}

impl AgentLoginTerminalService {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            output_hubs: Arc::new(RwLock::new(HashMap::new())),
            mints: Arc::new(RwLock::new(HashMap::new())),
            mint_by_kind: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start_terminal(
        &self,
        options: StartAgentLoginTerminalOptions,
    ) -> anyhow::Result<AgentLoginTerminalRecord> {
        // Single-flight per harness (mint terminals only, agent_auth spec §3
        // flow 2): a second mint while one is open FOCUSES the open terminal —
        // returning its record is that focus, since the UI keys panels by id.
        // The second start's never-used scratch dir is removed on the spot.
        //
        // The guard's write lock is held from this check all the way through
        // the spawn and the registry inserts: with a check-then-act (lock
        // dropped in between) two concurrent starts both passed the check
        // before either inserted, spawning two live mint PTYs and orphaning
        // the first one's capture. The spawn itself is synchronous, so the
        // lock is never held across an await other than the map inserts.
        let mut mint_guard = if options.mint.is_some() {
            let mut by_kind = self.mint_by_kind.write().await;
            if let Some(existing) = self.check_mint_slot_locked(&mut by_kind, &options.kind).await {
                drop(by_kind);
                if let Some(mint) = options.mint.as_ref() {
                    let _ = std::fs::remove_dir_all(&mint.scratch_dir);
                }
                return Ok(existing);
            }
            Some(by_kind)
        } else {
            None
        };

        let spawned = match spawn_login_pty(&options) {
            Ok(spawned) => spawned,
            Err(error) => {
                // A failed spawn leaves nothing behind: the mint guard was
                // never inserted (the lock drops with this return) and the
                // scratch dir the caller prepared is removed on the spot.
                if let Some(mint) = options.mint.as_ref() {
                    let _ = std::fs::remove_dir_all(&mint.scratch_dir);
                }
                return Err(error);
            }
        };
        let SpawnedLoginPty {
            master,
            writer,
            mut reader,
            child,
        } = spawned;
        let cwd = options.cwd.to_string_lossy().to_string();

        let terminal_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let is_mint = options.mint.is_some();
        let mut record = AgentLoginTerminalRecord {
            id: terminal_id.clone(),
            kind: options.kind.clone(),
            title: options.title,
            status: AgentLoginTerminalStatus::Running,
            cwd,
            command_display: options.command_display,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
            mint_status: None,
        };
        let hub = TerminalOutputHub::new();
        let pty = AgentLoginPty {
            record: record.clone(),
            master,
            writer,
            child,
        };

        {
            let mut map = self.terminals.write().await;
            map.insert(terminal_id.clone(), Arc::new(Mutex::new(pty)));
        }
        {
            let mut hubs = self.output_hubs.write().await;
            hubs.insert(terminal_id.clone(), hub.clone());
        }
        if let Some(mint) = options.mint {
            let state = MintState {
                capture: MintCapture::new(),
                kind: options.kind.clone(),
                scratch_dir: Some(mint.scratch_dir),
            };
            record.mint_status = Some(state.capture.status(Instant::now()));
            {
                let mut mints = self.mints.write().await;
                mints.insert(terminal_id.clone(), Arc::new(Mutex::new(state)));
            }
            if let Some(by_kind) = mint_guard.as_mut() {
                by_kind.insert(options.kind.clone(), terminal_id.clone());
            }
        }
        // The single-flight slot is taken; concurrent starts may proceed.
        drop(mint_guard);

        let service = self.clone();
        let tid = terminal_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let rt = tokio::runtime::Handle::current();
                        rt.block_on(async {
                            if is_mint {
                                service.complete_mint_capture(&tid).await;
                            }
                            let code = mark_terminal_exited(&service.terminals, &tid).await;
                            let _ = hub.emit_exit(code).await;
                        });
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let rt = tokio::runtime::Handle::current();
                        rt.block_on(async {
                            if is_mint {
                                feed_mint_capture(&service.mints, &tid, &data).await;
                            }
                            let _ = hub.emit_data(data, None, None).await;
                        });
                    }
                    Err(_) => {
                        let rt = tokio::runtime::Handle::current();
                        rt.block_on(async {
                            if is_mint {
                                service.complete_mint_capture(&tid).await;
                            }
                            let code = mark_terminal_exited(&service.terminals, &tid).await;
                            let _ = hub.emit_exit(code).await;
                        });
                        break;
                    }
                }
            }
        });

        Ok(record)
    }

    pub async fn lookup_terminal(&self, terminal_id: &str) -> Option<AgentLoginTerminalHandle> {
        let pty = {
            let map = self.terminals.read().await;
            map.get(terminal_id).cloned()
        }?;
        Some(AgentLoginTerminalHandle {
            terminal_id: terminal_id.to_string(),
            pty,
            registry: self.terminals.clone(),
            output_hubs: self.output_hubs.clone(),
            mints: self.mints.clone(),
            mint_by_kind: self.mint_by_kind.clone(),
        })
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<AgentLoginTerminalRecord> {
        let mut record = self
            .lookup_terminal(terminal_id)
            .await?
            .snapshot()
            .await
            .ok()?;
        record.mint_status = self.mint_status(terminal_id).await;
        Some(record)
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> anyhow::Result<()> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("agent login terminal not found"))?;
        handle.close().await
    }

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
    async fn check_mint_slot_locked(
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
    async fn complete_mint_capture(&self, terminal_id: &str) {
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

#[derive(Clone)]
pub struct AgentLoginTerminalHandle {
    terminal_id: String,
    pty: AgentLoginPtyRef,
    registry: AgentLoginRegistry,
    output_hubs: AgentLoginOutputRegistry,
    mints: MintRegistry,
    mint_by_kind: Arc<RwLock<HashMap<String, String>>>,
}

impl AgentLoginTerminalHandle {
    pub fn id(&self) -> &str {
        &self.terminal_id
    }

    pub async fn snapshot(&self) -> anyhow::Result<AgentLoginTerminalRecord> {
        let handle = self.current_pty().await?;
        let h = handle.lock().await;
        Ok(h.record.clone())
    }

    pub async fn write_input(&self, data: &[u8]) -> anyhow::Result<()> {
        let handle = self.current_pty().await?;
        let mut h = handle.lock().await;
        h.write_input(data)
    }

    pub async fn resize(
        &self,
        request: ResizeTerminalOptions,
    ) -> anyhow::Result<AgentLoginTerminalRecord> {
        let handle = self.current_pty().await?;
        let mut h = handle.lock().await;
        h.resize(request)?;
        Ok(h.record.clone())
    }

    pub async fn close(&self) -> anyhow::Result<()> {
        let handle = self.current_pty().await?;
        let removed = {
            let mut map = self.registry.write().await;
            match map.get(&self.terminal_id) {
                Some(current) if Arc::ptr_eq(current, &handle) => map.remove(&self.terminal_id),
                _ => None,
            }
        };
        let Some(removed) = removed else {
            anyhow::bail!("agent login terminal not found");
        };
        {
            let mut h = removed.lock().await;
            h.kill();
        }
        let removed_hub = {
            let mut hubs = self.output_hubs.write().await;
            hubs.remove(&self.terminal_id)
        };
        // Mint teardown: an unclaimed capture is an abort — wipe the buffer
        // and remove the scratch dir (a claimed one is already wiped; this is
        // idempotent). The replay copy of the output is zeroed too, and the
        // single-flight slot is released either way.
        let mint = {
            let mut mints = self.mints.write().await;
            mints.remove(&self.terminal_id)
        };
        if let Some(mint) = mint {
            let mut state = mint.lock().await;
            state.teardown();
            let kind = state.kind.clone();
            drop(state);
            if let Some(hub) = removed_hub {
                hub.purge_replay().await;
            }
            let mut by_kind = self.mint_by_kind.write().await;
            if by_kind.get(&kind).map(String::as_str) == Some(self.terminal_id.as_str()) {
                by_kind.remove(&kind);
            }
        }
        Ok(())
    }

    pub async fn subscribe_output(
        &self,
        after_seq: Option<u64>,
    ) -> Option<(
        Vec<TerminalOutputEvent>,
        broadcast::Receiver<TerminalOutputEvent>,
    )> {
        if self.current_pty().await.is_err() {
            return None;
        }
        let hub = {
            let hubs = self.output_hubs.read().await;
            hubs.get(&self.terminal_id).cloned()
        }?;
        let replay = hub.replay(after_seq.unwrap_or(0)).await;
        Some((replay, hub.sender.subscribe()))
    }

    async fn current_pty(&self) -> anyhow::Result<AgentLoginPtyRef> {
        let map = self.registry.read().await;
        match map.get(&self.terminal_id) {
            Some(current) if Arc::ptr_eq(current, &self.pty) => Ok(current.clone()),
            _ => anyhow::bail!("agent login terminal not found"),
        }
    }
}

struct AgentLoginPty {
    record: AgentLoginTerminalRecord,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
    child: Box<dyn Child + Send>,
}

impl AgentLoginPty {
    fn write_input(&mut self, data: &[u8]) -> anyhow::Result<()> {
        self.writer
            .write_all(data)
            .map_err(|e| anyhow::anyhow!("write failed: {e}"))?;
        self.writer
            .flush()
            .map_err(|e| anyhow::anyhow!("flush failed: {e}"))?;
        Ok(())
    }

    fn resize(&mut self, request: ResizeTerminalOptions) -> anyhow::Result<()> {
        self.master.resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(())
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        self.mark_exited();
    }

    fn mark_exited(&mut self) -> Option<i32> {
        let code = self
            .child
            .try_wait()
            .ok()
            .flatten()
            .and_then(|status| i32::try_from(status.exit_code()).ok());
        self.record.status = AgentLoginTerminalStatus::Exited;
        self.record.exit_code = code;
        self.record.updated_at = chrono::Utc::now().to_rfc3339();
        code
    }
}

async fn mark_terminal_exited(terminals: &AgentLoginRegistry, terminal_id: &str) -> Option<i32> {
    let handle = {
        let map = terminals.read().await;
        map.get(terminal_id).cloned()
    }?;
    let mut h = handle.lock().await;
    Some(h.mark_exited()).flatten()
}

async fn feed_mint_capture(mints: &MintRegistry, terminal_id: &str, data: &[u8]) {
    let state = {
        let map = mints.read().await;
        map.get(terminal_id).cloned()
    };
    if let Some(state) = state {
        let mut state = state.lock().await;
        state.capture.feed(data, Instant::now());
    }
}

/// The synchronous PTY-spawn half of `start_terminal`, extracted so its
/// failure paths share one cleanup site (and so the mint guard can stay held
/// across it without threading through `?` returns).
struct SpawnedLoginPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
    reader: Box<dyn IoRead + Send>,
    child: Box<dyn Child + Send>,
}

fn spawn_login_pty(options: &StartAgentLoginTerminalOptions) -> anyhow::Result<SpawnedLoginPty> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: options.rows,
        cols: options.cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| anyhow::anyhow!("failed to open PTY: {e}"))?;

    let cwd = options.cwd.to_string_lossy().to_string();
    let mut cmd = CommandBuilder::new(&options.program);
    cmd.args(&options.args);
    cmd.cwd(&cwd);
    for (key, value) in &options.env {
        cmd.env(key, value);
    }
    cmd.env("TERM", "xterm-256color");
    remove_runtime_private_pty_env(&mut cmd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| anyhow::anyhow!("failed to spawn login command: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| anyhow::anyhow!("failed to take PTY writer: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| anyhow::anyhow!("failed to clone PTY reader: {e}"))?;
    Ok(SpawnedLoginPty {
        master: pair.master,
        writer,
        reader,
        child,
    })
}
