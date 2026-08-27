//! Crate-root home for the shared pid-enumeration and kill-escalation
//! mechanism every live-plane stop primitive builds on: sessions'
//! `stop_all_for_workspace`, terminals' `close_all_for_workspace`, and
//! setup's `kill_setup_run` (`domains/workspaces/setup_runtime.rs`).
//!
//! Placement note: this lives at the crate root, beside `process_env`,
//! rather than under `domains::sessions::runtime` (the ADR's literal comment
//! header) so that `live::terminals::manager` and
//! `domains::workspaces::setup_runtime` can both name [`PlaneKills`] without
//! either adding a `crate::live::..` occurrence governed by the
//! `DOMAIN_LIVE_VALVE` boundary rule. See the R3 delivery spec's
//! Contradictions C4.
//!
//! The enumeration is genuinely one implementation per platform - macOS via
//! libproc, Linux via `/proc`, Windows via a `CreateToolhelp32Snapshot`
//! parent-link walk in `process_kill_windows.rs` - behind one `#[cfg]`, and
//! on every platform the escalation runs on a detached task so a dropped or
//! timed-out caller future can never strand a half-killed target between the
//! first signal and the last.
//!
//! What a caller passes differs by platform and the two functions below name
//! the unix concepts because that is where the distinction is real. Windows
//! has neither process groups nor sessions, and every call site derives its
//! integer from a direct child's pid (`process_group(0)` at the spawn sites is
//! `#[cfg(unix)]`), so both entry points collapse to one descendant-tree kill
//! rooted at that pid. The CONTRACT is identical on both platforms: the
//! returned `(total, git)` is the census taken before anything is signaled,
//! `(0, 0)` means nothing was running, and the call resolves only once the
//! target is confirmed dead or the confirmation budget is spent. Two places
//! where Windows is genuinely weaker, both documented in
//! `process_kill_windows.rs`: the kill is not atomic against a tree that
//! grows mid-kill (unix's `kill(-pgid)` is), and an adoption whose identity
//! cannot be proven is refused rather than guessed at.

use std::time::Duration;

/// The census every stop primitive returns: total processes reaped, and how
/// many of those were `git`. The split is real evidence, not telemetry -
/// R2's `repair_kill_debris` aborts a conflict sentinel only when
/// `killed_git > 0`, so a plane that folds a lazy zero into `git` silently
/// changes archive's refusal behavior.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PlaneKills {
    pub total: usize,
    pub git: usize,
}

const GRACE: Duration = Duration::from_secs(5);
const CONFIRM_POLL: Duration = Duration::from_millis(50);
const CONFIRM_BUDGET: Duration = Duration::from_secs(10);

#[cfg(unix)]
mod unix_impl {
    use super::{CONFIRM_BUDGET, CONFIRM_POLL, GRACE};
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    /// Every live pid on the system. macOS has no `/proc`, so this is a
    /// genuinely different implementation per platform - an implementer
    /// reaching for a shelled-out `ps` here ships a fragile, slow kill.
    pub(super) fn list_pids() -> Vec<i32> {
        #[cfg(target_os = "macos")]
        {
            list_pids_macos()
        }
        #[cfg(target_os = "linux")]
        {
            list_pids_linux()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            Vec::new()
        }
    }

    #[cfg(target_os = "macos")]
    fn list_pids_macos() -> Vec<i32> {
        // `proc_listallpids` returns a PID COUNT, not a byte count. Apple's
        // libproc wraps `proc_listpids` — which does return bytes — and hands
        // back `bytes / sizeof(int)` (see libproc.c). Only its `buffersize`
        // ARGUMENT is in bytes. The asymmetry is the whole trap: dividing the
        // return value by `sizeof(pid_t)` as if it were bytes undercounts by
        // 4x on BOTH calls, so the sizing call asks for a buffer a quarter of
        // the size it needs, the kernel fills that buffer completely, and the
        // count is then divided by four AGAIN — landing far below the
        // capacity, which is precisely what a COMPLETE read looks like. The
        // retry never fires and a quarter-of-a-quarter of the pid table is
        // returned as if it were the whole thing.
        //
        // That silent truncation is not cosmetic here, because every consumer
        // of this list treats "not found" as "not running":
        // `pids_in_group` misses a live agent, `census` reads zero,
        // `kill_group_and_await` returns its early zero WITHOUT SIGNALING
        // ANYTHING, and the session actor's exit sequence then waits forever
        // to reap a child that nothing ever killed. Live-reproduced
        // 2026-08-13: a 946-process machine enumerated 76 pids, and the agent
        // the archive was trying to stop was not among them.
        //
        // SAFETY: a libproc read of the running kernel's pid table. With a
        // NULL buffer it returns the number of pids present; with a real
        // buffer it writes up to `buffersize` BYTES and returns the number of
        // pids written.
        unsafe {
            let present = libc::proc_listallpids(std::ptr::null_mut(), 0);
            if present <= 0 {
                return Vec::new();
            }
            let mut capacity = present as usize + 64;
            let mut best: Vec<i32> = Vec::new();
            for _ in 0..4 {
                let mut buf: Vec<libc::pid_t> = vec![0; capacity];
                let count = libc::proc_listallpids(
                    buf.as_mut_ptr() as *mut libc::c_void,
                    (buf.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int,
                );
                if count <= 0 {
                    break;
                }
                let count = (count as usize).min(buf.len());
                buf.truncate(count);
                let pids: Vec<i32> = buf.into_iter().map(|pid| pid).collect();
                let filled_the_buffer = pid_list_may_be_truncated(count, capacity);
                if pids.len() > best.len() {
                    best = pids;
                }
                if !filled_the_buffer {
                    return best;
                }
                // The pid table grew between the sizing call and the fill
                // call (or churned exactly full) - retry with headroom.
                capacity *= 2;
            }
            // Never silently swallow the list: a short census is bad evidence,
            // but an EMPTY one turns every kill into a no-op.
            tracing::warn!(
                pid_count = best.len(),
                "process_kill: the system pid enumeration never settled; the kill census may be short"
            );
            best
        }
    }

    /// A fill that reached the capacity it was handed proves nothing about
    /// what it did NOT write, so it must be retried against a bigger buffer.
    /// Split out from the `unsafe` block so the arithmetic that made the
    /// enumeration silently lossy is directly testable without a syscall.
    #[cfg(target_os = "macos")]
    pub(super) fn pid_list_may_be_truncated(count: usize, capacity: usize) -> bool {
        count >= capacity
    }

    #[cfg(target_os = "linux")]
    fn list_pids_linux() -> Vec<i32> {
        let mut pids = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if let Ok(pid) = name.parse::<i32>() {
                        pids.push(pid);
                    }
                }
            }
        }
        pids
    }

    /// The process group id of `pid`, or `None` if the pid is gone.
    /// `getpgid` is POSIX and portable across macOS and Linux - only the
    /// system-wide pid ENUMERATION differs by platform.
    fn group_id_of(pid: i32) -> Option<i32> {
        let pgid = unsafe { libc::getpgid(pid) };
        (pgid >= 0).then_some(pgid)
    }

    /// The session id of `pid`, or `None` if the pid is gone. macOS has no
    /// `ps -o sid` keyword; `getsid` is the portable syscall wrapper both
    /// platforms share.
    fn session_id_of(pid: i32) -> Option<i32> {
        let sid = unsafe { libc::getsid(pid) };
        (sid >= 0).then_some(sid)
    }

    #[cfg(target_os = "macos")]
    fn executable_path(pid: i32) -> Option<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let len = unsafe {
            libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32)
        };
        if len <= 0 {
            return None;
        }
        Some(PathBuf::from(
            String::from_utf8_lossy(&buf[..len as usize]).into_owned(),
        ))
    }

    #[cfg(target_os = "linux")]
    fn executable_path(pid: i32) -> Option<PathBuf> {
        std::fs::read_link(format!("/proc/{pid}/exe")).ok()
    }

    fn is_git_executable(path: &Path) -> bool {
        path.file_name().and_then(|name| name.to_str()) == Some("git")
    }

    /// Every live pid whose process group id equals `pgid`.
    pub(super) fn pids_in_group(pgid: i32) -> Vec<i32> {
        list_pids()
            .into_iter()
            .filter(|&pid| group_id_of(pid) == Some(pgid))
            .collect()
    }

    /// Every live pid whose session id equals `sid`.
    pub(super) fn pids_in_session(sid: i32) -> Vec<i32> {
        list_pids()
            .into_iter()
            .filter(|&pid| session_id_of(pid) == Some(sid))
            .collect()
    }

    /// The distinct process groups represented among `pids`. A PTY session
    /// with job control can hold several - one per pipeline/backgrounded job
    /// - and each needs its own group signal.
    fn distinct_groups(pids: &[i32]) -> HashSet<i32> {
        pids.iter().filter_map(|&pid| group_id_of(pid)).collect()
    }

    /// The `(total, git)` census over `pids`, resolving each pid's executable
    /// BEFORE any signal is sent - enumerating after the TERM undercounts
    /// exactly the processes that died fastest, which are the ones the kill-
    /// debris repair evidence cares about.
    pub(super) fn census(pids: &[i32]) -> (usize, usize) {
        let git = pids
            .iter()
            .filter(|&&pid| {
                executable_path(pid)
                    .map(|path| is_git_executable(&path))
                    .unwrap_or(false)
            })
            .count();
        (pids.len(), git)
    }

    fn signal_group(pgid: i32, signal: libc::c_int) {
        if pgid <= 0 {
            return;
        }
        // SAFETY: `kill(-pgid, signal)` targets every process in the group;
        // a failure (already dead, no such group) is not our problem.
        unsafe {
            libc::kill(-pgid, signal);
        }
    }

    /// Polls `remaining` until it reports nothing alive or `budget` elapses.
    /// Returns `true` when the target emptied inside the budget.
    ///
    /// This is what makes the TERM grace a DEADLINE rather than a fixed cost:
    /// a target that dies on the TERM in 50ms must not burn the whole 5s
    /// window, or a plane holding several targets cannot fit R4's 8s
    /// `QUIESCE_DEADLINE` even with the per-target kills fanned out.
    async fn wait_until_empty_within<F: Fn() -> Vec<i32>>(remaining: F, budget: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + budget;
        loop {
            if remaining().is_empty() {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(CONFIRM_POLL).await;
        }
    }

    async fn wait_until_empty<F: Fn() -> Vec<i32>>(remaining: F) {
        if !wait_until_empty_within(remaining, CONFIRM_BUDGET).await {
            tracing::warn!("process_kill: confirmation budget exceeded; target may still be alive");
        }
    }

    /// TERM the whole process group, then - on a DETACHED task so a dropped
    /// or timed-out caller future can never strand a TERM-ignoring process
    /// between the TERM and the KILL - POLL for the group's death for at most
    /// the grace period, KILL whatever remains once that deadline passes, and
    /// re-enumerate until the group is empty (or the confirmation budget runs
    /// out). Returns the `(total, git)` census taken over the group BEFORE
    /// signaling; `(0, 0)` means nothing was running.
    ///
    /// The grace is a deadline, not a fixed cost: a group that honors the
    /// TERM resolves this call in milliseconds. Callers with several targets
    /// must additionally drive them CONCURRENTLY so the whole plane pays one
    /// grace window rather than one per target - see
    /// `close_all_for_workspace` and `stop_all_for_workspace`.
    pub async fn kill_group_and_await(pgid: i32) -> (usize, usize) {
        let pids = pids_in_group(pgid);
        let counted = census(&pids);
        if counted.0 == 0 {
            return counted;
        }
        signal_group(pgid, libc::SIGTERM);
        let escalation = tokio::spawn(async move {
            if wait_until_empty_within(|| pids_in_group(pgid), GRACE).await {
                return;
            }
            signal_group(pgid, libc::SIGKILL);
            wait_until_empty(|| pids_in_group(pgid)).await;
        });
        let _ = escalation.await;
        counted
    }

    /// Session-wide kill for PTY terminals: every pid whose session id
    /// matches `sid` (the PTY child is already a session leader - see
    /// `portable-pty-0.9.0/src/unix.rs`'s `setsid()` in the child's
    /// `pre_exec` - so a plain group kill aimed at the shell misses a
    /// backgrounded job in its own group). Signals every distinct group found
    /// among the session's members, and re-enumerates because job control can
    /// create a new group between the TERM and the KILL. Detached and
    /// detach-safe for the same reason as [`kill_group_and_await`], and the
    /// grace is the same early-exiting deadline: a PTY session whose members
    /// honor the TERM costs milliseconds, not 5s. Returns the `(total, git)`
    /// census taken over the session BEFORE signaling.
    pub async fn kill_session_and_await(sid: i32) -> (usize, usize) {
        let pids = pids_in_session(sid);
        let counted = census(&pids);
        if counted.0 == 0 {
            return counted;
        }
        for group in distinct_groups(&pids) {
            signal_group(group, libc::SIGTERM);
        }
        let escalation = tokio::spawn(async move {
            if wait_until_empty_within(|| pids_in_session(sid), GRACE).await {
                return;
            }
            let deadline = tokio::time::Instant::now() + CONFIRM_BUDGET;
            loop {
                let remaining = pids_in_session(sid);
                if remaining.is_empty() {
                    return;
                }
                // Job control can start a new pipeline (a new group) between
                // one enumeration pass and the next, so this re-enumerates
                // and re-signals every iteration rather than KILLing once.
                for group in distinct_groups(&remaining) {
                    signal_group(group, libc::SIGKILL);
                }
                if tokio::time::Instant::now() >= deadline {
                    tracing::warn!(
                        "process_kill: confirmation budget exceeded; session may still be alive"
                    );
                    return;
                }
                tokio::time::sleep(CONFIRM_POLL).await;
            }
        });
        let _ = escalation.await;
        counted
    }
}

#[cfg(unix)]
pub use unix_impl::{kill_group_and_await, kill_session_and_await};

/// The tree bookkeeping the Windows kill path runs on. It contains no FFI, so
/// it is compiled under `test` on every platform and its unit tests run on the
/// ordinary Linux and macOS jobs - which is where the multi-pass escalation
/// logic actually gets exercised, since a real-process Windows test never
/// reaches the second pass.
#[cfg(any(windows, test))]
#[path = "process_kill_tree.rs"]
mod tree;

#[cfg(windows)]
#[path = "process_kill_windows.rs"]
mod windows_impl;

/// Windows: the pgid a caller holds is only ever the direct child's pid (see
/// this module's header), so this kills the descendant tree rooted at it.
/// Same `(total, git)` census, same detached escalation, same deadline
/// semantics as the unix path; the one behavioral difference is that
/// `TerminateProcess` is unconditional, so there is no graceful rung before
/// it (`process_kill_windows.rs` explains why one is not reachable from the
/// current spawn sites).
#[cfg(windows)]
pub async fn kill_group_and_await(pgid: i32) -> (usize, usize) {
    windows_impl::kill_tree_and_await(pgid).await
}

/// Windows: PTY sessions do not exist as a kernel concept, and portable-pty's
/// ConPTY backend has no `setsid()` to make the child a session leader, so
/// `sid` here is just the PTY child's pid and the shell's jobs are its
/// ordinary descendants. Same tree kill as [`kill_group_and_await`].
#[cfg(windows)]
pub async fn kill_session_and_await(sid: i32) -> (usize, usize) {
    windows_impl::kill_tree_and_await(sid).await
}

/// No other platform is a build target for this runtime. Returning the bare
/// `(0, 0)` here would be indistinguishable from a successful kill of nothing,
/// so the stub is loud instead of silent: a caller that believes a live plane
/// has quiesced when nothing was killed is worse than an error, because
/// archive then proceeds against a workspace whose processes are still
/// holding it.
#[cfg(not(any(unix, windows)))]
pub async fn kill_group_and_await(pgid: i32) -> (usize, usize) {
    tracing::error!(
        pgid,
        "process_kill: no process-kill implementation for this platform; NOTHING was killed"
    );
    (0, 0)
}

#[cfg(not(any(unix, windows)))]
pub async fn kill_session_and_await(sid: i32) -> (usize, usize) {
    tracing::error!(
        sid,
        "process_kill: no process-kill implementation for this platform; NOTHING was killed"
    );
    (0, 0)
}

/// Shared by every plane's kill test that needs to assert real process death
/// without reaching for a shelled-out `ps`: `kill(pid, 0)` is `true` for a
/// live pid (including a not-yet-reaped zombie) and `false` once the kernel
/// has actually freed the slot (`ESRCH`). A permission error still counts as
/// "alive" - it means the pid exists and we simply don't own it.
#[cfg(test)]
#[cfg(unix)]
pub(crate) fn pid_is_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(test)]
#[cfg(unix)]
#[path = "process_kill_tests.rs"]
mod tests;
