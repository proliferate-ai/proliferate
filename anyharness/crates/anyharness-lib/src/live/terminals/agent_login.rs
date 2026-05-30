use std::collections::HashMap;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::domains::terminals::model::{ResizeTerminalOptions, TerminalOutputEvent};
use crate::process_env::remove_runtime_private_pty_env;

use super::output_sink::TerminalOutputHub;

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
}

type AgentLoginPtyRef = Arc<Mutex<AgentLoginPty>>;
type AgentLoginRegistry = Arc<RwLock<HashMap<String, AgentLoginPtyRef>>>;
type AgentLoginOutputRegistry = Arc<RwLock<HashMap<String, TerminalOutputHub>>>;

#[derive(Clone)]
pub struct AgentLoginTerminalService {
    terminals: AgentLoginRegistry,
    output_hubs: AgentLoginOutputRegistry,
}

impl AgentLoginTerminalService {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            output_hubs: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn start_terminal(
        &self,
        options: StartAgentLoginTerminalOptions,
    ) -> anyhow::Result<AgentLoginTerminalRecord> {
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
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| anyhow::anyhow!("failed to clone PTY reader: {e}"))?;
        let master = pair.master;

        let terminal_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let record = AgentLoginTerminalRecord {
            id: terminal_id.clone(),
            kind: options.kind,
            title: options.title,
            status: AgentLoginTerminalStatus::Running,
            cwd,
            command_display: options.command_display,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
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

        let terminals_ref = self.terminals.clone();
        let tid = terminal_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let rt = tokio::runtime::Handle::current();
                        rt.block_on(async {
                            let code = mark_terminal_exited(&terminals_ref, &tid).await;
                            let _ = hub.emit_exit(code).await;
                        });
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let rt = tokio::runtime::Handle::current();
                        let _ = rt.block_on(hub.emit_data(data, None, None));
                    }
                    Err(_) => {
                        let rt = tokio::runtime::Handle::current();
                        rt.block_on(async {
                            let code = mark_terminal_exited(&terminals_ref, &tid).await;
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
        })
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<AgentLoginTerminalRecord> {
        self.lookup_terminal(terminal_id)
            .await?
            .snapshot()
            .await
            .ok()
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> anyhow::Result<()> {
        let handle = self
            .lookup_terminal(terminal_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("agent login terminal not found"))?;
        handle.close().await
    }
}

#[derive(Clone)]
pub struct AgentLoginTerminalHandle {
    terminal_id: String,
    pty: AgentLoginPtyRef,
    registry: AgentLoginRegistry,
    output_hubs: AgentLoginOutputRegistry,
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
        {
            let mut hubs = self.output_hubs.write().await;
            hubs.remove(&self.terminal_id);
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
            .map(|status| if status.success() { 0 } else { 1 });
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
