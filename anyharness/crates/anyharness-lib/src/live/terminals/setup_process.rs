use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::sync::RwLock;

use crate::domains::terminals::model::ShellKind;
use crate::domains::terminals::model::{TerminalCommandRunRecord, TerminalCommandRunStatus};
use crate::domains::terminals::service::{
    append_bounded, complete_command_run, TerminalCommandService,
};

use super::handle::TerminalRegistry;
use super::output_sink::TerminalOutputHub;
use super::stream_format::{terminal_command_preface, workspace_prompt, TerminalStreamFormatter};

pub(super) struct ActiveSetupTask {
    pub(super) command_run_id: String,
    pub(super) abort_handle: tokio::task::AbortHandle,
}

pub(super) async fn run_setup_process(
    command_service: TerminalCommandService,
    terminals: TerminalRegistry,
    hubs: Arc<RwLock<HashMap<String, TerminalOutputHub>>>,
    mut record: TerminalCommandRunRecord,
    terminal_id: String,
    workspace_path: String,
    command: String,
    env_vars: Vec<(String, String)>,
    timeout: Duration,
) {
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

    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-lc")
        .arg(&command)
        .current_dir(&workspace_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
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
                let _ = child.start_kill();
                let _ = child.wait().await;
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
}

pub(super) async fn set_terminal_output_suppressed(
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
