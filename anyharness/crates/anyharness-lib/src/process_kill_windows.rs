//! The Windows half of [`crate::process_kill`]: the Toolhelp enumeration, the
//! creation-time read, and the terminate/confirm escalation. The bookkeeping
//! those feed lives in `process_kill_tree.rs`, which has no FFI in it so that
//! it can be tested on every platform.
//!
//! Windows has neither process groups nor sessions in the POSIX sense, so
//! there is no id a caller could hand us that names a set of processes. What
//! every caller of [`super::kill_group_and_await`] and
//! [`super::kill_session_and_await`] actually passes on Windows is the direct
//! child's own pid: the session actor passes `self.child.id()`
//! (`live/sessions/actor/run.rs`), the setup/archive runs pass the pid they
//! stored at spawn (`live/terminals/command_runs/setup_process.rs`), and the
//! terminal close path passes the PTY child's `process_id()`
//! (`live/terminals/command_runs/workspace_stop.rs`). The `process_group(0)`
//! calls at those spawn sites are all `#[cfg(unix)]`, so on Windows the
//! integer is only ever a plain pid. This module therefore reads it as the
//! ROOT of a process tree and reaches the descendants by walking
//! `th32ParentProcessID`.
//!
//! Three Windows facts shape this, and all three are behavioral differences
//! from unix rather than implementation detail:
//!
//! 1. There is no portable graceful signal. `TerminateProcess` is
//!    unconditional, so it is the equivalent of `SIGKILL`, not `SIGTERM`. A
//!    graceful first rung would need `GenerateConsoleCtrlEvent`, which only
//!    works against a group created with `CREATE_NEW_PROCESS_GROUP` at spawn
//!    and only for console processes sharing our console. No spawn site sets
//!    that today, so the ladder starts at the unconditional rung. `GRACE` is
//!    still honored as the deadline for the OS to finish tearing the tree
//!    down before survivors are retried.
//!
//! 2. **The kill is not atomic against a growing tree, and unix's is.**
//!    `kill(-pgid)` signals a group, so a child created between the unix
//!    enumeration and the signal is already a group member and still gets
//!    hit. Here the pass acts on a pid list read from a snapshot, so a
//!    descendant born after that snapshot is missed by THAT pass and is
//!    picked up by the next confirmation pass, up to `CONFIRM_POLL` later.
//!    The tracker is what makes the next pass able to see it. The census
//!    returned to the caller is still the one taken before the first pass, so
//!    a tree that grew mid-kill is under-reported even though it is killed.
//!
//! 3. **A pid is not an identity.** Windows does not re-parent orphans; a
//!    dead process leaves its children's `th32ParentProcessID` pointing at a
//!    freed number that the kernel will hand to someone else. Every pid this
//!    module acts on is therefore checked against its creation time, and an
//!    adoption that cannot be proven is refused. This is the one place where
//!    the safe failure is to under-kill rather than over-kill.

use std::collections::HashMap;
use std::time::Duration;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_BAD_LENGTH, FILETIME, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, GetProcessTimes, OpenProcess, TerminateProcess,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};

use super::tree::{census, executable_name, Generation, ProcessEntry, TreeTracker};
use super::{CONFIRM_BUDGET, CONFIRM_POLL, GRACE};

/// `CreateToolhelp32Snapshot` and `Process32FirstW` fail transiently under
/// process-table churn - `ERROR_BAD_LENGTH` is documented as retryable - and
/// a failed enumeration here would report a live tree dead, so it is retried
/// before it is believed.
const SNAPSHOT_ATTEMPTS: u32 = 5;
const SNAPSHOT_RETRY_PAUSE: Duration = Duration::from_millis(10);

/// The exit code a terminated member reports. Nonzero so a caller reading the
/// child's status cannot mistake a kill for a clean exit.
const KILL_EXIT_CODE: u32 = 1;

/// Every live process on the system, or `None` when the enumeration failed
/// every attempt. The distinction is the whole point: an empty `Vec` means
/// "nothing is running", and folding a failed enumeration into that is
/// exactly the silent lie this module exists to remove.
fn snapshot_processes() -> Option<Vec<ProcessEntry>> {
    for attempt in 1..=SNAPSHOT_ATTEMPTS {
        match try_snapshot_processes() {
            Ok(entries) => return Some(entries),
            Err(code) => {
                if attempt == SNAPSHOT_ATTEMPTS {
                    tracing::error!(
                        error_code = code,
                        attempts = SNAPSHOT_ATTEMPTS,
                        retryable = code == ERROR_BAD_LENGTH,
                        "process_kill: the Windows process enumeration failed every attempt"
                    );
                    return None;
                }
                // Bounded, and only on the failure path: at most
                // (SNAPSHOT_ATTEMPTS - 1) * SNAPSHOT_RETRY_PAUSE.
                std::thread::sleep(SNAPSHOT_RETRY_PAUSE);
            }
        }
    }
    None
}

/// One enumeration attempt. `Err` carries `GetLastError` so the caller can
/// tell a retryable `ERROR_BAD_LENGTH` from a real failure.
fn try_snapshot_processes() -> Result<Vec<ProcessEntry>, u32> {
    // SAFETY: a kernel32 read of the running process table. The handle is
    // checked against both failure encodings before use and closed on every
    // exit path below.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(GetLastError());
        }
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        // The enumeration START can fail too. Reading that as an empty table
        // would drop the whole tree and report a live tree dead.
        if Process32FirstW(handle, &mut entry) == 0 {
            let code = GetLastError();
            let _ = CloseHandle(handle);
            return Err(code);
        }
        let mut entries = Vec::new();
        loop {
            entries.push(ProcessEntry {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                exe: executable_name(&entry.szExeFile),
            });
            if Process32NextW(handle, &mut entry) == 0 {
                break;
            }
        }
        let _ = CloseHandle(handle);
        Ok(entries)
    }
}

/// A process's creation time, or `None` when it cannot be read (the process
/// is gone, or is not ours to open). Callers must treat `None` as "cannot
/// prove this pid's identity" and refuse to act on it.
fn process_creation_time(pid: u32) -> Option<Generation> {
    if pid == 0 {
        return None;
    }
    // SAFETY: `OpenProcess` validates the pid and returns NULL on failure;
    // the handle is closed on the one path that obtains it. The four
    // `FILETIME` out-params are live locals for the duration of the call.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut created = FILETIME::default();
        let mut exited = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let ok = GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user);
        let _ = CloseHandle(handle);
        if ok == 0 {
            return None;
        }
        Some(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
    }
}

/// One enumeration pass folded into `tracker`. `None` means the enumeration
/// failed, which is NOT the same as an empty tree.
fn refresh(tracker: &mut TreeTracker) -> Option<Vec<ProcessEntry>> {
    let snapshot = snapshot_processes()?;
    // Creation times cost an `OpenProcess` each, so they are resolved only
    // for the pids that need proving and memoized within the pass.
    let mut memo: HashMap<u32, Option<Generation>> = HashMap::new();
    let mut created_at = |pid: u32| -> Option<Generation> {
        *memo
            .entry(pid)
            .or_insert_with(|| process_creation_time(pid))
    };
    Some(tracker.absorb(&snapshot, &mut created_at))
}

/// Terminate one pid. A handle we cannot open means the process is already
/// gone or is not ours to kill; neither is actionable here, exactly as the
/// unix path ignores a failed `kill`.
fn terminate(pid: u32) {
    if pid == 0 {
        return;
    }
    // SAFETY: `OpenProcess` validates the pid itself and returns NULL on
    // failure; the handle is closed on the one path that obtains it.
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return;
        }
        let _ = TerminateProcess(handle, KILL_EXIT_CODE);
        let _ = CloseHandle(handle);
    }
}

/// Deepest-first, so a parent shell outlives the children it would otherwise
/// be able to notice dying. `entries` arrives root-first from the tracker.
fn terminate_pass(entries: &[ProcessEntry]) {
    for entry in entries.iter().rev() {
        terminate(entry.pid);
    }
}

/// Polls the tracker until it reports nothing alive or `budget` elapses,
/// returning `true` when the tree emptied inside the budget. The unix
/// counterpart's early exit is the whole reason `GRACE` is a deadline rather
/// than a fixed cost: a tree that dies immediately must not burn the window a
/// plane holding several targets needs to fit R4's 8s `QUIESCE_DEADLINE`.
///
/// A failed enumeration is retried and never read as "empty" - reading it as
/// empty would reintroduce the false quiescence this module removes.
async fn wait_until_empty_within(tracker: &mut TreeTracker, budget: Duration, root: u32) -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        match refresh(tracker) {
            Some(remaining) if remaining.is_empty() => return true,
            Some(_) => {}
            None => tracing::warn!(
                root,
                "process_kill: a confirmation enumeration failed; the tree may still be alive"
            ),
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(CONFIRM_POLL).await;
    }
}

/// Kill the process tree rooted at `root` and await its confirmed death.
///
/// Returns the `(total, git)` census taken over the tree BEFORE anything is
/// terminated, `(0, 0)` means nothing was running, and the escalation runs on
/// a DETACHED task so a dropped or timed-out caller future can never strand a
/// half-killed tree - all as on unix. `GRACE` is a deadline, not a fixed
/// cost. See this module's header for the two places the Windows contract is
/// genuinely WEAKER than unix's: the pass is not atomic against a tree that
/// grows mid-kill, and an adoption whose identity cannot be proven is
/// refused.
///
/// The one thing it cannot report through this signature is an enumeration
/// failure, so a failed enumeration is retried and then logged at ERROR
/// rather than folded into the `(0, 0)` that means success.
pub async fn kill_tree_and_await(root: i32) -> (usize, usize) {
    if root <= 0 {
        return (0, 0);
    }
    let root = root as u32;
    // SAFETY: a parameterless kernel32 read of our own pid.
    let self_pid = unsafe { GetCurrentProcessId() };
    if root == self_pid {
        tracing::error!(
            root,
            "process_kill: refusing to kill the runtime's own process tree"
        );
        return (0, 0);
    }

    // Read the root's identity BEFORE anything is killed. Without it no
    // adoption can be proven and the kill degrades to the root alone.
    let root_generation = process_creation_time(root);
    if root_generation.is_none() {
        tracing::warn!(
            root,
            "process_kill: could not read the root's creation time; descendants cannot be \
             proven and will NOT be killed"
        );
    }

    let mut tracker = TreeTracker::new(root, root_generation, self_pid);
    let Some(initial) = refresh(&mut tracker) else {
        tracing::error!(
            root,
            "process_kill: the Windows process enumeration failed; the tree was NOT killed"
        );
        return (0, 0);
    };
    let counted = census(&initial);
    if counted.0 == 0 {
        return counted;
    }
    terminate_pass(&initial);

    let escalation = tokio::spawn(async move {
        if wait_until_empty_within(&mut tracker, GRACE, root).await {
            return;
        }
        let deadline = tokio::time::Instant::now() + CONFIRM_BUDGET;
        loop {
            let Some(remaining) = refresh(&mut tracker) else {
                tracing::warn!(
                    root,
                    "process_kill: a confirmation enumeration failed; the tree may still be alive"
                );
                if tokio::time::Instant::now() >= deadline {
                    return;
                }
                tokio::time::sleep(CONFIRM_POLL).await;
                continue;
            };
            if remaining.is_empty() {
                return;
            }
            // Survivors past the grace deadline are either processes the first
            // pass could not open or descendants started since it ran, so this
            // re-enumerates and re-terminates every iteration rather than
            // terminating once - the same reason the unix session loop
            // re-signals every distinct group on every pass.
            terminate_pass(&remaining);
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!(
                    root,
                    remaining = remaining.len(),
                    "process_kill: confirmation budget exceeded; tree may still be alive"
                );
                return;
            }
            tokio::time::sleep(CONFIRM_POLL).await;
        }
    });
    let _ = escalation.await;
    counted
}
