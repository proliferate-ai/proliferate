use std::io::Read as IoRead;
use std::path::Path;
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::Mutex;

use crate::domains::terminals::model::{
    CreateTerminalOptions, TerminalCommandOutputMode, TerminalCommandRunStatus, TerminalPurpose,
    TerminalRecord, TerminalStatus,
};
use crate::domains::terminals::service::{
    complete_command_run, new_command_run_record, TerminalCommandService,
};
use crate::process_env::remove_runtime_private_pty_env;

use super::handle::{PtyHandle, TerminalOutputRegistry, TerminalRegistry};
use super::output_sink::TerminalOutputHub;
use super::pty_command::process_pty_output;
use super::shell::{
    configure_compact_prompt, detect_default_shell, detect_posix_shell, detect_shell_kind,
};

pub(super) async fn create_terminal_shell(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    command_service: &TerminalCommandService,
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
    remove_runtime_private_pty_env(&mut cmd);

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
        workspace_path: workspace_path.to_string(),
        _shell_path: shell,
        shell_kind,
        master,
        writer,
        child,
        active_pty_command: None,
    };

    {
        let mut map = terminals.write().await;
        map.insert(terminal_id.clone(), Arc::new(Mutex::new(handle)));
    }
    {
        let mut hubs = output_hubs.write().await;
        hubs.insert(terminal_id.clone(), hub.clone());
    }

    let terminals_ref = terminals.clone();
    let command_service = command_service.clone();
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
                        &command_service,
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
                if let Some(mut active) = h.active_pty_command.take() {
                    if let Some(timeout_task) = active.timeout_task.take() {
                        timeout_task.abort();
                    }
                    let _ = std::fs::remove_file(&active.script_path);
                    let mut record = command_service
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
                        Some(active.started_at.elapsed().as_millis() as u64),
                    );
                    let _ = command_service.update_command_run(&record);
                }
                h.mark_exited();
            }
        });
    });

    Ok(record)
}
