use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::domains::terminals::model::{
    RunTerminalCommandOptions, TerminalCommandOutputMode, TerminalCommandRunRecord,
    TerminalCommandRunStatus, TerminalPurpose,
};
use crate::domains::terminals::service::{
    append_bounded, complete_command_run, new_command_run_record, validate_env_vars,
    TerminalCommandService,
};

use super::handle::TerminalRegistry;
use super::output_sink::TerminalOutputHub;

pub(super) struct ActivePtyCommand {
    pub(super) command_run_id: String,
    nonce: String,
    pub(super) script_path: PathBuf,
    buffer: String,
    capturing: bool,
    pub(super) combined: String,
    pub(super) output_truncated: bool,
    timed_out: bool,
    pub(super) timeout_task: Option<tokio::task::AbortHandle>,
    pub(super) started_at: Instant,
}

pub(super) async fn run_terminal_command(
    terminals: &TerminalRegistry,
    command_service: &TerminalCommandService,
    runtime_home: &Path,
    terminal_id: &str,
    request: RunTerminalCommandOptions,
) -> anyhow::Result<TerminalCommandRunRecord> {
    let handle = {
        let map = terminals.read().await;
        map.get(terminal_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("terminal not found"))?
    };

    let mut h = handle.lock().await;
    if !h.shell_kind.is_posix() {
        anyhow::bail!("unsupported_terminal_shell");
    }
    if h.record.purpose == TerminalPurpose::Setup
        && command_service.is_setup_running(&h.record.workspace_id)
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
            command_service.mark_command_interrupted(&active.command_run_id)?;
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
    command_service.insert_command_run(&record)?;

    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let script = write_command_script(runtime_home, &command, &request.env)?;
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
            terminals.clone(),
            command_service.clone(),
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

pub(super) async fn process_pty_output(
    terminals: &TerminalRegistry,
    command_service: &TerminalCommandService,
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
            output = filter_pty_command_output(active, &data, command_service, &mut completed)?;
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
        command_service.update_command_run(&record)?;
    }
    hub.emit_data(output, None, command_run_id).await?;
    Ok(())
}

fn filter_pty_command_output(
    active: &mut ActivePtyCommand,
    data: &[u8],
    command_service: &TerminalCommandService,
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
                let mut record = command_service
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
                    Some(active.started_at.elapsed().as_millis() as u64),
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
    terminals: TerminalRegistry,
    command_service: TerminalCommandService,
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
        let mut record = match command_service.get_command_run(&command_run_id) {
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
            Some(active.started_at.elapsed().as_millis() as u64),
        );
        h.record.command_run = Some(record.clone());
        Some(record)
    };

    if let Some(record) = completed {
        let _ = command_service.update_command_run(&record);
    }
}

fn write_command_script(
    runtime_home: &Path,
    command: &str,
    env: &[(String, String)],
) -> anyhow::Result<PathBuf> {
    let dir = runtime_home.join("tmp").join("terminal-command-runs");
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

fn build_pty_command_wrapper(nonce: &str, script: &Path) -> String {
    let script = shell_quote(&script.to_string_lossy());
    format!(
        "anyharness_prefix='__ANYHARNESS_CMD_'; anyharness_nonce='{nonce}'; printf '%s\\n' \"${{anyharness_prefix}}START_${{anyharness_nonce}}__\"; . {script}; anyharness_code=$?; printf '%s\\n' \"${{anyharness_prefix}}END_${{anyharness_nonce}}_${{anyharness_code}}__\"\n"
    )
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::terminals::model::{TerminalCommandOutputMode, TerminalPurpose};
    use crate::domains::terminals::store::TerminalStore;
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
                cleanup_operation: None,
                cleanup_error_message: None,
                cleanup_failed_at: None,
                cleanup_attempted_at: None,
                created_at: "2026-01-01T00:00:00Z".to_string(),
                updated_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .expect("insert workspace");
    }

    #[test]
    fn pty_command_parser_keeps_split_end_marker_pending() {
        let db = Db::open_in_memory().expect("open db");
        insert_test_workspace(&db, "workspace-1", "/tmp/workspace-1");
        let command_service = TerminalCommandService::new(TerminalStore::new(db));
        let mut record = new_command_run_record(
            "run-1",
            "workspace-1",
            Some("terminal-1"),
            TerminalPurpose::Run,
            "echo hello",
            TerminalCommandOutputMode::Combined,
        );
        record.status = TerminalCommandRunStatus::Running;
        command_service
            .insert_command_run(&record)
            .expect("insert run");

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
            &command_service,
            &mut completed,
        )
        .expect("filter first chunk");

        assert_eq!(String::from_utf8(output).expect("utf8"), "hello\n");
        assert!(completed.is_none());
        assert_eq!(active.buffer, "__ANYHARNESS_CMD_EN");

        let output = filter_pty_command_output(
            &mut active,
            b"D_nonce_0__\n$ ",
            &command_service,
            &mut completed,
        )
        .expect("filter second chunk");

        assert!(output.is_empty());
        let completed = completed.expect("command completed");
        assert_eq!(completed.status, TerminalCommandRunStatus::Succeeded);
        assert_eq!(completed.combined_output.as_deref(), Some("hello\n"));
    }
}
