use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::sync::RwLock;

use crate::domains::terminals::model::ShellKind;
use crate::domains::terminals::model::{TerminalCommandRunRecord, TerminalCommandRunStatus};
use crate::domains::terminals::service::{
    append_bounded, complete_command_run, TerminalCommandService,
};
use crate::process_kill::kill_group_and_await;

use super::super::handle::TerminalRegistry;
use super::super::output_sink::TerminalOutputHub;
use super::stream_format::{terminal_command_preface, workspace_prompt, TerminalStreamFormatter};

pub(in crate::live::terminals) struct ActiveSetupTask {
    pub(in crate::live::terminals) command_run_id: String,
    pub(in crate::live::terminals) abort_handle: tokio::task::AbortHandle,
    /// The spawned command's process-group id (set once `run_setup_process`
    /// spawns successfully; `process_group(0)` makes the child its own group
    /// leader, so the pid IS the pgid). Zero means "not yet known" - lets a
    /// killer that never owned the `Child` (`kill_active_run_for_workspace`)
    /// still signal the whole group and await confirmed death.
    pub(in crate::live::terminals) pgid: Arc<AtomicI32>,
}

/// Runs a managed shell command to completion (or the timeout), streaming
/// its output into the terminal's hub exactly as before. Used by BOTH the
/// start-and-poll setup surface (`start_setup_command` spawns this in a
/// background task and returns immediately) and the new await-to-exit mode
/// (`run_blocking_command_for_workspace` awaits the background task's
/// completion channel instead) - one spawner, two callers, per the ADR's
/// "the archive script is exactly one more managed run under that
/// mechanism". Returns the process's exit status; `Err` only when the
/// process never ran (spawn failure) or its wait() genuinely errored.
pub(in crate::live::terminals) async fn run_setup_process(
    command_service: TerminalCommandService,
    terminals: TerminalRegistry,
    hubs: Arc<RwLock<HashMap<String, TerminalOutputHub>>>,
    mut record: TerminalCommandRunRecord,
    terminal_id: String,
    workspace_path: String,
    command: String,
    env_vars: Vec<(String, String)>,
    timeout: Duration,
    pgid: Arc<AtomicI32>,
) -> anyhow::Result<std::process::ExitStatus> {
    let started_at = Instant::now();
    let hub = hubs.read().await.get(&terminal_id).cloned();
    let mut terminal_formatter = TerminalStreamFormatter::default();
    emit_setup_output(
        hub.as_ref(),
        &mut terminal_formatter,
        terminal_command_preface(&workspace_path, &workspace_path, ShellKind::Bash, &command),
        None,
        &record.id,
    )
    .await;

    // The setup command is a user-authored string that may use pipes, `&&`,
    // globs and variable expansion, so it genuinely needs a shell. Which shell,
    // and how the string is quoted into it, is the host's business rather than
    // this module's.
    let mut cmd = crate::host_shell::command_string_shell(&command);
    cmd.current_dir(&workspace_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    // Its own process group, so a timeout or an external kill (a killer that
    // never owned this `Child`, e.g. `kill_active_run_for_workspace`) can
    // reach the whole tree - the package manager, compiler, dev server -
    // with one group signal instead of leaving every grandchild running.
    #[cfg(unix)]
    cmd.process_group(0);
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let stderr = format!("failed to spawn setup command: {error}");
            complete_command_run(
                &mut record,
                TerminalCommandRunStatus::Failed,
                Some(-1),
                Some(String::new()),
                Some(stderr.clone()),
                None,
                false,
                Some(started_at.elapsed().as_millis() as u64),
            );
            emit_setup_output(
                hub.as_ref(),
                &mut terminal_formatter,
                format!("{stderr}\n").into_bytes(),
                Some("stderr"),
                &record.id,
            )
            .await;
            emit_setup_prompt(
                hub.as_ref(),
                &mut terminal_formatter,
                &record.id,
                &workspace_path,
            )
            .await;
            set_terminal_output_suppressed(&terminals, &terminal_id, false).await;
            let _ = command_service.update_command_run(&record);
            return Err(anyhow::anyhow!("failed to spawn setup command: {error}"));
        }
    };
    if let Some(pid) = child.id() {
        pgid.store(pid as i32, Ordering::SeqCst);
    }

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

    let deadline = tokio::time::Instant::now() + timeout;
    let mut stdout_capture = String::new();
    let mut stderr_capture = String::new();
    let mut output_truncated = false;
    let status: Option<std::process::ExitStatus>;
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
                    emit_setup_output(
                        hub.as_ref(),
                        &mut terminal_formatter,
                        data,
                        Some(stream),
                        &record.id,
                    )
                    .await;
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
                    emit_setup_output(
                        hub.as_ref(),
                        &mut terminal_formatter,
                        data,
                        Some(stream),
                        &record.id,
                    )
                    .await;
                }
                break;
            }
            _ = tokio::time::sleep_until(deadline) => {
                timed_out = true;
                let target_pgid = pgid.load(Ordering::SeqCst);
                if target_pgid > 0 {
                    // Group TERM -> 5s grace -> KILL, joined with our own
                    // reap so an owned zombie never blocks the escalation's
                    // confirmation loop.
                    let (_, wait_result) =
                        tokio::join!(kill_group_and_await(target_pgid), child.wait());
                    status = wait_result.ok();
                } else {
                    let _ = child.start_kill();
                    status = child.wait().await.ok();
                }
                while let Some((stream, data)) = rx.recv().await {
                    if stream == "stdout" {
                        append_bounded(&mut stdout_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    } else {
                        append_bounded(&mut stderr_capture, &String::from_utf8_lossy(&data), &mut output_truncated);
                    }
                    emit_setup_output(
                        hub.as_ref(),
                        &mut terminal_formatter,
                        data,
                        Some(stream),
                        &record.id,
                    )
                    .await;
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
            Some(started_at.elapsed().as_millis() as u64),
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
            Some(started_at.elapsed().as_millis() as u64),
        );
    }
    emit_setup_prompt(
        hub.as_ref(),
        &mut terminal_formatter,
        &record.id,
        &workspace_path,
    )
    .await;
    set_terminal_output_suppressed(&terminals, &terminal_id, false).await;
    let _ = command_service.update_command_run(&record);
    status.ok_or_else(|| anyhow::anyhow!("setup process wait failed"))
}

pub(in crate::live::terminals) async fn set_terminal_output_suppressed(
    terminals: &TerminalRegistry,
    terminal_id: &str,
    suppress_output: bool,
) {
    let handle = {
        let map = terminals.read().await;
        map.get(terminal_id).cloned()
    };
    if let Some(handle) = handle {
        let mut h = handle.lock().await;
        h.suppress_output = suppress_output;
    }
}

async fn emit_setup_output(
    hub: Option<&TerminalOutputHub>,
    formatter: &mut TerminalStreamFormatter,
    data: Vec<u8>,
    stream: Option<&'static str>,
    command_run_id: &str,
) {
    if let Some(hub) = hub {
        let data = formatter.normalize(data);
        let _ = hub
            .emit_data(data, stream, Some(command_run_id.to_string()))
            .await;
    }
}

async fn emit_setup_prompt(
    hub: Option<&TerminalOutputHub>,
    formatter: &mut TerminalStreamFormatter,
    command_run_id: &str,
    workspace_path: &str,
) {
    if let Some(hub) = hub {
        let data = formatter.normalize_prompt(workspace_prompt(
            workspace_path,
            workspace_path,
            ShellKind::Bash,
        ));
        let _ = hub
            .emit_data(data, None, Some(command_run_id.to_string()))
            .await;
    }
}
