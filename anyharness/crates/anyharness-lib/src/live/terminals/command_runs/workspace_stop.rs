//! The three workspace-wide stop primitives that live on the terminals
//! plane, split into their own module purely to keep `manager.rs` under the
//! repo's line cap (`scripts/check_max_lines.py`) - see the R3 delivery
//! spec's Scope section F. `TerminalService`'s methods in `manager.rs` are
//! thin delegations into these free functions, which take the same shared
//! registries/services the rest of `command_runs::*` already takes as
//! parameters rather than borrowing `&TerminalService` directly.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use crate::domains::terminals::model::{CreateTerminalOptions, TerminalCommandOutputMode};
use crate::domains::terminals::model::{TerminalCommandRunStatus, TerminalPurpose};
use crate::domains::terminals::service::{new_command_run_record, TerminalCommandService};
use crate::process_kill::{kill_group_and_await, kill_session_and_await, PlaneKills};

use super::super::driver;
use super::super::driver::detect_posix_shell;
use super::super::handle::{PtyHandleRef, TerminalOutputRegistry, TerminalRegistry};
use super::setup_process::{run_setup_process, ActiveSetupTask};

const DEFAULT_SETUP_TIMEOUT: Duration = Duration::from_secs(300);
/// Bound on the non-blocking `try_wait()` poll that reaps a killed PTY's
/// owned child. The group/session escalation in `process_kill` owns the
/// TERM/5s-grace/KILL timing; this only needs to keep polling long enough to
/// notice the exit once the process has actually died so it stops appearing
/// as a live (zombie) pid to the session enumeration.
const PTY_REAP_POLL_BUDGET: Duration = Duration::from_secs(10);
const PTY_REAP_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Close every terminal in `workspace_id`: walks the registry directly
/// (exactly like `TerminalService::list_terminals`) rather than routing
/// through `TerminalHandle::close()`, whose setup-terminal guard would
/// refuse while a sibling `kill_setup_run` under the same parallel quiesce
/// pass has not yet marked the run interrupted. "Closed" means the PTY is
/// dropped and buffers flushed; terminal history is not preserved. Kills by
/// PTY SESSION, not just the shell's own pid, because an interactive shell's
/// job control can leave a `&`-backgrounded pipeline in its own process
/// group. Awaits confirmed death for every terminal before returning; zero
/// counts when the workspace has nothing open.
///
/// The per-terminal kills are driven CONCURRENTLY, not one at a time: each
/// carries its own TERM -> grace -> KILL escalation, so a sequential walk
/// would stack one 5s grace window per open terminal and a two-terminal
/// workspace could never fit R4's 8s `QUIESCE_DEADLINE`. One grace window
/// must cover the whole plane.
pub(in crate::live::terminals) async fn close_all_for_workspace(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    command_service: &TerminalCommandService,
    workspace_id: &str,
) -> anyhow::Result<PlaneKills> {
    let removed = {
        let mut map = terminals.write().await;
        let mut matching_ids = Vec::new();
        for (id, handle) in map.iter() {
            let h = handle.lock().await;
            if h.record.workspace_id == workspace_id {
                matching_ids.push(id.clone());
            }
        }
        matching_ids
            .into_iter()
            .filter_map(|id| map.remove(&id).map(|handle| (id, handle)))
            .collect::<Vec<_>>()
    };

    if removed.is_empty() {
        return Ok(PlaneKills::default());
    }

    {
        let mut hubs = output_hubs.write().await;
        for (id, _) in &removed {
            hubs.remove(id);
        }
    }

    let per_terminal = removed.into_iter().map(|(terminal_id, handle)| async move {
        let pid = {
            let mut h = handle.lock().await;
            if let Some(mut active) = h.active_pty_command.take() {
                if let Some(timeout_task) = active.timeout_task.take() {
                    timeout_task.abort();
                }
                let _ = std::fs::remove_file(&active.script_path);
                if let Err(error) = command_service.mark_command_interrupted(&active.command_run_id)
                {
                    tracing::warn!(
                        terminal_id = %terminal_id,
                        workspace_id = %workspace_id,
                        error = %error,
                        "failed to mark terminal command run interrupted during workspace close"
                    );
                }
            }
            h.child.process_id()
        };

        let Some(pid) = pid else {
            return (0usize, 0usize);
        };
        // The PTY child is already a session leader (portable-pty calls
        // `setsid()` in the child's `pre_exec`), so its own pid IS the
        // session id every job in the shell - including a backgrounded one -
        // shares.
        let sid = pid as i32;
        let (counted, reap_result) =
            tokio::join!(kill_session_and_await(sid), reap_pty_child(handle.clone()));
        if let Err(error) = reap_result {
            tracing::warn!(
                terminal_id = %terminal_id,
                workspace_id = %workspace_id,
                error = %error,
                "failed to reap terminal pty child during workspace close"
            );
        }
        counted
    });

    let mut kills = PlaneKills::default();
    for (total, git) in futures::future::join_all(per_terminal).await {
        kills.total += total;
        kills.git += git;
    }

    Ok(kills)
}

/// Kill whatever setup or archive-script run is active for `workspace_id`
/// and await its confirmed death. Removes the workspace's entry from the
/// in-memory active-run registry, marks the command run interrupted
/// immediately (so `is_setup_running` stops lying the moment this returns,
/// not whenever the killed task eventually notices), and cancels the task
/// that owns the `Child` so it can never overwrite that terminal status with
/// its own completion. The OS-level kill - group TERM, 5s grace, KILL,
/// confirmed - runs independently of the cancelled task, against the pgid
/// the run recorded at spawn time. Zero counts when nothing is running.
pub(in crate::live::terminals) async fn kill_active_run_for_workspace(
    active_setup_tasks: &Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
    command_service: &TerminalCommandService,
    workspace_id: &str,
) -> anyhow::Result<PlaneKills> {
    let Some(active) = active_setup_tasks.lock().await.remove(workspace_id) else {
        return Ok(PlaneKills::default());
    };
    if let Err(error) = command_service.mark_command_interrupted_with_message(
        &active.command_run_id,
        "Run interrupted by workspace stop",
    ) {
        tracing::warn!(
            workspace_id = %workspace_id,
            command_run_id = %active.command_run_id,
            error = %error,
            "failed to mark active run interrupted during workspace stop"
        );
    }
    active.abort_handle.abort();

    let pgid = active.pgid.load(Ordering::SeqCst);
    if pgid <= 0 {
        return Ok(PlaneKills::default());
    }
    let (total, git) = kill_group_and_await(pgid).await;
    Ok(PlaneKills { total, git })
}

/// The archive-script mechanism (R3's await-to-exit mode): reuses
/// `start_setup_command`'s terminal resolution, record creation, output
/// streaming, and the 300s default timeout, but AWAITS the run and returns
/// its exit status instead of returning the record immediately. Records with
/// `TerminalPurpose::Run`, never `Setup`, and never writes
/// `set_latest_setup_run` - the archive script must never become the
/// workspace's durable setup pointer (Contradictions C3). DOES register in
/// `active_setup_tasks`, so `kill_active_run_for_workspace` is the one
/// cancel-and-await path that reaches it. Detach-safe: dropping the returned
/// future (a `select!` loser) still starts the group escalation on a
/// detached task via `ArchiveRunGuard` and never strands the process.
///
/// The terminal the run streams into is CLOSED on every exit path - success,
/// failure, and the dropped-future backstop in `ArchiveRunGuard::drop`. No
/// live PTY (and no blocking PTY-reader thread) may survive an archive of the
/// very workspace it is rooted in.
#[allow(clippy::too_many_arguments)]
pub(in crate::live::terminals) async fn run_blocking_command_for_workspace(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    command_service: &TerminalCommandService,
    active_setup_tasks: &Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
    workspace_id: &str,
    workspace_path: &str,
    command: String,
    env_vars: Vec<(String, String)>,
) -> anyhow::Result<std::process::ExitStatus> {
    run_blocking_command_for_workspace_inner(
        terminals,
        output_hubs,
        command_service,
        active_setup_tasks,
        workspace_id,
        workspace_path,
        command,
        env_vars,
        DEFAULT_SETUP_TIMEOUT,
    )
    .await
}

/// Test-only seam for the spec's "assert the timeout path with an injected
/// short timeout, not by waiting 300 seconds" requirement: identical
/// mechanism to [`run_blocking_command_for_workspace`], parametrized on the
/// timeout so a test can force `run_setup_process`'s internal
/// `sleep_until(deadline)` arm to fire in milliseconds rather than 300s.
/// Never reachable from production code - the real entry point above always
/// hardcodes `DEFAULT_SETUP_TIMEOUT`.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(in crate::live::terminals) async fn run_blocking_command_for_workspace_with_timeout(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    command_service: &TerminalCommandService,
    active_setup_tasks: &Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
    workspace_id: &str,
    workspace_path: &str,
    command: String,
    env_vars: Vec<(String, String)>,
    timeout: Duration,
) -> anyhow::Result<std::process::ExitStatus> {
    run_blocking_command_for_workspace_inner(
        terminals,
        output_hubs,
        command_service,
        active_setup_tasks,
        workspace_id,
        workspace_path,
        command,
        env_vars,
        timeout,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn run_blocking_command_for_workspace_inner(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    command_service: &TerminalCommandService,
    active_setup_tasks: &Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
    workspace_id: &str,
    workspace_path: &str,
    command: String,
    env_vars: Vec<(String, String)>,
    timeout: Duration,
) -> anyhow::Result<std::process::ExitStatus> {
    crate::domains::terminals::service::validate_env_vars(&env_vars, false)?;
    if let Some(active) = active_setup_tasks.lock().await.remove(workspace_id) {
        let _ = command_service.mark_command_interrupted_with_message(
            &active.command_run_id,
            "Superseded by an archive script run",
        );
        active.abort_handle.abort();
    }

    let terminal = driver::create_terminal_shell(
        terminals,
        output_hubs,
        command_service,
        workspace_id,
        workspace_path,
        &CreateTerminalOptions {
            cwd: None,
            shell: Some(detect_posix_shell()),
            title: Some("Archive script".to_string()),
            purpose: TerminalPurpose::Run,
            env: Vec::new(),
            startup_command: None,
            startup_command_env: Vec::new(),
            startup_command_timeout_ms: None,
            cols: 120,
            rows: 40,
        },
    )
    .await?;

    let command_run_id = uuid::Uuid::new_v4().to_string();
    let mut record = new_command_run_record(
        &command_run_id,
        workspace_id,
        Some(&terminal.id),
        TerminalPurpose::Run,
        command.trim(),
        TerminalCommandOutputMode::Separate,
    );
    record.status = TerminalCommandRunStatus::Running;
    record.started_at = Some(chrono::Utc::now().to_rfc3339());
    record.updated_at = record
        .started_at
        .clone()
        .unwrap_or_else(|| record.created_at.clone());
    command_service.insert_command_run(&record)?;
    // Deliberately no `set_latest_setup_run` here - see the function doc.
    {
        let map = terminals.read().await;
        if let Some(handle) = map.get(&terminal.id) {
            let mut h = handle.lock().await;
            h.set_command_run(record.clone());
        }
    }

    let task_command_service = command_service.clone();
    let task_terminals = terminals.clone();
    let task_hubs = output_hubs.clone();
    let task_active_setup_tasks = active_setup_tasks.clone();
    let terminal_id = terminal.id.clone();
    let workspace_id_owned = workspace_id.to_string();
    let workspace_path_owned = workspace_path.to_string();
    let task_record = record.clone();
    let task_workspace_id = workspace_id_owned.clone();
    let task_command_run_id = command_run_id.clone();
    let pgid = Arc::new(AtomicI32::new(0));
    let task_pgid = pgid.clone();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let handle = tokio::spawn(async move {
        let outcome = run_setup_process(
            task_command_service,
            task_terminals,
            task_hubs,
            task_record,
            terminal_id,
            workspace_path_owned,
            command,
            env_vars,
            timeout,
            task_pgid,
        )
        .await;
        {
            let mut tasks = task_active_setup_tasks.lock().await;
            if tasks
                .get(&task_workspace_id)
                .map(|active| active.command_run_id.as_str())
                == Some(task_command_run_id.as_str())
            {
                tasks.remove(&task_workspace_id);
            }
        }
        let _ = done_tx.send(outcome);
    });
    active_setup_tasks.lock().await.insert(
        workspace_id_owned.clone(),
        ActiveSetupTask {
            command_run_id: command_run_id.clone(),
            abort_handle: handle.abort_handle(),
            pgid,
        },
    );

    let mut guard = ArchiveRunGuard {
        workspace_id: workspace_id_owned,
        command_run_id,
        terminal_id: terminal.id.clone(),
        active_setup_tasks: active_setup_tasks.clone(),
        command_service: command_service.clone(),
        terminals: terminals.clone(),
        output_hubs: output_hubs.clone(),
        armed: true,
    };
    let outcome = match done_rx.await {
        Ok(outcome) => {
            guard.disarm();
            outcome
        }
        Err(_) => Err(anyhow::anyhow!(
            "archive script task ended without a result"
        )),
    };
    // Both exit paths, never just the happy one: the archive-script terminal
    // is an interactive PTY created inside the workspace being archived, so
    // leaving it registered would leave a live shell, a blocking PTY-reader
    // thread, and an output hub behind after quiesce already closed
    // everything. `ArchiveRunGuard::drop` repeats this for the caller that
    // walked away before `done_rx` resolved.
    close_archive_terminal(terminals, output_hubs, &terminal.id).await;
    outcome
}

/// Close and deregister the terminal an archive-script run created: drop it
/// from the registry, kill its PTY, and drop its output hub. Mirrors
/// `TerminalHandle::close`'s body minus the setup-terminal guard (an archive
/// terminal is always `TerminalPurpose::Run`) and is idempotent, so the
/// completion path and the `ArchiveRunGuard::drop` backstop can both run it.
async fn close_archive_terminal(
    terminals: &TerminalRegistry,
    output_hubs: &TerminalOutputRegistry,
    terminal_id: &str,
) {
    let removed = terminals.write().await.remove(terminal_id);
    if let Some(handle) = removed {
        let mut h = handle.lock().await;
        h.kill();
    }
    output_hubs.write().await.remove(terminal_id);
}

/// Detach-safety for [`run_blocking_command_for_workspace`]: a `select!`
/// loser dropping that future still cleans up the active run. `armed`
/// starts true and is cleared only once the run completes normally through
/// the channel the spawned task's own cleanup already handles; a
/// still-armed guard being dropped means the caller walked away early, so
/// `Drop` spawns a detached task that does the same interrupt-mark + abort +
/// group-kill-and-await the natural completion path would have done,
/// matching `process_kill`'s own "escalation lives on a detached task,
/// always" rule. It also closes the archive-script terminal, the backstop
/// half of "no live PTY survives an archive".
struct ArchiveRunGuard {
    workspace_id: String,
    command_run_id: String,
    terminal_id: String,
    active_setup_tasks: Arc<Mutex<HashMap<String, ActiveSetupTask>>>,
    command_service: TerminalCommandService,
    terminals: TerminalRegistry,
    output_hubs: TerminalOutputRegistry,
    armed: bool,
}

impl ArchiveRunGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ArchiveRunGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let workspace_id = std::mem::take(&mut self.workspace_id);
        let command_run_id = std::mem::take(&mut self.command_run_id);
        let terminal_id = std::mem::take(&mut self.terminal_id);
        let active_setup_tasks = self.active_setup_tasks.clone();
        let command_service = self.command_service.clone();
        let terminals = self.terminals.clone();
        let output_hubs = self.output_hubs.clone();
        tokio::spawn(async move {
            let active = {
                let mut tasks = active_setup_tasks.lock().await;
                match tasks.get(&workspace_id) {
                    Some(active) if active.command_run_id == command_run_id => {
                        tasks.remove(&workspace_id)
                    }
                    _ => None,
                }
            };
            if let Some(active) = active {
                let _ = command_service.mark_command_interrupted_with_message(
                    &command_run_id,
                    "Archive script run dropped before completion",
                );
                active.abort_handle.abort();
                let pgid = active.pgid.load(Ordering::SeqCst);
                if pgid > 0 {
                    let _ = kill_group_and_await(pgid).await;
                }
            }
            // Unconditional: whether or not the run was still registered, the
            // terminal it created must not outlive the caller that walked
            // away from it.
            close_archive_terminal(&terminals, &output_hubs, &terminal_id).await;
        });
    }
}

/// Reaps a killed PTY's owned child via non-blocking `try_wait()` polling.
/// An owned child the runtime spawned becomes a zombie - still visible to
/// the session enumeration's `getsid` check - until its parent explicitly
/// waits on it; `kill(pid, 0)` succeeding proves nothing here. `try_wait()`
/// never blocks on the process itself, so this never stalls the runtime the
/// way a raw `wait()` call would.
async fn reap_pty_child(handle: PtyHandleRef) -> anyhow::Result<()> {
    let deadline = tokio::time::Instant::now() + PTY_REAP_POLL_BUDGET;
    loop {
        {
            let mut h = handle.lock().await;
            match h.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Err(error) => return Err(anyhow::anyhow!("failed to reap pty child: {error}")),
                Ok(None) => {}
            }
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("pty child did not exit within the reap poll budget");
        }
        tokio::time::sleep(PTY_REAP_POLL_INTERVAL).await;
    }
}
