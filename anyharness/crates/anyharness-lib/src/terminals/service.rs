use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read as IoRead, Write as IoWrite};
use std::path::Path;
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{broadcast, Mutex, RwLock};

use super::model::{CreateTerminalOptions, ResizeTerminalOptions, TerminalRecord, TerminalStatus};

struct PtyHandle {
    record: TerminalRecord,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn IoWrite + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Debug, Clone)]
pub enum TerminalOutputEvent {
    Data(Vec<u8>),
    Exit { code: Option<i32> },
}

pub struct TerminalService {
    terminals: Arc<RwLock<HashMap<String, Arc<Mutex<PtyHandle>>>>>,
    output_channels: Arc<RwLock<HashMap<String, broadcast::Sender<TerminalOutputEvent>>>>,
}

impl TerminalService {
    pub fn new() -> Self {
        Self {
            terminals: Arc::new(RwLock::new(HashMap::new())),
            output_channels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn list_terminals(&self, workspace_id: &str) -> Vec<TerminalRecord> {
        let map = self.terminals.read().await;
        let mut results = Vec::new();
        for handle in map.values() {
            let h = handle.lock().await;
            if h.record.workspace_id == workspace_id {
                results.push(h.record.clone());
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
                results.push(h.record.clone());
            }
        }
        results.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        results
    }

    pub async fn get_terminal(&self, terminal_id: &str) -> Option<TerminalRecord> {
        let map = self.terminals.read().await;
        if let Some(handle) = map.get(terminal_id) {
            let h = handle.lock().await;
            Some(h.record.clone())
        } else {
            None
        }
    }

    pub async fn create_terminal(
        &self,
        workspace_id: &str,
        workspace_path: &str,
        request: CreateTerminalOptions,
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
                let p = std::path::Path::new(workspace_path).join(c);
                p.to_string_lossy().to_string()
            })
            .unwrap_or_else(|| workspace_path.to_string());

        let cwd_path = std::path::Path::new(&cwd);
        if !cwd_path.starts_with(workspace_path) {
            anyhow::bail!("cwd must be within the workspace boundary");
        }

        let shell = request.shell.unwrap_or_else(|| detect_default_shell());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");

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
            title: format!("Terminal"),
            cwd: cwd.clone(),
            status: TerminalStatus::Running,
            exit_code: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let (output_tx, _) = broadcast::channel(256);

        let handle = PtyHandle {
            record: record.clone(),
            master,
            writer,
            child,
        };

        {
            let mut map = self.terminals.write().await;
            map.insert(terminal_id.clone(), Arc::new(Mutex::new(handle)));
        }
        {
            let mut channels = self.output_channels.write().await;
            channels.insert(terminal_id.clone(), output_tx.clone());
        }

        let terminals_ref = self.terminals.clone();
        let tid = terminal_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = output_tx.send(TerminalOutputEvent::Exit { code: None });
                        break;
                    }
                    Ok(n) => {
                        let _ = output_tx.send(TerminalOutputEvent::Data(buf[..n].to_vec()));
                    }
                    Err(_) => {
                        let _ = output_tx.send(TerminalOutputEvent::Exit { code: None });
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
                    h.record.status = TerminalStatus::Exited;
                    h.record.exit_code = code;
                    h.record.updated_at = chrono::Utc::now().to_rfc3339();
                }
            });
        });

        Ok(record)
    }

    pub async fn write_input(&self, terminal_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let map = self.terminals.read().await;
        let handle = map
            .get(terminal_id)
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?;
        let mut h = handle.lock().await;
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
        Ok(h.record.clone())
    }

    pub async fn close_terminal(&self, terminal_id: &str) -> anyhow::Result<()> {
        let handle = {
            let mut map = self.terminals.write().await;
            map.remove(terminal_id)
        };
        if let Some(handle) = handle {
            let mut h = handle.lock().await;
            let _ = h.child.kill();
        }
        {
            let mut channels = self.output_channels.write().await;
            channels.remove(terminal_id);
        }
        Ok(())
    }

    pub fn close_terminal_blocking(&self, terminal_id: &str) -> anyhow::Result<()> {
        tokio::runtime::Handle::current().block_on(self.close_terminal(terminal_id))
    }

    pub async fn subscribe_output(
        &self,
        terminal_id: &str,
    ) -> Option<broadcast::Receiver<TerminalOutputEvent>> {
        let channels = self.output_channels.read().await;
        channels.get(terminal_id).map(broadcast::Sender::subscribe)
    }
}

fn detect_default_shell() -> String {
    let shell_env = std::env::var("SHELL").ok();
    let path_env = std::env::var_os("PATH");
    detect_default_shell_with_env(shell_env.as_deref(), path_env.as_deref())
}

fn detect_default_shell_with_env(shell_env: Option<&str>, path_env: Option<&OsStr>) -> String {
    let mut candidates: Vec<&str> = Vec::new();

    if let Some(shell) = shell_env.filter(|value| !value.trim().is_empty()) {
        candidates.push(shell);
    }

    for fallback in ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"] {
        if !candidates.contains(&fallback) {
            candidates.push(fallback);
        }
    }

    for candidate in candidates {
        if is_executable_command(candidate, path_env) {
            return candidate.to_string();
        }
    }

    "/bin/sh".to_string()
}

fn is_executable_command(command: &str, path_env: Option<&OsStr>) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return false;
    }

    if command.contains(std::path::MAIN_SEPARATOR) {
        return is_executable_path(Path::new(command));
    }

    if let Some(path_env) = path_env {
        for dir in std::env::split_paths(path_env) {
            if is_executable_path(&dir.join(command)) {
                return true;
            }
        }
    }

    false
}

fn is_executable_path(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use tokio::time::{timeout, Duration};

    use super::{CreateTerminalOptions, TerminalOutputEvent, TerminalService};

    async fn read_until_contains(
        rx: &mut tokio::sync::broadcast::Receiver<TerminalOutputEvent>,
        needle: &str,
    ) -> anyhow::Result<String> {
        let mut output = String::new();
        let deadline = Duration::from_secs(5);

        while !output.contains(needle) {
            let event = timeout(deadline, rx.recv()).await??;
            match event {
                TerminalOutputEvent::Data(data) => {
                    output.push_str(&String::from_utf8_lossy(&data));
                }
                TerminalOutputEvent::Exit { .. } => break,
            }
        }

        Ok(output)
    }

    #[tokio::test]
    async fn terminal_output_can_be_resubscribed() -> anyhow::Result<()> {
        let service = TerminalService::new();
        let workspace_path = std::env::current_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string());

        let record = service
            .create_terminal(
                "workspace-1",
                &workspace_path,
                CreateTerminalOptions {
                    cols: 80,
                    rows: 24,
                    cwd: Some("".to_string()),
                    shell: Some("/bin/sh".to_string()),
                },
            )
            .await?;

        let mut first_rx = service
            .subscribe_output(&record.id)
            .await
            .ok_or_else(|| anyhow::anyhow!("missing first receiver"))?;
        service
            .write_input(&record.id, b"echo first-pass\n")
            .await?;
        let first = read_until_contains(&mut first_rx, "first-pass").await?;
        assert!(first.contains("first-pass"));

        let mut second_rx = service
            .subscribe_output(&record.id)
            .await
            .ok_or_else(|| anyhow::anyhow!("missing second receiver"))?;
        service
            .write_input(&record.id, b"echo second-pass\n")
            .await?;
        let second = read_until_contains(&mut second_rx, "second-pass").await?;
        assert!(second.contains("second-pass"));

        service.close_terminal(&record.id).await?;
        let _ = PathBuf::from(workspace_path);
        Ok(())
    }

    #[test]
    fn detect_default_shell_avoids_nonexistent_zsh_fallback() {
        let shell = super::detect_default_shell_with_env(None, None);
        assert_ne!(shell, "/bin/zsh");
        assert!(matches!(
            shell.as_str(),
            "/bin/bash" | "/usr/bin/bash" | "/bin/sh" | "/usr/bin/sh"
        ));
    }

    #[test]
    fn detect_default_shell_skips_missing_shell_env() {
        let shell = super::detect_default_shell_with_env(Some("/definitely/missing-shell"), None);
        assert_ne!(shell, "/definitely/missing-shell");
        assert!(matches!(
            shell.as_str(),
            "/bin/bash" | "/usr/bin/bash" | "/bin/sh" | "/usr/bin/sh"
        ));
    }
}
