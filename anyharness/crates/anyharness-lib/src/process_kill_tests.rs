//! Real-process coverage for the shared kill mechanism: the guarantee under
//! test IS process death, so every case here spawns a real OS process rather
//! than a fake (`specs/engineering/testing/standard.md`'s crash-drill carve-out is about database
//! resume drills and does not reach this module - see the R3 delivery spec's
//! Tests section).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

use super::{kill_group_and_await, kill_session_and_await, pid_is_alive};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "anyharness-process-kill-test-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

/// Compiles a trivial "sleep `<argv[1]>` seconds" binary to `dir/name` via
/// the system C compiler. A `cp` of an Apple system binary (e.g.
/// `/bin/sleep`) will NOT do here: macOS's code-signing/library-validation
/// enforcement SIGKILLs a platform binary the instant it is exec'd from a
/// path other than its originally-signed location (repro-verified: a plain
/// copy of `/bin/sleep` exits 137 on exec). A binary this test compiles
/// itself has no such binding to a signed path.
fn compile_sleep_binary_named(dir: &Path, name: &str) -> PathBuf {
    let source = dir.join(format!("{name}.c"));
    std::fs::write(
        &source,
        "#include <unistd.h>\n#include <stdlib.h>\n\
         int main(int argc, char **argv) {\n\
         \x20\x20\x20\x20unsigned secs = argc > 1 ? (unsigned)atoi(argv[1]) : 300;\n\
         \x20\x20\x20\x20sleep(secs);\n\
         \x20\x20\x20\x20return 0;\n\
         }\n",
    )
    .expect("write fake-executable source");
    let path = dir.join(name);
    let status = std::process::Command::new("cc")
        .arg("-O0")
        .arg("-o")
        .arg(&path)
        .arg(&source)
        .status()
        .expect("invoke cc to build the fake executable");
    assert!(status.success(), "cc failed to build the fake executable");
    path
}

/// Compiles a tiny helper that puts ITSELF into a brand-new process group
/// (`setpgid(0, 0)`) and then `exec`s the command given as its own argv, so a
/// backgrounded job can be guaranteed its own process group without relying
/// on the shell's interactive job control (`set -m`). Job control is what
/// production gets from running inside a real PTY (`portable-pty`'s
/// `setsid()` in the child's `pre_exec` gives the shell a controlling
/// terminal); a shell spawned here with `Stdio::null()` has no controlling
/// terminal, so on CI (no tty at all, unlike a developer's own terminal) a
/// plain `set -m` background job silently stays in the shell's own group -
/// `setpgid` is what job control does under the hood, so calling it directly
/// preserves exactly the property this test proves without needing a tty.
fn compile_own_group_backgrounder(dir: &Path, name: &str) -> PathBuf {
    let source = dir.join(format!("{name}.c"));
    std::fs::write(
        &source,
        "#include <unistd.h>\n\
         int main(int argc, char **argv) {\n\
         \x20\x20\x20\x20if (setpgid(0, 0) != 0) {\n\
         \x20\x20\x20\x20\x20\x20\x20\x20return 1;\n\
         \x20\x20\x20\x20}\n\
         \x20\x20\x20\x20if (argc < 2) {\n\
         \x20\x20\x20\x20\x20\x20\x20\x20return 1;\n\
         \x20\x20\x20\x20}\n\
         \x20\x20\x20\x20execvp(argv[1], &argv[1]);\n\
         \x20\x20\x20\x20return 1;\n\
         }\n",
    )
    .expect("write own-group-backgrounder source");
    let path = dir.join(name);
    let status = std::process::Command::new("cc")
        .arg("-O0")
        .arg("-o")
        .arg(&path)
        .arg(&source)
        .status()
        .expect("invoke cc to build the own-group-backgrounder");
    assert!(
        status.success(),
        "cc failed to build the own-group-backgrounder"
    );
    path
}

/// Polls `path` for a pid written by a shell's `echo $! > path`. Real
/// processes fork asynchronously from the test's point of view, so this is
/// the deterministic replacement for a fixed sleep.
async fn wait_for_pidfile(path: &Path) -> i32 {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(contents) = std::fs::read_to_string(path) {
            if let Ok(pid) = contents.trim().parse::<i32>() {
                return pid;
            }
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("pidfile {path:?} was not written within the wait budget");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn kill_group_and_await_returns_zero_when_nothing_is_running() {
    // A pgid essentially guaranteed to have no live members in a test
    // environment - the "no run" branch every stop primitive must hit
    // without erroring.
    let (total, git) = kill_group_and_await(999_999).await;
    assert_eq!((total, git), (0, 0));
}

#[tokio::test]
async fn kill_session_and_await_returns_zero_when_nothing_is_running() {
    let (total, git) = kill_session_and_await(999_999).await;
    assert_eq!((total, git), (0, 0));
}

/// The grandchild case, at the mechanism level: a group leader that
/// backgrounds a child and waits on it. Negative control (documented, not
/// re-run under a mutated binary): without the process-group spawn plus
/// group signal, only the leader's own pid would be reachable and the
/// grandchild would survive - exactly today's pre-R3 `setup_process.rs`
/// behavior the ADR names.
#[tokio::test]
async fn kill_group_and_await_kills_the_leader_and_a_grandchild_process() {
    let dir = temp_dir("grandchild");
    let pidfile = dir.join("grandchild.pid");

    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c")
        .arg(format!(
            "sleep 300 & echo $! > {} ; wait",
            pidfile.display()
        ))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.process_group(0);
    let mut leader = cmd.spawn().expect("spawn group leader");
    let pgid = leader.id().expect("leader pid") as i32;

    let grandchild_pid = wait_for_pidfile(&pidfile).await;
    assert!(
        pid_is_alive(grandchild_pid),
        "grandchild must be running before the kill"
    );

    // The leader is OWNED by this test (`leader = cmd.spawn()`), so it must
    // be reaped concurrently with the kill - a killed-but-unreaped owned
    // child is a zombie, which `kill(pid, 0)` (this module's `pid_is_alive`)
    // reports as alive regardless of the OS-level kill having worked. This
    // mirrors the real call sites (`run()`'s exit sequence,
    // `run_setup_process`'s timeout arm), which always `tokio::join!` the
    // escalation with their own `child.wait()` for exactly this reason.
    let (total, git) = tokio::join!(kill_group_and_await(pgid), leader.wait()).0;

    assert!(
        total >= 2,
        "leader and grandchild must both be counted, got {total}"
    );
    assert_eq!(git, 0);
    assert!(!pid_is_alive(pgid), "the group leader must be dead");
    assert!(
        !pid_is_alive(grandchild_pid),
        "the grandchild must die with the group - a group kill that only \
         reaches the direct child leaves this alive"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The grace is a DEADLINE, not a fixed cost: a group that honors the TERM
/// must resolve the call as soon as it is confirmed dead, not after the full
/// 5s window. Negative control: restore the unconditional
/// `tokio::time::sleep(GRACE)` the escalation used to open with and this
/// fails at ~5s. Without it, R4's 8s `QUIESCE_DEADLINE` cannot be met even
/// with the plane loops fanned out - every terminal and every session would
/// individually cost 5s.
#[tokio::test]
async fn kill_group_and_await_returns_as_soon_as_a_term_respecting_group_is_dead() {
    let mut cmd = Command::new("sleep");
    cmd.arg("300")
        .process_group(0)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().expect("spawn TERM-respecting sleep");
    let pgid = child.id().expect("pid") as i32;

    let started = tokio::time::Instant::now();
    // Owned child - reap concurrently, or its zombie keeps the group
    // enumeration non-empty and the escalation waits out the whole grace for
    // a process that is already dead.
    let (total, git) = tokio::join!(kill_group_and_await(pgid), child.wait()).0;
    let elapsed = started.elapsed();

    assert_eq!((total, git), (1, 0));
    assert!(!pid_is_alive(pgid), "the process must be dead");
    assert!(
        elapsed < Duration::from_secs(2),
        "a process that dies on the TERM must not cost the full 5s grace: {elapsed:?}"
    );
}

/// A TERM-ignoring process must still die, via the KILL half of the
/// escalation, after the grace window - not immediately. Negative control:
/// without the KILL step the process would still be alive when this
/// function returns (the confirmation loop would exhaust its budget and
/// warn rather than block forever, but the pid would remain live).
#[tokio::test]
async fn kill_group_and_await_escalates_past_a_term_ignoring_process() {
    let mut cmd = Command::new("/bin/sh");
    // `exec` replaces the shell's own process image with `sleep` in place -
    // no fork, so the group stays at exactly one process - while the
    // `SIG_IGN` disposition the `trap ''` set survives the `exec` (POSIX:
    // ignored dispositions, unlike caught ones, are preserved across
    // `execve`), so the resulting `sleep` still ignores TERM.
    cmd.arg("-c")
        .arg("trap '' TERM; exec sleep 300")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.process_group(0);
    let mut child = cmd.spawn().expect("spawn TERM-ignoring script");
    let pgid = child.id().expect("pid") as i32;
    // Let the trap register before the census/signal races it.
    tokio::time::sleep(Duration::from_millis(150)).await;

    let started = tokio::time::Instant::now();
    // Owned child - reap concurrently with the kill (see the grandchild
    // test's comment for why `pid_is_alive` would otherwise see a zombie).
    let (total, _git) = tokio::join!(kill_group_and_await(pgid), child.wait()).0;
    let elapsed = started.elapsed();

    assert_eq!(total, 1);
    assert!(
        !pid_is_alive(pgid),
        "a TERM-ignoring process must still die via the SIGKILL escalation"
    );
    assert!(
        elapsed >= Duration::from_secs(5),
        "the KILL must wait out the 5s grace, not fire immediately: {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_secs(9),
        "escalation should not run drastically past grace + margin: {elapsed:?}"
    );
}

/// The `(total, git)` split is real: a group holding one `git`-named
/// executable alongside one ordinary process reports `git` strictly less
/// than `total`.
#[tokio::test]
async fn census_counts_git_executables_distinctly_from_the_total() {
    let dir = temp_dir("git-census");
    // A shebang SCRIPT named "git" would not work here: `proc_pidpath` (and
    // `/proc/<pid>/exe`) resolve to the process image the kernel actually
    // loaded, which for a `#!/bin/sh` script is the interpreter (`sh`), not
    // the script path. A real executable at a path named `git` is what
    // makes `is_git_executable`'s basename check see "git" - compiled, not
    // copied, per `compile_sleep_binary_named`'s doc comment.
    let git_bin = compile_sleep_binary_named(&dir, "git");

    let mut git_cmd = Command::new(&git_bin);
    git_cmd
        .arg("300")
        .process_group(0)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut git_child = git_cmd.spawn().expect("spawn fake git");
    let pgid = git_child.id().expect("pid") as i32;

    let mut sleep_cmd = Command::new("sleep");
    sleep_cmd
        .arg("300")
        .process_group(pgid)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut sleep_child = sleep_cmd
        .spawn()
        .expect("join a plain process into the same group");

    // Both are owned children - reap both concurrently with the kill.
    let (total, git) = tokio::join!(
        kill_group_and_await(pgid),
        git_child.wait(),
        sleep_child.wait()
    )
    .0;

    assert_eq!(total, 2, "both processes in the group must be counted");
    assert_eq!(git, 1, "only the git-named executable counts as a git kill");
    assert!(git < total, "the split must be real, not total==git");

    let _ = std::fs::remove_dir_all(&dir);
}

/// The other half of the same contract: an idle non-git process dying must
/// never be miscounted as a git kill (R2's repair evidence refuses when
/// total is nonzero but git is zero).
#[tokio::test]
async fn census_reports_zero_git_for_a_group_with_no_git_process() {
    let mut cmd = Command::new("sleep");
    cmd.arg("300").process_group(0);
    let mut child = cmd.spawn().expect("spawn sleep");
    let pgid = child.id().expect("pid") as i32;

    let (total, git) = kill_group_and_await(pgid).await;

    assert_eq!(total, 1);
    assert_eq!(git, 0);

    let _ = child.wait().await;
}

/// The session-wide kill must reach a backgrounded job that job control put
/// in its OWN process group, distinct from the session leader's - exactly
/// the shape `close_all_for_workspace` needs against an interactive PTY
/// shell. Negative control: a plain group kill aimed at the leader's own
/// pgid would miss this job entirely, which is the bug the ADR names for
/// `handle.rs:228`'s `PtyHandle::kill()` (`self.child.kill()`).
///
/// The job's own group is created explicitly via
/// `compile_own_group_backgrounder` rather than via the shell's `set -m`:
/// interactive job control needs a controlling terminal to actually move a
/// backgrounded job into a new group (that's what production gets from
/// `portable-pty`'s real PTY), and this fixture's shell has none
/// (`Stdio::null()`) - on CI, with no tty available at all, `set -m` was
/// silently a no-op and the job stayed in the shell's own group, unlike on a
/// developer machine's own terminal where a tty happens to be reachable.
/// Calling `setpgid` directly is what job control does under the hood, so
/// this preserves exactly the property the test proves without depending on
/// a tty being present.
#[tokio::test]
async fn kill_session_and_await_kills_a_backgrounded_job_in_its_own_group() {
    let dir = temp_dir("session-job-control");
    let pidfile = dir.join("job.pid");
    let backgrounder = compile_own_group_backgrounder(&dir, "own-group-bg");

    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg(format!(
        "{} sleep 300 & echo $! > {} ; wait",
        backgrounder.display(),
        pidfile.display()
    ));
    cmd.stdout(Stdio::null()).stderr(Stdio::null());
    // Mirrors portable-pty's `setsid()` in the PTY child's `pre_exec`: the
    // shell becomes its own session leader so `getsid(shell_pid) ==
    // shell_pid`, exactly the property `close_all_for_workspace` relies on.
    unsafe {
        cmd.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let mut shell = cmd.spawn().expect("spawn session leader");
    let sid = shell.id().expect("shell pid") as i32;

    let job_pid = wait_for_pidfile(&pidfile).await;
    assert!(pid_is_alive(job_pid));

    // Sanity: the backgrounder really did put the job in a different group
    // than the shell's own - otherwise this test would not exercise the
    // case at all. The shell writes `$!` at fork time but the child only
    // calls `setpgid` after exec, so poll briefly instead of asserting the
    // very first read: on a loaded runner the child may not have been
    // scheduled yet.
    let shell_pgid = unsafe { libc::getpgid(sid) };
    let pgid_deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut job_pgid = unsafe { libc::getpgid(job_pid) };
    while job_pgid == shell_pgid && tokio::time::Instant::now() < pgid_deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
        job_pgid = unsafe { libc::getpgid(job_pid) };
    }
    assert_ne!(
        job_pgid, shell_pgid,
        "the backgrounder must have given the backgrounded job its own group within 5s"
    );

    // The shell is OWNED by this test - reap it concurrently with the kill,
    // same reasoning as the group-kill tests above.
    let (total, _git) = tokio::join!(kill_session_and_await(sid), shell.wait()).0;

    assert!(
        total >= 2,
        "both the shell and the backgrounded job must be counted, got {total}"
    );
    assert!(!pid_is_alive(sid), "the session leader must be dead");
    assert!(
        !pid_is_alive(job_pid),
        "a backgrounded job in its own group must die with the session"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The enumeration this whole module stands on must actually enumerate.
///
/// `proc_listallpids` returns a PID COUNT while taking a BYTE-sized buffer
/// argument, and reading the return value as bytes undercounts by 4x on both
/// the sizing call and the fill. The damage is silent by construction: the
/// undersized buffer fills COMPLETELY, and the count is then divided by four
/// again, landing far below the capacity — which is exactly what a complete
/// read looks like, so the retry never fires and a fraction of the pid table
/// is returned as the whole thing.
///
/// A short list is not a cosmetic defect anywhere downstream, because every
/// consumer reads "absent" as "not running": `pids_in_group` misses a live
/// process, `census` reads zero, and `kill_group_and_await` takes its
/// zero-census early return and SIGNALS NOTHING.
///
/// `ps` is the oracle here and only here. The module doc bars a shelled-out
/// `ps` from the production kill path (fragile and slow); as an INDEPENDENT
/// source of truth in a test it is exactly what is wanted, since a bug in the
/// libproc arithmetic cannot also be present in `ps`.
#[cfg(target_os = "macos")]
#[test]
fn list_pids_enumerates_the_whole_pid_table_not_a_prefix_of_it() {
    let ps = std::process::Command::new("ps")
        .args(["-eo", "pid="])
        .output()
        .expect("ps must run as the independent oracle");
    let ps_pids: Vec<i32> = String::from_utf8_lossy(&ps.stdout)
        .split_whitespace()
        .filter_map(|pid| pid.parse::<i32>().ok())
        .collect();
    assert!(
        ps_pids.len() > 20,
        "the oracle itself looks wrong: ps reported {} processes",
        ps_pids.len()
    );

    let listed = super::unix_impl::list_pids();

    // Deliberately not an equality assertion: processes come and go between
    // the two enumerations. The bug under test loses ~3/4 of the table, so a
    // generous floor separates it from that churn without being flaky.
    assert!(
        listed.len() * 2 >= ps_pids.len(),
        "list_pids enumerated {} of the {} processes ps can see - the pid table is being truncated",
        listed.len(),
        ps_pids.len()
    );
    assert!(
        listed.contains(&(std::process::id() as i32)),
        "list_pids must at minimum contain the running test process"
    );
}

/// The exact arithmetic that made the truncation invisible, pinned without a
/// syscall. The live 2026-08-13 repro is the case in the middle: a fill that
/// wrote 305 pids into a 305-slot buffer was reported as 76 (305/4) and so
/// read as "comfortably complete" against a capacity of 305.
#[cfg(target_os = "macos")]
#[test]
fn a_fill_that_reached_its_capacity_is_treated_as_truncated() {
    use super::unix_impl::pid_list_may_be_truncated;

    assert!(
        pid_list_may_be_truncated(305, 305),
        "a fill that reached the capacity it was handed proves nothing about what it did not write"
    );
    assert!(
        pid_list_may_be_truncated(400, 305),
        "a count above the capacity is a truncation too"
    );
    assert!(
        !pid_list_may_be_truncated(946, 1029),
        "a fill that left room to spare is the only complete one"
    );
    // The live repro: the divided-by-four count that the old check read as
    // complete is only complete if the capacity is read at the same scale.
    assert!(
        !pid_list_may_be_truncated(76, 305),
        "76 of 305 is what the bug LOOKED like; the fix is upstream, in never producing that number"
    );
}
