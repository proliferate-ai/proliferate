use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::AsyncReadExt;
use tokio::sync::RwLock;

use crate::domains::terminals::model::{TerminalCommandRunRecord, TerminalCommandRunStatus};
use crate::domains::terminals::service::{
    append_bounded, complete_command_run, TerminalCommandService,
};

use super::output_sink::TerminalOutputHub;

pub(super) struct ActiveSetupTask {
    pub(super) command_run_id: String,
    pub(super) abort_handle: tokio::task::AbortHandle,
}

pub(super) async fn run_setup_process(
    command_service: TerminalCommandService,
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
                Some(started_at.elapsed().as_millis() as u64),
            );
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
    let _ = command_service.update_command_run(&record);
}
