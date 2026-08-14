use std::path::PathBuf;
use std::sync::Arc;

use super::*;
use crate::domains::terminals::model::{CreateTerminalOptions, TerminalPurpose};
use crate::domains::workspaces::model::{
    WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord,
    WorkspaceSurface,
};
use crate::domains::workspaces::store::WorkspaceStore;
use crate::persistence::Db;

fn insert_test_workspace(db: &Db, id: &str, path: &str) {
    let repo_root_id = format!("repo-root-{id}");
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO repo_roots (
                id, kind, path, display_name, default_branch, remote_provider, remote_owner,
                remote_repo_name, remote_url, created_at, updated_at
             ) VALUES (?1, 'external', ?2, NULL, 'main', NULL, NULL, NULL, NULL, ?3, ?3)",
            [&repo_root_id, path, "2026-01-01T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("seed repo root");
    WorkspaceStore::new(db.clone())
        .insert(&WorkspaceRecord {
            id: id.to_string(),
            kind: WorkspaceKind::Worktree,
            repo_root_id,
            path: path.to_string(),
            surface: WorkspaceSurface::Standard,
            original_branch: Some("main".to_string()),
            current_branch: Some("main".to_string()),
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: WorkspaceLifecycleState::Active,
            archived_head_sha: None,
            archived_branch: None,
            archived_at: None,
            partial_capture_json: None,
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
                shell: Some(super::super::driver::detect_posix_shell()),
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

/// Polls `path` for a pid written by a shell's `echo $! > path`. Real
/// processes fork asynchronously from the test's point of view, so this is
/// the deterministic replacement for a fixed sleep.
async fn wait_for_pidfile(path: &std::path::Path) -> i32 {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Ok(contents) = std::fs::read_to_string(path) {
            if let Ok(pid) = contents.trim().parse::<i32>() {
                return pid;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("pidfile {path:?} was not written within the wait budget");
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// Polls until `pid` is genuinely gone, up to a short budget.
///
/// `pid_is_alive` is `kill(pid, 0)`, which still succeeds for a ZOMBIE - a
/// process that has exited but whose parent has not reaped it yet. The kill
/// primitives resolve on the pid-table ENUMERATION instead, which drops a pid
/// slightly earlier, so a caller that checks `pid_is_alive` the instant
/// `close_all_for_workspace`/`kill_active_run_for_workspace` returns can
/// still see a grandchild mid-reap by its reparented init. That window used
/// to be hidden by the escalation's unconditional 5s sleep; now that the
/// grace is an early-exiting DEADLINE (FIX-R3-a) it is observable, and under
/// machine load it is wide enough to make an instantaneous assertion flaky.
///
/// This still fails the pre-R3 behavior it exists to catch: a grandchild the
/// kill never reaches stays alive indefinitely, not for a reap latency.
async fn wait_for_pid_death(pid: i32) -> bool {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if !crate::process_kill::pid_is_alive(pid) {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn close_all_for_workspace_returns_zero_kills_for_a_workspace_with_nothing_open() {
    let db = Db::open_in_memory().expect("open db");
    insert_test_workspace(&db, "workspace-empty", "/tmp/workspace-empty");
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let kills = service
        .close_all_for_workspace("workspace-empty")
        .await
        .expect("close_all_for_workspace must not error against an empty workspace");

    assert_eq!(kills.total, 0);
    assert_eq!(kills.git, 0);
}

/// `close_all_for_workspace` must kill a `&`-backgrounded job that an
/// interactive PTY shell's job control put in its OWN process group,
/// distinct from the shell's - exactly the case a plain shell-pid kill (the
/// pre-R3 `PtyHandle::kill()`) misses. Drives the REAL `TerminalService`
/// stack (a real PTY, real `write_input`), not the shared mechanism in
/// isolation (that is `process_kill_tests.rs`'s job).
#[tokio::test]
async fn close_all_for_workspace_kills_a_backgrounded_job_in_an_interactive_pty_shell() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("pty-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-pty", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let terminal = service
        .create_terminal(
            "workspace-pty",
            &workspace_path_string,
            CreateTerminalOptions {
                cwd: None,
                shell: Some(super::super::driver::detect_posix_shell()),
                title: Some("Interactive".to_string()),
                purpose: TerminalPurpose::Run,
                env: Vec::new(),
                startup_command: None,
                startup_command_env: Vec::new(),
                startup_command_timeout_ms: None,
                cols: 120,
                rows: 40,
            },
        )
        .await
        .expect("create terminal");

    let pidfile = workspace_path.join("job.pid");
    let handle = service
        .lookup_terminal(&terminal.id)
        .await
        .expect("lookup the terminal we just created");
    handle
        .write_input(format!("sleep 300 & echo $! > {}\n", pidfile.display()).as_bytes())
        .await
        .expect("write into the interactive shell");

    let job_pid = wait_for_pidfile(&pidfile).await;
    assert!(
        crate::process_kill::pid_is_alive(job_pid),
        "the backgrounded job must be running before the close"
    );

    let kills = service
        .close_all_for_workspace("workspace-pty")
        .await
        .expect("close_all_for_workspace");

    assert!(
        kills.total >= 2,
        "the shell and its backgrounded job must both be counted, got {kills:?}"
    );
    assert!(
        wait_for_pid_death(job_pid).await,
        "the backgrounded job must die with the session, not survive alongside the closed shell"
    );
    assert!(
        service.list_terminals("workspace-pty").await.is_empty(),
        "the terminal must be gone from the registry after the close"
    );
    // No early-exit timing assertion here on purpose: an INTERACTIVE shell
    // ignores SIGTERM, so this terminal legitimately rides out the full 5s
    // grace and dies by the KILL. The grace-is-a-deadline property is pinned
    // where the target actually honors the TERM, in
    // `process_kill_tests::kill_group_and_await_returns_as_soon_as_a_term_respecting_group_is_dead`.
}

/// The terminals-plane fan-out contract, the concrete case the R3 review's
/// blocker names: a workspace with several open terminals must fit R4's 8s
/// `QUIESCE_DEADLINE`. Every shell here traps TERM, so every one of them
/// really does ride out the full 5s grace and die by SIGKILL - the whole
/// point being that those three grace windows must OVERLAP. Negative control:
/// walk `removed` sequentially again (one awaited `kill_session_and_await`
/// per terminal) and this costs ~15s instead of ~5s.
#[tokio::test]
async fn close_all_for_workspace_kills_several_terminals_within_one_grace_window() {
    const TERMINALS: usize = 3;

    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("pty-fanout-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-fanout", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let mut marker_files = Vec::new();
    for index in 0..TERMINALS {
        let terminal = service
            .create_terminal(
                "workspace-fanout",
                &workspace_path_string,
                CreateTerminalOptions {
                    cwd: None,
                    shell: Some(super::super::driver::detect_posix_shell()),
                    title: Some(format!("Interactive {index}")),
                    purpose: TerminalPurpose::Run,
                    env: Vec::new(),
                    startup_command: None,
                    startup_command_env: Vec::new(),
                    startup_command_timeout_ms: None,
                    cols: 120,
                    rows: 40,
                },
            )
            .await
            .expect("create terminal");

        // The shell itself traps TERM and then hangs, so this terminal's
        // session can only be emptied by the KILL half of the escalation
        // after the full grace. The marker file proves the trap is installed
        // before the close races it.
        let marker = workspace_path.join(format!("ready-{index}"));
        let handle = service
            .lookup_terminal(&terminal.id)
            .await
            .expect("lookup the terminal we just created");
        handle
            .write_input(
                format!(
                    "trap '' TERM; touch {} ; sleep 300\n",
                    marker.display()
                )
                .as_bytes(),
            )
            .await
            .expect("write into the interactive shell");
        marker_files.push(marker);
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    for marker in &marker_files {
        while !marker.exists() {
            assert!(
                tokio::time::Instant::now() < deadline,
                "every shell must have installed its TERM trap before the close"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }
    assert_eq!(service.list_terminals("workspace-fanout").await.len(), TERMINALS);

    let started = tokio::time::Instant::now();
    let kills = service
        .close_all_for_workspace("workspace-fanout")
        .await
        .expect("close_all_for_workspace");
    let elapsed = started.elapsed();

    assert!(
        kills.total >= TERMINALS,
        "every terminal's session must be counted, got {kills:?}"
    );
    assert!(
        service.list_terminals("workspace-fanout").await.is_empty(),
        "every terminal must be gone from the registry after the close"
    );
    assert!(
        elapsed >= Duration::from_secs(5),
        "the TERM-trapping shells really must have ridden out the grace - \
         otherwise this test is not measuring overlapping grace windows: {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(8),
        "{TERMINALS} terminals must share ONE 5s grace window and fit R4's 8s \
         QUIESCE_DEADLINE, not stack one window each: {elapsed:?}"
    );
}

#[tokio::test]
async fn kill_active_run_for_workspace_returns_zero_kills_when_nothing_is_active() {
    let db = Db::open_in_memory().expect("open db");
    insert_test_workspace(&db, "workspace-empty", "/tmp/workspace-empty");
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let kills = service
        .kill_active_run_for_workspace("workspace-empty")
        .await
        .expect("kill_active_run_for_workspace must not error with nothing active");

    assert_eq!(kills.total, 0);
    assert_eq!(kills.git, 0);
}

/// The setup-plane half of R3's "archive-during-running-setup" case: a
/// setup run is live (with a grandchild that outlives the direct `/bin/sh`
/// child, the exact shape the ADR names for `setup_process.rs:46-52`
/// pre-R3), the kill reaches and awaits both, marks the command run
/// terminal, and `is_setup_running` reads false afterward - all through
/// `kill_active_run_for_workspace`, the mechanism `WorkspaceSetupRuntime::
/// kill_setup_run` delegates to verbatim.
#[tokio::test]
async fn kill_active_run_for_workspace_kills_a_running_setup_script_and_its_grandchild() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("setup-kill-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-setup", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let pidfile = workspace_path.join("grandchild.pid");
    let record = service
        .start_setup_command(
            "workspace-setup",
            &workspace_path_string,
            format!("sleep 300 & echo $! > {} ; wait", pidfile.display()),
            Vec::new(),
            Some(60_000),
        )
        .await
        .expect("start setup command");

    let grandchild_pid = wait_for_pidfile(&pidfile).await;
    assert!(
        crate::process_kill::pid_is_alive(grandchild_pid),
        "the setup script's grandchild must be running before the kill"
    );
    assert!(
        service.is_setup_running("workspace-setup").await,
        "is_setup_running must read true while the run is active"
    );

    let kills = service
        .kill_active_run_for_workspace("workspace-setup")
        .await
        .expect("kill_active_run_for_workspace");

    assert!(
        kills.total >= 2,
        "the setup script and its grandchild must both be counted, got {kills:?}"
    );
    assert!(
        wait_for_pid_death(grandchild_pid).await,
        "the grandchild must die with the group - a kill that only reaches \
         the direct child leaves this alive (today's pre-R3 behavior)"
    );
    assert!(
        !service.is_setup_running("workspace-setup").await,
        "is_setup_running must read false once the run is marked interrupted"
    );

    let stored = service
        .get_command_run(&record.id)
        .expect("load command run")
        .expect("command run exists");
    assert_eq!(
        stored.status,
        TerminalCommandRunStatus::Interrupted,
        "a killed setup run must read a terminal status, not still Running"
    );

    // `kill_active_run_for_workspace` only kills the SCRIPT; the setup
    // terminal it streamed into (a real PTY, independent of the plain-child
    // script process per the ADR) is untouched by design and would leave a
    // blocking PTY-reader thread running forever, hanging this test's
    // `#[tokio::test]` runtime at shutdown - close it explicitly, exactly as
    // every other PTY-creating test in this file does.
    if let Some(terminal_id) = &record.terminal_id {
        let _ = service.close_terminal(terminal_id).await;
    }
}

/// No live PTY may survive an archive: the terminal `run_archive_script`
/// creates inside the workspace it is archiving must be closed and
/// deregistered on BOTH outcomes - a clean exit and a failing one. Negative
/// control: drop the `close_archive_terminal` call from
/// `run_blocking_command_for_workspace_inner` and both halves fail (and the
/// leaked PTY-reader threads hang this test's runtime at shutdown, which is
/// exactly the production symptom).
#[tokio::test]
async fn run_blocking_command_for_workspace_closes_its_terminal_on_success_and_on_failure() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("archive-script-close-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-archive-close", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let ok = service
        .run_blocking_command_for_workspace(
            "workspace-archive-close",
            &workspace_path_string,
            "exit 0".to_string(),
            Vec::new(),
        )
        .await
        .expect("run_blocking_command_for_workspace");
    assert!(ok.success());
    assert!(
        service
            .list_terminals("workspace-archive-close")
            .await
            .is_empty(),
        "a successful archive script must leave no live terminal behind"
    );

    let failed = service
        .run_blocking_command_for_workspace(
            "workspace-archive-close",
            &workspace_path_string,
            "exit 3".to_string(),
            Vec::new(),
        )
        .await
        .expect("run_blocking_command_for_workspace");
    assert!(!failed.success());
    assert!(
        service
            .list_terminals("workspace-archive-close")
            .await
            .is_empty(),
        "a FAILING archive script must leave no live terminal behind either"
    );
}

/// R3's await-to-exit mode: a normal exit returns its status, and - the C3
/// guard - the run never becomes the workspace's durable setup pointer
/// (`latest_setup_run` stays `None`) and `is_setup_running` never reads true
/// for it, because it is recorded with `TerminalPurpose::Run`, not `Setup`.
#[tokio::test]
async fn run_blocking_command_for_workspace_returns_exit_status_and_never_becomes_the_setup_run() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("archive-script-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-archive", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let status = service
        .run_blocking_command_for_workspace(
            "workspace-archive",
            &workspace_path_string,
            "exit 0".to_string(),
            Vec::new(),
        )
        .await
        .expect("run_blocking_command_for_workspace");

    assert!(status.success());
    assert!(
        service
            .latest_setup_run("workspace-archive")
            .expect("latest_setup_run")
            .is_none(),
        "the archive script must never become the workspace's durable setup pointer"
    );
    assert!(
        !service.is_setup_running("workspace-archive").await,
        "is_setup_running must never read true for an archive-script run"
    );
    assert!(
        service.list_terminals("workspace-archive").await.is_empty(),
        "the archive-script terminal must already be closed when the run returns"
    );
}

/// Detach safety: dropping the `run_blocking_command_for_workspace` future
/// (the `select!`/`timeout` loser) must still kill the process - the
/// `ArchiveRunGuard`'s `Drop` runs the same interrupt-mark + group-kill path
/// the natural completion path would have run.
#[tokio::test]
async fn run_blocking_command_for_workspace_dropped_future_leaves_no_surviving_process() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("archive-script-drop-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-archive-drop", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let pidfile = workspace_path.join("archive.pid");
    let run_future = service.run_blocking_command_for_workspace(
        "workspace-archive-drop",
        &workspace_path_string,
        format!("echo $$ > {} ; sleep 300", pidfile.display()),
        Vec::new(),
    );

    // The caller (e.g. archive's `select!` against a cancellation token)
    // walks away early - the timeout here stands in for that loser branch.
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), run_future).await;

    let script_pid = wait_for_pidfile(&pidfile).await;
    // `ArchiveRunGuard::drop` spawns a detached task; give it a moment to
    // run the group kill and confirm death, mirroring how a real caller
    // never blocks on the guard's own cleanup.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        if !crate::process_kill::pid_is_alive(script_pid) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the dropped future must not strand the archive script process"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    // `ArchiveRunGuard::drop` is also the backstop for the terminal: a caller
    // that walks away must not leave the archive-script PTY registered
    // either. Same detached task, so poll rather than assert instantly.
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        if service
            .list_terminals("workspace-archive-drop")
            .await
            .is_empty()
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the dropped future must not strand the archive-script terminal either"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// The second composable half the cancellation contract owes R4:
/// `kill_active_run_for_workspace` (`kill_setup_run`'s mechanism) reaches a
/// RUNNING archive script - not just a setup run - and resolves only once
/// the script process is confirmed dead.
#[tokio::test]
async fn kill_active_run_for_workspace_reaches_a_running_archive_script() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("archive-script-kill-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-archive-kill", &workspace_path_string);
    let service = Arc::new(TerminalService::new(
        TerminalStore::new(db),
        test_runtime_dir("runtime"),
    ));

    let pidfile = workspace_path.join("archive.pid");
    let command = format!("echo $$ > {} ; sleep 300", pidfile.display());
    let task_service = service.clone();
    let task_workspace_path = workspace_path_string.clone();
    let run_task = tokio::spawn(async move {
        task_service
            .run_blocking_command_for_workspace(
                "workspace-archive-kill",
                &task_workspace_path,
                command,
                Vec::new(),
            )
            .await
    });

    let script_pid = wait_for_pidfile(&pidfile).await;
    assert!(crate::process_kill::pid_is_alive(script_pid));

    let kills = service
        .kill_active_run_for_workspace("workspace-archive-kill")
        .await
        .expect("kill_active_run_for_workspace against a running archive script");

    assert!(
        kills.total >= 1,
        "the archive script must be counted, got {kills:?}"
    );
    assert!(
        !crate::process_kill::pid_is_alive(script_pid),
        "kill_active_run_for_workspace must not return until the archive \
         script is confirmed dead"
    );

    // The original caller's future resolves too (its task was aborted, so
    // it errors rather than hanging forever) - the cancel-and-await path
    // never strands the awaiting caller either.
    let _ = run_task.await;

    // The ERROR path of `run_blocking_command_for_workspace_inner` (the
    // spawned run task ended without a result) must close the archive-script
    // terminal just like the success path.
    assert!(
        service
            .list_terminals("workspace-archive-kill")
            .await
            .is_empty(),
        "a killed archive script must not leave its terminal registered"
    );
}

/// The third `run_archive_script` cancellation case the spec's Tests section
/// names explicitly: "a script that outruns the 300s cap is killed and the
/// caller proceeds - assert the timeout path with an injected short timeout,
/// not by waiting 300 seconds." Uses the test-only
/// `run_blocking_command_for_workspace_with_timeout` seam to force
/// `run_setup_process`'s internal `sleep_until(deadline)` arm to fire on its
/// own in milliseconds, rather than driving an external
/// `kill_active_run_for_workspace` call against it. The script traps TERM so
/// the only way it can die is the deadline's own group escalation actually
/// firing.
#[tokio::test]
async fn run_blocking_command_for_workspace_honors_an_injected_short_timeout_and_kills_the_run() {
    let db = Db::open_in_memory().expect("open db");
    let workspace_path = test_runtime_dir("archive-script-timeout-workspace");
    let workspace_path_string = workspace_path.to_string_lossy().to_string();
    insert_test_workspace(&db, "workspace-archive-timeout", &workspace_path_string);
    let service = TerminalService::new(TerminalStore::new(db), test_runtime_dir("runtime"));

    let pidfile = workspace_path.join("archive-timeout.pid");
    let command = format!("trap '' TERM; echo $$ > {} ; sleep 300", pidfile.display());

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        service.run_blocking_command_for_workspace_with_timeout(
            "workspace-archive-timeout",
            &workspace_path_string,
            command,
            Vec::new(),
            std::time::Duration::from_millis(200),
        ),
    )
    .await
    .expect(
        "an injected 200ms timeout must make the caller proceed well within \
         15s, not hang for the 300s default",
    )
    .expect("run_blocking_command_for_workspace_with_timeout");

    assert!(
        !result.success(),
        "a run killed by the timeout escalation must not report success"
    );

    let script_pid = wait_for_pidfile(&pidfile).await;
    assert!(
        !crate::process_kill::pid_is_alive(script_pid),
        "the TERM-ignoring script must be dead once the call returns - the \
         deadline's own SIGKILL escalation must have fired"
    );

    assert!(
        service
            .latest_setup_run("workspace-archive-timeout")
            .expect("latest_setup_run")
            .is_none(),
        "a timed-out archive script must still never become the \
         workspace's durable setup pointer"
    );
    assert!(
        !service.is_setup_running("workspace-archive-timeout").await,
        "is_setup_running must read false once the timed-out run completes"
    );
    assert!(
        service
            .list_terminals("workspace-archive-timeout")
            .await
            .is_empty(),
        "a timed-out archive script must not leave its terminal registered"
    );
}
