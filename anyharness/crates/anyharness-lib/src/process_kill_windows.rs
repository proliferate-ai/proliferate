//! The Windows half of [`crate::process_kill`]: a descendant-tree walk over a
//! Toolhelp snapshot, standing in for the unix process-group and session
//! enumeration.
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
//! `th32ParentProcessID` - the same two-phase "enumerate the whole target,
//! census it, then act on it" structure the unix path uses, with
//! `CreateToolhelp32Snapshot` in the place of libproc and `/proc`.
//!
//! Two Windows facts shape the escalation, and both are behavioral
//! differences from unix that callers should know about:
//!
//! 1. There is no portable graceful signal. `TerminateProcess` is
//!    unconditional, so it is the equivalent of `SIGKILL`, not `SIGTERM`. A
//!    graceful first rung would need `GenerateConsoleCtrlEvent`, which only
//!    works against a group created with `CREATE_NEW_PROCESS_GROUP` at spawn
//!    and only for console processes sharing our console. No spawn site sets
//!    that today, so the TERM rung is not available and the ladder starts at
//!    the unconditional rung. `GRACE` is still honored as the deadline for
//!    the OS to finish tearing the tree down before survivors are retried.
//!
//! 2. Windows does not re-parent orphans; `th32ParentProcessID` simply keeps
//!    pointing at a pid that no longer exists and may be recycled. Killing
//!    the root first would therefore make its surviving children unreachable
//!    on the next enumeration pass. [`TreeTracker`] fixes that by REMEMBERING
//!    the tree across passes rather than re-deriving it from the root each
//!    time, and terminating deepest-first so the parent outlives its children.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_TERMINATE,
};

use super::{CONFIRM_BUDGET, CONFIRM_POLL, GRACE};

/// Cap on the parent-chain walk that orders a pass deepest-first. A snapshot
/// whose parent links form a cycle (only reachable through pid reuse) must
/// not spin forever.
const DEPTH_LIMIT: u32 = 64;

/// The exit code a terminated member reports. Nonzero so a caller reading the
/// child's status cannot mistake a kill for a clean exit.
const KILL_EXIT_CODE: u32 = 1;

/// One row of a Toolhelp process snapshot. The base executable name comes
/// back in the same read as the parent link, so unlike the unix path the
/// `git` census costs no extra per-pid syscall.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProcessEntry {
    pub(super) pid: u32,
    pub(super) parent: u32,
    pub(super) exe: String,
}

/// Every live process on the system, or `None` when the snapshot itself
/// failed. The distinction is the whole point: an empty `Vec` means "nothing
/// is running", and folding a failed enumeration into that is exactly the
/// silent lie this module exists to remove.
fn snapshot_processes() -> Option<Vec<ProcessEntry>> {
    // SAFETY: a kernel32 read of the running process table. The handle is
    // checked against both failure encodings before use and closed on every
    // exit path below.
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: `entry` is a live, correctly sized `PROCESSENTRY32W`; `dwSize`
    // is set as `Process32FirstW` requires.
    let mut have_entry = unsafe { Process32FirstW(handle, &mut entry) } != 0;
    let mut entries = Vec::new();
    while have_entry {
        entries.push(ProcessEntry {
            pid: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            exe: executable_name(&entry.szExeFile),
        });
        // SAFETY: same live `entry`; the snapshot handle stays valid until the
        // `CloseHandle` below.
        have_entry = unsafe { Process32NextW(handle, &mut entry) } != 0;
    }
    // SAFETY: `handle` came from `CreateToolhelp32Snapshot` and is not used
    // after this point.
    unsafe {
        let _ = CloseHandle(handle);
    }
    Some(entries)
}

/// `szExeFile` is a fixed 260-wide buffer holding a NUL-terminated base name;
/// decoding the whole array would append the padding.
pub(super) fn executable_name(raw: &[u16; 260]) -> String {
    let end = raw.iter().position(|&unit| unit == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

/// Whether a snapshot's base name is `git`. Windows file names are
/// case-insensitive and the executable carries an extension, so the unix
/// path's exact `"git"` comparison would count zero every time and quietly
/// change `repair_kill_debris`'s refusal behavior (it aborts a conflict
/// sentinel only when `killed_git > 0`).
pub(super) fn is_git_executable(name: &str) -> bool {
    let lowered = name.to_ascii_lowercase();
    lowered == "git.exe" || lowered == "git"
}

/// The `(total, git)` census over an already-enumerated pass, taken BEFORE
/// anything is signaled for the same reason the unix path does it: counting
/// afterwards undercounts exactly the processes that died fastest.
pub(super) fn census(entries: &[ProcessEntry]) -> (usize, usize) {
    let git = entries
        .iter()
        .filter(|entry| is_git_executable(&entry.exe))
        .count();
    (entries.len(), git)
}

/// The set of pids belonging to one target tree, carried ACROSS enumeration
/// passes.
///
/// Re-deriving the tree from the root every pass would lose every survivor
/// the moment the root died, because Windows leaves an orphan's
/// `th32ParentProcessID` pointing at the freed pid instead of re-parenting
/// it. Remembering the set instead is also what makes re-signaling safe: a
/// tracked pid that disappears from a snapshot is RETIRED and never trusted
/// again, so if Windows recycles that number for an unrelated process we
/// neither terminate it nor adopt its children.
pub(super) struct TreeTracker {
    tracked: HashSet<u32>,
    retired: HashSet<u32>,
    self_pid: u32,
}

impl TreeTracker {
    pub(super) fn new(root: u32, self_pid: u32) -> Self {
        let mut tracked = HashSet::new();
        tracked.insert(root);
        Self {
            tracked,
            retired: HashSet::new(),
            self_pid,
        }
    }

    /// Take a fresh snapshot and fold it in. `None` means the snapshot
    /// failed, which is NOT the same as an empty tree.
    fn refresh(&mut self) -> Option<Vec<ProcessEntry>> {
        let snapshot = snapshot_processes()?;
        Some(self.absorb(&snapshot))
    }

    /// The pure half of [`Self::refresh`]: retire what vanished, adopt any
    /// new descendant of a still-tracked member, and return the tracked
    /// processes this snapshot still lists, ordered root-first.
    pub(super) fn absorb(&mut self, snapshot: &[ProcessEntry]) -> Vec<ProcessEntry> {
        let live: HashSet<u32> = snapshot.iter().map(|entry| entry.pid).collect();
        let vanished: Vec<u32> = self
            .tracked
            .iter()
            .copied()
            .filter(|pid| !live.contains(pid))
            .collect();
        for pid in vanished {
            self.tracked.remove(&pid);
            self.retired.insert(pid);
        }

        // Grow to a fixpoint rather than in one sweep: a snapshot may list a
        // grandchild before the child that adopts it into the set.
        loop {
            let mut grew = false;
            for entry in snapshot {
                // pid 0 is the idle process and is every unparented row's
                // "parent"; letting it into the set would sweep the machine.
                if entry.pid == 0 || entry.pid == self.self_pid {
                    continue;
                }
                if entry.parent == entry.pid || self.retired.contains(&entry.pid) {
                    continue;
                }
                if self.tracked.contains(&entry.parent) && self.tracked.insert(entry.pid) {
                    grew = true;
                }
            }
            if !grew {
                break;
            }
        }

        let parents: HashMap<u32, u32> = snapshot
            .iter()
            .map(|entry| (entry.pid, entry.parent))
            .collect();
        let mut alive: Vec<ProcessEntry> = snapshot
            .iter()
            .filter(|entry| self.tracked.contains(&entry.pid))
            .cloned()
            .collect();
        alive.sort_by_key(|entry| (self.depth_of(entry.pid, &parents), entry.pid));
        alive
    }

    /// Hops from `pid` up to the shallowest tracked ancestor. Used only to
    /// order a pass; an unresolvable chain simply sorts shallow.
    fn depth_of(&self, pid: u32, parents: &HashMap<u32, u32>) -> u32 {
        let mut depth = 0;
        let mut cursor = pid;
        for _ in 0..DEPTH_LIMIT {
            let Some(&parent) = parents.get(&cursor) else {
                return depth;
            };
            if parent == cursor || !self.tracked.contains(&parent) {
                return depth;
            }
            depth += 1;
            cursor = parent;
        }
        depth
    }
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
/// be able to notice dying. `entries` arrives root-first from
/// [`TreeTracker::absorb`].
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
/// A failed snapshot is logged and retried, never read as "empty" - reading
/// it as empty would reintroduce the false quiescence this module removes.
async fn wait_until_empty_within(tracker: &mut TreeTracker, budget: Duration, root: u32) -> bool {
    let deadline = tokio::time::Instant::now() + budget;
    loop {
        match tracker.refresh() {
            Some(remaining) if remaining.is_empty() => return true,
            Some(_) => {}
            None => tracing::warn!(
                root,
                "process_kill: a confirmation snapshot failed; the tree may still be alive"
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
/// Contract-identical to the unix [`super::kill_group_and_await`]: returns
/// the `(total, git)` census taken over the tree BEFORE anything is
/// terminated, `(0, 0)` means nothing was running, the escalation runs on a
/// DETACHED task so a dropped or timed-out caller future can never strand a
/// half-killed tree, and `GRACE` is a deadline rather than a fixed cost so a
/// tree that dies immediately resolves the call in milliseconds.
///
/// The one thing it cannot report through this signature is an enumeration
/// failure, so a failed snapshot is logged at ERROR rather than folded into
/// the `(0, 0)` that means success.
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

    let mut tracker = TreeTracker::new(root, self_pid);
    let Some(initial) = tracker.refresh() else {
        tracing::error!(
            root,
            "process_kill: the Windows process snapshot failed; the tree was NOT killed"
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
            let Some(remaining) = tracker.refresh() else {
                tracing::warn!(
                    root,
                    "process_kill: a confirmation snapshot failed; the tree may still be alive"
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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(pid: u32, parent: u32, exe: &str) -> ProcessEntry {
        ProcessEntry {
            pid,
            parent,
            exe: exe.to_string(),
        }
    }

    #[test]
    fn executable_name_stops_at_the_nul_terminator() {
        let mut raw = [0u16; 260];
        for (slot, unit) in raw.iter_mut().zip("git.exe".encode_utf16()) {
            *slot = unit;
        }
        assert_eq!(executable_name(&raw), "git.exe");
    }

    #[test]
    fn git_census_matches_the_windows_executable_name() {
        // The unix path compares against a bare "git"; on Windows that would
        // count zero forever and silently change archive's refusal behavior.
        assert!(is_git_executable("git.exe"));
        assert!(is_git_executable("GIT.EXE"));
        assert!(!is_git_executable("gitk.exe"));
        assert!(!is_git_executable("legit.exe"));
    }

    #[test]
    fn absorb_collects_the_whole_descendant_tree() {
        let snapshot = vec![
            entry(1, 0, "System.exe"),
            entry(400, 1, "unrelated.exe"),
            entry(100, 1, "agent.exe"),
            entry(300, 200, "git.exe"),
            entry(200, 100, "cmd.exe"),
        ];
        let mut tracker = TreeTracker::new(100, 9999);
        let alive = tracker.absorb(&snapshot);
        let pids: Vec<u32> = alive.iter().map(|entry| entry.pid).collect();
        // Root first, then each generation: the pass is terminated in
        // reverse, so the grandchild dies before the shell that owns it.
        assert_eq!(pids, vec![100, 200, 300]);
        assert_eq!(census(&alive), (3, 1));
    }

    #[test]
    fn absorb_never_adopts_the_runtimes_own_process() {
        let snapshot = vec![
            entry(100, 1, "agent.exe"),
            entry(9999, 100, "anyharness.exe"),
        ];
        let mut tracker = TreeTracker::new(100, 9999);
        let pids: Vec<u32> = tracker
            .absorb(&snapshot)
            .iter()
            .map(|entry| entry.pid)
            .collect();
        assert_eq!(pids, vec![100]);
    }

    #[test]
    fn a_retired_pid_is_never_readopted_when_windows_recycles_it() {
        let mut tracker = TreeTracker::new(100, 9999);
        tracker.absorb(&[entry(100, 1, "agent.exe"), entry(200, 100, "cmd.exe")]);
        // The whole tree dies.
        assert!(tracker.absorb(&[entry(1, 0, "System.exe")]).is_empty());
        // Windows hands pid 200 to something unrelated, which spawns a child.
        let recycled = vec![
            entry(1, 0, "System.exe"),
            entry(200, 1, "notepad.exe"),
            entry(201, 200, "innocent.exe"),
        ];
        assert!(tracker.absorb(&recycled).is_empty());
    }

    #[test]
    fn absorb_adopts_descendants_started_after_the_first_pass() {
        let mut tracker = TreeTracker::new(100, 9999);
        tracker.absorb(&[entry(100, 1, "agent.exe")]);
        let later = vec![
            entry(100, 1, "agent.exe"),
            entry(250, 240, "git.exe"),
            entry(240, 100, "sh.exe"),
        ];
        let pids: Vec<u32> = tracker.absorb(&later).iter().map(|e| e.pid).collect();
        assert_eq!(pids, vec![100, 240, 250]);
    }

    #[test]
    fn absorb_terminates_on_a_parent_cycle() {
        // Only reachable through pid reuse, but a cycle must not hang the
        // ordering walk.
        let snapshot = vec![
            entry(100, 1, "agent.exe"),
            entry(200, 100, "a.exe"),
            entry(210, 220, "b.exe"),
            entry(220, 210, "c.exe"),
        ];
        let mut tracker = TreeTracker::new(100, 9999);
        let pids: Vec<u32> = tracker.absorb(&snapshot).iter().map(|e| e.pid).collect();
        assert_eq!(pids, vec![100, 200]);
    }
}
