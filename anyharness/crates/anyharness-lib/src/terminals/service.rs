use std::collections::{HashMap, VecDeque};
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::io::AsyncReadExt;
use tokio::sync::{broadcast, Mutex, RwLock};

use super::model::{
    CreateTerminalOptions, ResizeTerminalOptions, RunTerminalCommandOptions, ShellKind,
    TerminalCommandOutputMode, TerminalCommandRunRecord, TerminalCommandRunStatus, TerminalPurpose,
    TerminalRecord, TerminalStatus,
};
use super::shell::{
    configure_compact_prompt, detect_default_shell, detect_posix_shell, detect_shell_kind,
};
use super::store::TerminalStore;

const MAX_COMMAND_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_SETUP_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_REPLAY_BYTES: usize = 1024 * 1024;
const MAX_REPLAY_FRAMES: usize = 5_000;

struct PtyHandle {
    record: TerminalRecord,
    _shell_path: String,
    shell_kind: ShellKind,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    active_pty_command: Option<ActivePtyCommand>,
}

struct ActivePtyCommand {
    command_run_id: String,
    nonce: String,
    script_path: PathBuf,
    buffer: String,
    capturing: bool,
    combined: String,
    output_truncated: bool,
    timed_out: bool,
    timeout_task: Option<tokio::task::AbortHandle>,
    started_at: Instant,
}

struct ActiveSetupTask {
    command_run_id: String,
    abort_handle: tokio::task::AbortHandle,
}

#[derive(Debug, Clone)]
pub enum TerminalOutputEvent {
    Data {
        seq: u64,
        data: Vec<u8>,
        stream: Option<&'static str>,
        command_run_id: Option<String>,
    },
    Exit {
        seq: u64,
        code: Option<i32>,
    },
    ReplayGap {
        requested_after_seq: u64,
        floor_seq: u64,
    },
}

#[derive(Clone)]
struct TerminalOutputHub {
    sender: broadcast::Sender<TerminalOutputEvent>,
    replay: Arc<Mutex<ReplayBuffer>>,
}

struct ReplayBuffer {
    frames: VecDeque<TerminalOutputEvent>,
    next_seq: u64,
    byte_len: usize,
    floor_seq: u64,
}

pub struct TerminalService {
    terminals: Arc<RwLock<HashMap<String, Arc<Mutex<PtyHandle>>>>>,
    output_hubs: Arc<RwLock<HashMap<String, TerminalOutputHub>>>,
    store: TerminalStore,
    runtime_home: PathBuf,
    active_setup_tasks: Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
}

impl TerminalService {
    pub fn new(store: TerminalStore, runtime_home: PathBuf) -> Self {
        let service = Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            output_hubs: Arc::new(RwLock::new(HashMap::new())),
            store,
            runtime_home,
            active_setup_tasks: Arc::new(Mutex::new(HashMap::new())),
        };
        if let Err(error) = service.store.mark_active_runs_failed_on_startup() {
            tracing::warn!(error = %error, "failed to mark active terminal command-runs failed on startup");
        }
        if let Err(error) = service.store.prune_completed_non_setup_runs(100) {
            tracing::warn!(error = %error, "failed to prune terminal command-runs on startup");
        }
        service
    }

    pub async fn list_terminals(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        let map = self.terminals.read().await;
        let mut results = Vec::new();
        for handle in map.values() {
            let h = handle.lock().await;
            if h.record.workspace_id == workspace_id {
                results.push(self.with_latest_command_run(h.record.clone()));
            }
        }
        results.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        results
    }

    pub fn list_terminals_blocking(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        let map = self.terminals.blocking_read();
        let mut results = Vec::new();
        for handle in map.values() {
            let h = handle.blocking_lock();
            if h.record.workspace_id == workspace_id {
                results.push(self.with_latest_command_run(h.record.clone()));
            }
        }
        results.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        results
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<TerminalRecord> {
        let map = self.terminals.read().await;
        let handle = map.get(terminal_id)?;
        let h = handle.lock().await;
        Some(self.with_latest_command_run(h.record.clone()))
    }

    pub fn get_command_run(&self, id: &str) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.store.get_command_run(id)
    }

    pub fn latest_setup_run(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Option<TerminalCommandRunRecord>> {
        self.store.latest_setup_run(workspace_id)
    }

    pub async fn create_terminal(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        request: CreateTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        let record = self
            .create_terminal_shell(workspace_id, workspace_path, &request)
            .await?;

        if let Some(command) = request.startup_command.clone() {
            let _ = self
                .run_terminal_command(
                    &record.id,
                    RunTerminalCommandOptions {
                        command,
                        env: request.startup_command_env,
                        interrupt: false,
                        timeout_ms: request.startup_command_timeout_ms,
                    },
                )
                .await?;
        }

        Ok(self.get_terminal(&record.id).await.unwrap_or(record))
    }

    async fn create_terminal_shell(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        request: &CreateTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| anyhow::anyhow!("failed to open PTY: {e}"))?;

        let cwd = request
            .cwd
            .as_deref()
            .map(|c| {
                let p = Path::new(workspace_path).join(c);
                p.to_string_lossy().to_string()
            })
            .unwrap_or_else(|| workspace_path.to_string());

        let cwd_path = Path::new(&cwd);
        if !cwd_path.starts_with(workspace_path) {
            anyhow::bail!("cwd must be within the workspace boundary");
        }

        let shell = request.shell.clone().unwrap_or_else(|| {
            if matches!(
                request.purpose,
                TerminalPurpose::Run | TerminalPurpose::Setup
            ) {
                detect_posix_shell()
            } else {
                detect_default_shell()
            }
        });
        let shell_kind = detect_shell_kind(&shell);

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);
        for (key, value) in request.env.clone() {
            cmd.env(key, value);
        }
        cmd.env("TERM", "xterm-256color");
        configure_compact_prompt(&mut cmd, &shell, workspace_path);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| anyhow::anyhow!("failed to spawn shell: {e}"))?;

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

        let record = TerminalRecord {
            id: terminal_id.clone(),
            workspace_id: workspace_id.to_string(),
            title: request
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Terminal")
                .to_string(),
            purpose: request.purpose,
            cwd: cwd.clone(),
            status: TerminalStatus::Running,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
            command_run: None,
        };

        let hub = TerminalOutputHub::new();

        let handle = PtyHandle {
            record: record.clone(),
            _shell_path: shell,
            shell_kind,
            master,
            writer,
            child,
            active_pty_command: None,
        };

        {
            let mut map = self.terminals.write().await;
            map.insert(terminal_id.clone(), Arc::new(Mutex::new(handle)));
        }
        {
            let mut hubs = self.output_hubs.write().await;
            hubs.insert(terminal_id.clone(), hub.clone());
        }

        let terminals_ref = self.terminals.clone();
        let store = self.store.clone();
        let tid = terminal_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = tokio::runtime::Handle::current().block_on(hub.emit_exit(None));
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let _ = tokio::runtime::Handle::current().block_on(process_pty_output(
                            &terminals_ref,
                            &store,
                            &hub,
                            &tid,
                            data,
                        ));
                    }
                    Err(_) => {
                        let _ = tokio::runtime::Handle::current().block_on(hub.emit_exit(None));
                        break;
                    }
                }
            }

            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let map = terminals_ref.read().await;
                if let Some(handle) = map.get(&tid) {
                    let mut h = handle.lock().await;
                    let code =
                        h.child
                            .try_wait()
                            .ok()
                            .flatten()
                            .map(|s| if s.success() { 0 } else { 1 });
                    if let Some(mut active) = h.active_pty_command.take() {
                        if let Some(timeout_task) = active.timeout_task.take() {
                            timeout_task.abort();
                        }
                        let _ = std::fs::remove_file(&active.script_path);
                        let mut record = store
                            .get_command_run(&active.command_run_id)
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| {
                                new_command_run_record(
                                    &active.command_run_id,
                                    &h.record.workspace_id,
                                    Some(&h.record.id),
                                    h.record.purpose,
                                    "",
                                    TerminalCommandOutputMode::Combined,
                                )
                            });
                        complete_command_run(
                            &mut record,
                            TerminalCommandRunStatus::Failed,
                            Some(-1),
                            None,
                            None,
                            Some(active.combined),
                            active.output_truncated,
                            Some(active.started_at),
                        );
                        let _ = store.update_command_run(&record);
                    }
                    h.record.status = TerminalStatus::Exited;
                    h.record.exit_code = code;
                    h.record.updated_at = chrono::Utc::now().to_rfc3339();
                }
            });
        });

        Ok(record)
    }

    pub async fn run_terminal_command(
        &self,
        terminal_id: &str,
        request: RunTerminalCommandOptions,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        let handle = {
            let map = self.terminals.read().await;
            map.get(terminal_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("terminal not found"))?
        };

        let mut h = handle.lock().await;
        if !h.shell_kind.is_posix() {
            anyhow::bail!("unsupported_terminal_shell");
        }
        if h.record.purpose == TerminalPurpose::Setup
            && self.is_setup_running(&h.record.workspace_id).await
        {
            anyhow::bail!("setup terminal input is blocked while setup is running");
        }

        if let Some(active) = h.active_pty_command.as_ref() {
            if !request.interrupt {
                anyhow::bail!(
                    "terminal command already running: {}",
                    active.command_run_id
                );
            }
        }

        if request.interrupt {
            if let Some(mut active) = h.active_pty_command.take() {
                if let Some(timeout_task) = active.timeout_task.take() {
                    timeout_task.abort();
                }
                let _ = h.writer.write_all(b"\x03");
                let _ = h.writer.flush();
                self.mark_command_interrupted(&active.command_run_id)?;
                let _ = std::fs::remove_file(active.script_path);
            }
        }

        let command = request.command.trim().to_string();
        if command.is_empty() {
            anyhow::bail!("command must not be empty");
        }
        validate_env_vars(&request.env, true)?;

        let command_run_id = uuid::Uuid::new_v4().to_string();
        let mut record = new_command_run_record(
            &command_run_id,
            &h.record.workspace_id,
            Some(&h.record.id),
            h.record.purpose,
            &command,
            TerminalCommandOutputMode::Combined,
        );
        record.status = TerminalCommandRunStatus::Running;
        record.started_at = Some(chrono::Utc::now().to_rfc3339());
        record.updated_at = record
            .started_at
            .clone()
            .unwrap_or_else(|| record.created_at.clone());
        self.store.insert_command_run(&record)?;

        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let script = self.write_command_script(&command, &request.env)?;
        let wrapper = build_pty_command_wrapper(&nonce, &script);
        h.active_pty_command = Some(ActivePtyCommand {
            command_run_id: command_run_id.clone(),
            nonce,
            script_path: script,
            buffer: String::new(),
            capturing: false,
            combined: String::new(),
            output_truncated: false,
            timed_out: false,
            timeout_task: None,
            started_at: Instant::now(),
        });
        if let Some(timeout_ms) = request.timeout_ms {
            let timeout_task = tokio::spawn(enforce_pty_command_timeout(
                self.terminals.clone(),
                self.store.clone(),
                h.record.id.clone(),
                command_run_id.clone(),
                Duration::from_millis(timeout_ms),
            ));
            if let Some(active) = h.active_pty_command.as_mut() {
                active.timeout_task = Some(timeout_task.abort_handle());
            }
        }
        h.record.command_run = Some(record.clone());
        h.writer
            .write_all(wrapper.as_bytes())
            .map_err(|e| anyhow::anyhow!("write failed: {e}"))?;
        h.writer
            .flush()
            .map_err(|e| anyhow::anyhow!("flush failed: {e}"))?;
        Ok(record)
    }

    pub async fn start_setup_command(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        command: String,
        env_vars: Vec<(String, String)>,
        timeout_ms: Option<u64>,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        validate_env_vars(&env_vars, false)?;
        if let Some(active) = self.active_setup_tasks.lock().await.remove(workspace_id) {
            self.mark_command_interrupted_with_message(
                &active.command_run_id,
                "Setup command superseded by a new run",
            )?;
            active.abort_handle.abort();
        }

        let terminal = match self.find_live_setup_terminal(workspace_id).await {
            Some(record) => record,
            None => {
                self.create_terminal_shell(
                    workspace_id,
                    workspace_path,
                    &CreateTerminalOptions {
                        cwd: None,
                        shell: Some(detect_posix_shell()),
                        title: Some("Setup command".to_string()),
                        purpose: TerminalPurpose::Setup,
                        env: Vec::new(),
                        startup_command: None,
                        startup_command_env: Vec::new(),
                        startup_command_timeout_ms: None,
                        cols: 120,
                        rows: 40,
                    },
                )
                .await?
            }
        };

        let command_run_id = uuid::Uuid::new_v4().to_string();
        let mut record = new_command_run_record(
            &command_run_id,
            workspace_id,
            Some(&terminal.id),
            TerminalPurpose::Setup,
            command.trim(),
            TerminalCommandOutputMode::Separate,
        );
        record.status = TerminalCommandRunStatus::Running;
        record.started_at = Some(chrono::Utc::now().to_rfc3339());
        record.updated_at = record
            .started_at
            .clone()
            .unwrap_or_else(|| record.created_at.clone());
        self.store.insert_command_run(&record)?;
        self.store
            .set_latest_setup_run(workspace_id, &command_run_id)?;
        self.set_terminal_command_run(&terminal.id, record.clone())
            .await;

        let store = self.store.clone();
        let hubs = self.output_hubs.clone();
        let active_setup_tasks = self.active_setup_tasks.clone();
        let terminal_id = terminal.id.clone();
        let workspace_id_owned = workspace_id.to_string();
        let workspace_path_owned = workspace_path.to_string();
        let timeout =
            Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_SETUP_TIMEOUT.as_millis() as u64));
        let task_record = record.clone();
        let task_workspace_id = workspace_id_owned.clone();
        let task_command_run_id = command_run_id.clone();
        let handle = tokio::spawn(async move {
            run_setup_process(
                store,
                hubs,
                task_record,
                terminal_id,
                workspace_path_owned,
                command,
                env_vars,
                timeout,
            )
            .await;
            let mut tasks = active_setup_tasks.lock().await;
            if tasks
                .get(&task_workspace_id)
                .map(|active| active.command_run_id.as_str())
                == Some(task_command_run_id.as_str())
            {
                tasks.remove(&task_workspace_id);
            }
        });
        self.active_setup_tasks.lock().await.insert(
            workspace_id_owned,
            ActiveSetupTask {
                command_run_id,
                abort_handle: handle.abort_handle(),
            },
        );

        Ok(record)
    }

    pub async fn rerun_setup_command(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        env_vars: Vec<(String, String)>,
    ) -> anyhow::Result<TerminalCommandRunRecord> {
        let previous = self.store.latest_setup_run(workspace_id)?.ok_or_else(|| {
            anyhow::anyhow!("No previous setup execution found for this workspace")
        })?;
        self.start_setup_command(
            workspace_id,
            workspace_path,
            previous.command,
            env_vars,
            Some(DEFAULT_SETUP_TIMEOUT.as_millis() as u64),
        )
        .await
    }

    pub async fn is_setup_running(&self, workspace_id: &str) -> bool {
        self.store
            .latest_setup_run(workspace_id)
            .ok()
            .flatten()
            .map(|run| {
                matches!(
                    run.status,
                    TerminalCommandRunStatus::Queued | TerminalCommandRunStatus::Running
                )
            })
            .unwrap_or(false)
    }

    pub fn is_setup_running_blocking(&self, workspace_id: &str) -> bool {
        self.store
            .latest_setup_run(workspace_id)
            .ok()
            .flatten()
            .map(|run| {
                matches!(
                    run.status,
                    TerminalCommandRunStatus::Queued | TerminalCommandRunStatus::Running
                )
            })
            .unwrap_or(false)
    }

    pub async fn update_terminal_title(
        &self,
        terminal_id: &str,
        title: String,
    ) -> anyhow::Result<TerminalRecord> {
        let map = self.terminals.read().await;
        let handle = map
            .get(terminal_id)
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        let mut h = handle.lock().await;
        h.record.title = title;
        h.record.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(self.with_latest_command_run(h.record.clone()))
    }

    pub async fn write_input(&self, terminal_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let map = self.terminals.read().await;
        let handle = map
            .get(terminal_id)
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        let mut h = handle.lock().await;
        if h.record.purpose == TerminalPurpose::Setup
            && self.is_setup_running(&h.record.workspace_id).await
        {
            anyhow::bail!("setup terminal input is blocked while setup is running");
        }
        h.writer
            .write_all(data)
            .map_err(|e| anyhow::anyhow!("write failed: {e}"))?;
        h.writer
            .flush()
            .map_err(|e| anyhow::anyhow!("flush failed: {e}"))?;
        Ok(())
    }

    pub async fn resize_terminal(
        &self,
        terminal_id: &str,
        request: ResizeTerminalOptions,
    ) -> anyhow::Result<TerminalRecord> {
        let map = self.terminals.read().await;
        let handle = map
            .get(terminal_id)
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        let mut h = handle.lock().await;
        h.master.resize(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        h.record.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(self.with_latest_command_run(h.record.clone()))
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> anyhow::Result<()> {
        let handle = {
            let map = self.terminals.read().await;
            map.get(terminal_id).cloned()
        };
        if let Some(handle) = &handle {
            let h = handle.lock().await;
            if h.record.purpose == TerminalPurpose::Setup
                && self.is_setup_running(&h.record.workspace_id).await
            {
                anyhow::bail!("cannot close setup terminal while setup is running");
            }
        }
        let handle = {
            let mut map = self.terminals.write().await;
            map.remove(terminal_id)
        };
        if let Some(handle) = handle {
            let mut h = handle.lock().await;
            let _ = h.child.kill();
        }
        {
            let mut hubs = self.output_hubs.write().await;
            hubs.remove(terminal_id);
        }
        Ok(())
    }

    pub fn close_terminal_blocking(&self, terminal_id: &str) -> anyhow::Result<()> {
        tokio::runtime::Handle::current().block_on(self.close_terminal(terminal_id))
    }

    pub async fn subscribe_output(
        &self,
        terminal_id: &str,
        after_seq: Option<u64>,
    ) -> Option<(
        Vec<TerminalOutputEvent>,
        broadcast::Receiver<TerminalOutputEvent>,
    )> {
        let hubs = self.output_hubs.read().await;
        let hub = hubs.get(terminal_id)?;
        let replay = hub.replay(after_seq.unwrap_or(0)).await;
        Some((replay, hub.sender.subscribe()))
    }

    async fn find_live_setup_terminal(&self, workspace_id: &str) -> Option<TerminalRecord> {
        self.list_terminals(workspace_id)
            .await
            .into_iter()
            .find(|record| record.purpose == TerminalPurpose::Setup)
    }

    async fn set_terminal_command_run(&self, terminal_id: &str, run: TerminalCommandRunRecord) {
        let map = self.terminals.read().await;
        if let Some(handle) = map.get(terminal_id) {
            let mut h = handle.lock().await;
            h.record.command_run = Some(run);
            h.record.updated_at = chrono::Utc::now().to_rfc3339();
        }
    }

    fn with_latest_command_run(&self, mut record: TerminalRecord) -> TerminalRecord {
        record.command_run = self
            .store
            .latest_command_run_for_terminal(&record.id)
            .ok()
            .flatten();
        record
    }

    fn mark_command_interrupted(&self, command_run_id: &str) -> anyhow::Result<()> {
        if let Some(mut record) = self.store.get_command_run(command_run_id)? {
            let combined_output = record.combined_output.clone();
            let output_truncated = record.output_truncated;
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Interrupted,
                Some(130),
                None,
                None,
                combined_output,
                output_truncated,
                None,
            );
            self.store.update_command_run(&record)?;
        }
        Ok(())
    }

    fn mark_command_interrupted_with_message(
        &self,
        command_run_id: &str,
        message: &str,
    ) -> anyhow::Result<()> {
        if let Some(mut record) = self.store.get_command_run(command_run_id)? {
            let output_truncated = record.output_truncated;
            let stdout = record.stdout.clone();
            let stderr = Some(match record.stderr.as_deref() {
                Some(existing) if !existing.trim().is_empty() => {
                    format!("{existing}\n{message}")
                }
                _ => message.to_string(),
            });
            let combined_output = record.combined_output.clone();
            let (stdout, stderr, combined_output) = match record.output_mode {
                TerminalCommandOutputMode::Separate => (stdout, stderr, None),
                TerminalCommandOutputMode::Combined => (None, None, combined_output),
            };
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Interrupted,
                Some(130),
                stdout,
                stderr,
                combined_output,
                output_truncated,
                None,
            );
            self.store.update_command_run(&record)?;
        }
        Ok(())
    }

    fn write_command_script(
        &self,
        command: &str,
        env: &[(String, String)],
    ) -> anyhow::Result<PathBuf> {
        let dir = self.runtime_home.join("tmp").join("terminal-command-runs");
        std::fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let path = dir.join(format!("{}.sh", uuid::Uuid::new_v4()));
        let mut contents = String::new();
        for (key, value) in env {
            contents.push_str("export ");
            contents.push_str(key);
            contents.push('=');
            contents.push_str(&shell_quote(value));
            contents.push('\n');
        }
        contents.push_str(command);
        contents.push('\n');
        std::fs::write(&path, contents)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(path)
    }
}

impl TerminalOutputHub {
    fn new() -> Self {
        let (sender, _) = broadcast::channel(512);
        Self {
            sender,
            replay: Arc::new(Mutex::new(ReplayBuffer {
                frames: VecDeque::new(),
                next_seq: 1,
                byte_len: 0,
                floor_seq: 1,
            })),
        }
    }

    async fn replay(&self, after_seq: u64) -> Vec<TerminalOutputEvent> {
        let replay = self.replay.lock().await;
        let mut frames = Vec::new();
        if after_seq > 0 && after_seq < replay.floor_seq.saturating_sub(1) {
            frames.push(TerminalOutputEvent::ReplayGap {
                requested_after_seq: after_seq,
                floor_seq: replay.floor_seq,
            });
        }
        frames.extend(replay.frames.iter().filter_map(|frame| {
            let seq = frame.seq()?;
            (seq > after_seq).then(|| frame.clone())
        }));
        frames
    }

    async fn emit_data(
        &self,
        data: Vec<u8>,
        stream: Option<&'static str>,
        command_run_id: Option<String>,
    ) -> anyhow::Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        let event = {
            let mut replay = self.replay.lock().await;
            let seq = replay.next_seq;
            replay.next_seq += 1;
            let event = TerminalOutputEvent::Data {
                seq,
                data,
                stream,
                command_run_id,
            };
            replay.push(event.clone());
            event
        };
        let _ = self.sender.send(event);
        Ok(())
    }

    async fn emit_exit(&self, code: Option<i32>) -> anyhow::Result<()> {
        let event = {
            let mut replay = self.replay.lock().await;
            let seq = replay.next_seq;
            replay.next_seq += 1;
            let event = TerminalOutputEvent::Exit { seq, code };
            replay.push(event.clone());
            event
        };
        let _ = self.sender.send(event);
        Ok(())
    }
}

impl ReplayBuffer {
    fn push(&mut self, event: TerminalOutputEvent) {
        self.byte_len += event.approx_bytes();
        self.frames.push_back(event);
        while self.byte_len > MAX_REPLAY_BYTES || self.frames.len() > MAX_REPLAY_FRAMES {
            if let Some(front) = self.frames.pop_front() {
                self.byte_len = self.byte_len.saturating_sub(front.approx_bytes());
                if let Some(seq) = front.seq() {
                    self.floor_seq = seq + 1;
                }
            } else {
                break;
            }
        }
    }
}

impl TerminalOutputEvent {
    fn seq(&self) -> Option<u64> {
        match self {
            TerminalOutputEvent::Data { seq, .. } | TerminalOutputEvent::Exit { seq, .. } => {
                Some(*seq)
            }
            TerminalOutputEvent::ReplayGap { .. } => None,
        }
    }

    fn approx_bytes(&self) -> usize {
        match self {
            TerminalOutputEvent::Data { data, .. } => data.len(),
            TerminalOutputEvent::Exit { .. } => 32,
            TerminalOutputEvent::ReplayGap { .. } => 32,
        }
    }
}

async fn process_pty_output(
    terminals: &Arc<RwLock<HashMap<String, Arc<Mutex<PtyHandle>>>>>,
    store: &TerminalStore,
    hub: &TerminalOutputHub,
    terminal_id: &str,
    data: Vec<u8>,
) -> anyhow::Result<()> {
    let output;
    let mut completed: Option<TerminalCommandRunRecord> = None;
    let command_run_id = {
        let map = terminals.read().await;
        let Some(handle) = map.get(terminal_id) else {
            return Ok(());
        };
        let mut h = handle.lock().await;
        if let Some(active) = h.active_pty_command.as_mut() {
            let id = active.command_run_id.clone();
            output = filter_pty_command_output(active, &data, store, &mut completed)?;
            if completed.is_some() {
                if let Some(mut active) = h.active_pty_command.take() {
                    if let Some(timeout_task) = active.timeout_task.take() {
                        timeout_task.abort();
                    }
                    let _ = std::fs::remove_file(active.script_path);
                }
            }
            Some(id)
        } else {
            output = data;
            None
        }
    };

    if let Some(record) = completed {
        store.update_command_run(&record)?;
    }
    hub.emit_data(output, None, command_run_id).await?;
    Ok(())
}

fn filter_pty_command_output(
    active: &mut ActivePtyCommand,
    data: &[u8],
    store: &TerminalStore,
    completed: &mut Option<TerminalCommandRunRecord>,
) -> anyhow::Result<Vec<u8>> {
    active.buffer.push_str(&String::from_utf8_lossy(data));
    let start_marker = format!("__ANYHARNESS_CMD_START_{}__", active.nonce);
    let end_prefix = format!("__ANYHARNESS_CMD_END_{}_", active.nonce);
    let mut output = String::new();

    loop {
        if !active.capturing {
            if let Some(index) = active.buffer.find(&start_marker) {
                let after = index + start_marker.len();
                let rest = active.buffer[after..]
                    .trim_start_matches(['\r', '\n'])
                    .to_string();
                active.buffer = rest;
                active.capturing = true;
            } else {
                if active.buffer.len() > 16 * 1024 {
                    let keep_from = active.buffer.len() - 1024;
                    active.buffer = active.buffer[keep_from..].to_string();
                }
                break;
            }
        }

        if active.capturing {
            if let Some(index) = active.buffer.find(&end_prefix) {
                let captured = active.buffer[..index].to_string();
                output.push_str(&captured);
                append_bounded(
                    &mut active.combined,
                    &captured,
                    &mut active.output_truncated,
                );
                let after_prefix = index + end_prefix.len();
                let tail = &active.buffer[after_prefix..];
                let Some(end_idx) = tail.find("__") else {
                    active.buffer = active.buffer[index..].to_string();
                    break;
                };
                let exit_text = &tail[..end_idx];
                let exit_code = exit_text.parse::<i32>().unwrap_or(-1);
                let remainder = tail[end_idx + 2..]
                    .trim_start_matches(['\r', '\n'])
                    .to_string();
                active.buffer = remainder;
                let mut record = store
                    .get_command_run(&active.command_run_id)?
                    .ok_or_else(|| anyhow::anyhow!("command run not found"))?;
                let (status, exit_code) = if active.timed_out {
                    (TerminalCommandRunStatus::TimedOut, 124)
                } else if exit_code == 0 {
                    (TerminalCommandRunStatus::Succeeded, exit_code)
                } else {
                    (TerminalCommandRunStatus::Failed, exit_code)
                };
                complete_command_run(
                    &mut record,
                    status,
                    Some(exit_code),
                    None,
                    None,
                    Some(active.combined.clone()),
                    active.output_truncated,
                    Some(active.started_at),
                );
                *completed = Some(record);
                break;
            } else {
                let emit_len = safe_emit_len_before_marker(&active.buffer, &end_prefix);
                let captured = active.buffer[..emit_len].to_string();
                let retained = active.buffer[emit_len..].to_string();
                output.push_str(&captured);
                append_bounded(
                    &mut active.combined,
                    &captured,
                    &mut active.output_truncated,
                );
                active.buffer = retained;
                break;
            }
        }
    }

    Ok(output.into_bytes())
}

fn safe_emit_len_before_marker(buffer: &str, marker: &str) -> usize {
    let max_suffix_len = marker.len().saturating_sub(1).min(buffer.len());
    for len in (1..=max_suffix_len).rev() {
        if buffer.ends_with(&marker[..len]) {
            return buffer.len() - len;
        }
    }
    buffer.len()
}

async fn enforce_pty_command_timeout(
    terminals: Arc<RwLock<HashMap<String, Arc<Mutex<PtyHandle>>>>>,
    store: TerminalStore,
    terminal_id: String,
    command_run_id: String,
    timeout: Duration,
) {
    if timeout.is_zero() {
        return;
    }

    tokio::time::sleep(timeout).await;
    {
        let map = terminals.read().await;
        let Some(handle) = map.get(&terminal_id) else {
            return;
        };
        let mut h = handle.lock().await;
        let Some(active) = h.active_pty_command.as_mut() else {
            return;
        };
        if active.command_run_id != command_run_id {
            return;
        }
        active.timed_out = true;
        let _ = h.writer.write_all(b"\x03");
        let _ = h.writer.flush();
    }

    tokio::time::sleep(Duration::from_secs(5)).await;
    let completed = {
        let map = terminals.read().await;
        let Some(handle) = map.get(&terminal_id) else {
            return;
        };
        let mut h = handle.lock().await;
        let Some(active) = h.active_pty_command.as_ref() else {
            return;
        };
        if active.command_run_id != command_run_id {
            return;
        }
        let mut active = h.active_pty_command.take().expect("active command exists");
        let _ = std::fs::remove_file(&active.script_path);
        if let Some(timeout_task) = active.timeout_task.take() {
            timeout_task.abort();
        }
        let mut record = match store.get_command_run(&command_run_id) {
            Ok(Some(record)) => record,
            _ => return,
        };
        complete_command_run(
            &mut record,
            TerminalCommandRunStatus::TimedOut,
            Some(124),
            None,
            None,
            Some(active.combined),
            active.output_truncated,
            Some(active.started_at),
        );
        h.record.command_run = Some(record.clone());
        Some(record)
    };

    if let Some(record) = completed {
        let _ = store.update_command_run(&record);
    }
}

async fn run_setup_process(
    store: TerminalStore,
    hubs: Arc<RwLock<HashMap<String, TerminalOutputHub>>>,
    mut record: TerminalCommandRunRecord,
    terminal_id: String,
    workspace_path: String,
    command: String,
    env_vars: Vec<(String, String)>,
    timeout: Duration,
) {
    let started_at = Instant::now();
    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-lc")
        .arg(command)
        .current_dir(workspace_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Failed,
                Some(-1),
                Some(String::new()),
                Some(format!("failed to spawn setup command: {error}")),
                None,
                false,
                Some(started_at),
            );
            let _ = store.update_command_run(&record);
            return;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(&'static str, Vec<u8>)>(64);

    if let Some(mut stdout) = stdout {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(("stdout", buf[..n].to_vec())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    if let Some(mut stderr) = stderr {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match stderr.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(("stderr", buf[..n].to_vec())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);

    let hub = hubs.read().await.get(&terminal_id).cloned();
    let deadline = tokio::time::Instant::now() + timeout;
    let mut stdout_capture = String::new();
    let mut stderr_capture = String::new();
    let mut output_truncated = false;
    let mut status: Option<std::process::ExitStatus> = None;
    let mut timed_out = false;

    loop {
        tokio::select! {
            chunk = rx.recv() => {
                if let Some((stream, data)) = chunk {
                    if stream == "stdout" {
                        append_bounded(&mut stdout_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    } else {
                        append_bounded(&mut stderr_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    }
                    if let Some(hub) = &hub {
                        let _ = hub.emit_data(data, Some(stream), Some(record.id.clone())).await;
                    }
                }
            }
            result = child.wait() => {
                status = result.ok();
                while let Some((stream, data)) = rx.recv().await {
                    if stream == "stdout" {
                        append_bounded(&mut stdout_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    } else {
                        append_bounded(&mut stderr_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    }
                    if let Some(hub) = &hub {
                        let _ = hub.emit_data(data, Some(stream), Some(record.id.clone())).await;
                    }
                }
                break;
            }
            _ = tokio::time::sleep_until(deadline) => {
                timed_out = true;
                let _ = child.start_kill();
                let _ = child.wait().await;
                while let Some((stream, data)) = rx.recv().await {
                    if stream == "stdout" {
                        append_bounded(&mut stdout_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    } else {
                        append_bounded(&mut stderr_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    }
                    if let Some(hub) = &hub {
                        let _ = hub.emit_data(data, Some(stream), Some(record.id.clone())).await;
                    }
                }
                break;
            }
        }
    }

    if timed_out {
        complete_command_run(
            &mut record,
            TerminalCommandRunStatus::TimedOut,
            Some(124),
            Some(stdout_capture),
            Some(if stderr_capture.is_empty() {
                "setup command timed out".to_string()
            } else {
                stderr_capture
            }),
            None,
            output_truncated,
            Some(started_at),
        );
    } else {
        let exit_code = status.and_then(|status| status.code()).unwrap_or(-1);
        complete_command_run(
            &mut record,
            if exit_code == 0 {
                TerminalCommandRunStatus::Succeeded
            } else {
                TerminalCommandRunStatus::Failed
            },
            Some(exit_code),
            Some(stdout_capture),
            Some(stderr_capture),
            None,
            output_truncated,
            Some(started_at),
        );
    }
    let _ = store.update_command_run(&record);
}

fn new_command_run_record(
    id: &str,
    workspace_id: &str,
    terminal_id: Option<&str>,
    purpose: TerminalPurpose,
    command: &str,
    output_mode: TerminalCommandOutputMode,
) -> TerminalCommandRunRecord {
    let now = chrono::Utc::now().to_rfc3339();
    TerminalCommandRunRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        terminal_id: terminal_id.map(str::to_string),
        purpose,
        command: command.to_string(),
        status: TerminalCommandRunStatus::Queued,
        exit_code: None,
        output_mode,
        stdout: None,
        stderr: None,
        combined_output: None,
        output_truncated: false,
        started_at: None,
        completed_at: None,
        duration_ms: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn complete_command_run(
    record: &mut TerminalCommandRunRecord,
    status: TerminalCommandRunStatus,
    exit_code: Option<i32>,
    stdout: Option<String>,
    stderr: Option<String>,
    combined_output: Option<String>,
    output_truncated: bool,
    started_at: Option<Instant>,
) {
    let now = chrono::Utc::now().to_rfc3339();
    record.status = status;
    record.exit_code = exit_code;
    record.stdout = stdout;
    record.stderr = stderr;
    record.combined_output = combined_output;
    record.output_truncated = output_truncated;
    record.completed_at = Some(now.clone());
    record.updated_at = now;
    if let Some(started_at) = started_at {
        record.duration_ms = Some(started_at.elapsed().as_millis() as u64);
    }
}

fn append_bounded(target: &mut String, chunk: &str, truncated: &mut bool) {
    if target.len() >= MAX_COMMAND_OUTPUT_BYTES {
        *truncated = true;
        return;
    }
    let remaining = MAX_COMMAND_OUTPUT_BYTES - target.len();
    if chunk.len() <= remaining {
        target.push_str(chunk);
        return;
    }
    let mut end = remaining;
    while end > 0 && !chunk.is_char_boundary(end) {
        end -= 1;
    }
    target.push_str(&chunk[..end]);
    *truncated = true;
}

fn validate_env_vars(env_vars: &[(String, String)], reject_reserved: bool) -> anyhow::Result<()> {
    for (key, _) in env_vars {
        let mut chars = key.chars();
        let valid = chars
            .next()
            .map(|first| first == '_' || first.is_ascii_alphabetic())
            .unwrap_or(false)
            && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric());
        if !valid || (reject_reserved && key.starts_with("ANYHARNESS_")) {
            anyhow::bail!("invalid setup environment variable: {key}");
        }
    }
    Ok(())
}

fn build_pty_command_wrapper(nonce: &str, script: &Path) -> String {
    let script = shell_quote(&script.to_string_lossy());
    format!(
        "anyharness_prefix='__ANYHARNESS_CMD_'; anyharness_nonce='{nonce}'; printf '%s\\n' \"${{anyharness_prefix}}START_${{anyharness_nonce}}__\"; . {script}; anyharness_code=$?; printf '%s\\n' \"${{anyharness_prefix}}END_${{anyharness_nonce}}_${{anyharness_code}}__\"\n"
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn terminal_frame_to_json(terminal_id: &str, event: TerminalOutputEvent) -> serde_json::Value {
    match event {
        TerminalOutputEvent::Data {
            seq,
            data,
            stream,
            command_run_id,
        } => {
            let mut value = serde_json::json!({
                "type": "data",
                "seq": seq,
                "terminalId": terminal_id,
                "dataBase64": base64::engine::general_purpose::STANDARD.encode(data),
            });
            if let Some(stream) = stream {
                value["stream"] = serde_json::Value::String(stream.to_string());
            }
            if let Some(command_run_id) = command_run_id {
                value["commandRunId"] = serde_json::Value::String(command_run_id);
            }
            value
        }
        TerminalOutputEvent::Exit { seq, code } => serde_json::json!({
            "type": "exit",
            "seq": seq,
            "terminalId": terminal_id,
            "code": code,
        }),
        TerminalOutputEvent::ReplayGap {
            requested_after_seq,
            floor_seq,
        } => serde_json::json!({
            "type": "replay_gap",
            "terminalId": terminal_id,
            "requestedAfterSeq": requested_after_seq,
            "floorSeq": floor_seq,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;
    use crate::workspaces::model::WorkspaceRecord;
    use crate::workspaces::store::WorkspaceStore;

    fn insert_test_workspace(db: &Db, id: &str, path: &str) {
        WorkspaceStore::new(db.clone())
            .insert(&WorkspaceRecord {
                id: id.to_string(),
                kind: "worktree".to_string(),
                repo_root_id: None,
                path: path.to_string(),
                surface: "standard".to_string(),
                source_repo_root_path: path.to_string(),
                source_workspace_id: None,
                git_provider: None,
                git_owner: None,
                git_repo_name: None,
                original_branch: Some("main".to_string()),
                current_branch: Some("main".to_string()),
                display_name: None,
                origin: None,
                creator_context: None,
                lifecycle_state: "active".to_string(),
                cleanup_state: "none".to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .expect("insert workspace");
    }

    fn test_runtime_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-terminal-service-test-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).expect("create runtime dir");
        path
    }

    #[test]
    fn pty_command_parser_keeps_split_end_marker_pending() {
        let db = Db::open_in_memory().expect("open db");
        insert_test_workspace(&db, "workspace-1", "/tmp/workspace-1");
        let store = TerminalStore::new(db);
        let mut record = new_command_run_record(
            "run-1",
            "workspace-1",
            Some("terminal-1"),
            TerminalPurpose::Run,
            "echo hello",
            TerminalCommandOutputMode::Combined,
        );
        record.status = TerminalCommandRunStatus::Running;
        store.insert_command_run(&record).expect("insert run");

        let mut active = ActivePtyCommand {
            command_run_id: "run-1".to_string(),
            nonce: "nonce".to_string(),
            script_path: PathBuf::from("/tmp/missing-anyharness-test-script"),
            buffer: String::new(),
            capturing: false,
            combined: String::new(),
            output_truncated: false,
            timed_out: false,
            timeout_task: None,
            started_at: Instant::now(),
        };
        let mut completed = None;

        let output = filter_pty_command_output(
            &mut active,
            b"echo wrapper\n__ANYHARNESS_CMD_START_nonce__\nhello\n__ANYHARNESS_CMD_EN",
            &store,
            &mut completed,
        )
        .expect("filter first chunk");

        assert_eq!(String::from_utf8(output).expect("utf8"), "hello\n");
        assert!(completed.is_none());
        assert_eq!(active.buffer, "__ANYHARNESS_CMD_EN");

        let output =
            filter_pty_command_output(&mut active, b"D_nonce_0__\n$ ", &store, &mut completed)
                .expect("filter second chunk");

        assert!(output.is_empty());
        let completed = completed.expect("command completed");
        assert_eq!(completed.status, TerminalCommandRunStatus::Succeeded);
        assert_eq!(completed.combined_output.as_deref(), Some("hello\n"));
    }

    #[tokio::test]
    async fn run_terminal_command_rejects_overlap_without_interrupt() {
        let db = Db::open_in_memory().expect("open db");
        let workspace_path = test_runtime_dir("overlap-workspace");
        let workspace_path_string = workspace_path.to_string_lossy().to_string();
        insert_test_workspace(&db, "workspace-1", &workspace_path_string);
        let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

        let terminal = service
            .create_terminal(
                "workspace-1",
                &workspace_path_string,
                CreateTerminalOptions {
                    cwd: None,
                    shell: Some(detect_posix_shell()),
                    title: Some("Run command".to_string()),
                    purpose: TerminalPurpose::Run,
                    env: Vec::new(),
                    startup_command: None,
                    startup_command_env: Vec::new(),
                    startup_command_timeout_ms: None,
                    cols: 80,
                    rows: 24,
                },
            )
            .await
            .expect("create terminal");

        service
            .run_terminal_command(
                &terminal.id,
                RunTerminalCommandOptions {
                    command: "sleep 2".to_string(),
                    env: Vec::new(),
                    interrupt: false,
                    timeout_ms: None,
                },
            )
            .await
            .expect("start first command");

        let error = service
            .run_terminal_command(
                &terminal.id,
                RunTerminalCommandOptions {
                    command: "echo second".to_string(),
                    env: Vec::new(),
                    interrupt: false,
                    timeout_ms: None,
                },
            )
            .await
            .expect_err("overlapping command rejected");

        assert!(error
            .to_string()
            .contains("terminal command already running"));
        let _ = service.close_terminal(&terminal.id).await;
    }
}
