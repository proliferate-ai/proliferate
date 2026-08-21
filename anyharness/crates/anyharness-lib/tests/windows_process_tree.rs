//! Real-process proof for the Windows half of `process_kill`.
//!
//! Why this is an INTEGRATION test and not a `#[cfg(test)]` module next to the
//! code it exercises: `anyharness-lib`'s `lib test` target does not build for
//! `x86_64-pc-windows-msvc` today. `cargo check --all-targets` on Windows
//! reports ten pre-existing errors, all of them test-only POSIX assumptions in
//! unrelated modules (`std::os::unix` imports, `Permissions::from_mode`, and
//! helpers behind `cfg(unix)` parents). A test filter does not help, because
//! the whole test target still has to build. An integration test is compiled
//! as its own crate against the library's PUBLIC surface, so it never pulls in
//! those `#[cfg(test)]` modules and can run on Windows today without absorbing
//! someone else's port into this change.
//!
//! What it buys: the unit tests inside `process_kill_windows.rs` cover the
//! pure logic but cannot be compiled on Windows for the reason above, so
//! without this file every line of `unsafe` FFI in that module would ship
//! typechecked and never executed. These tests spawn REAL process trees and
//! kill them through the real public entry point, which exercises
//! `CreateToolhelp32Snapshot`, the `PROCESSENTRY32W` walk, `TreeTracker`, the
//! census, `OpenProcess`/`TerminateProcess`, and the confirmation loop against
//! the actual kernel.
//!
//! Every assertion is checked with an oracle INDEPENDENT of the code under
//! test: `std::process::Child` for the direct child, and PowerShell's CIM
//! process table for descendants. Asserting a Toolhelp walk against itself
//! would prove nothing.

#![cfg(windows)]

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyharness_lib::process_kill::kill_group_and_await;

/// How long a spawned `cmd.exe` is given to start its own child.
const CHILD_START_BUDGET: Duration = Duration::from_secs(20);
const CHILD_POLL: Duration = Duration::from_millis(250);

fn powershell(script: &str) -> String {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .expect("run powershell");
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

/// The direct children of `pid` as `(pid, image name)`, read from the CIM
/// process table rather than from the Toolhelp walk under test.
fn children_of(pid: u32) -> Vec<(u32, String)> {
    let script = format!(
        "Get-CimInstance Win32_Process -Filter \"ParentProcessId={pid}\" | ForEach-Object {{ \"$($_.ProcessId) $($_.Name)\" }}"
    );
    powershell(&script)
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim().splitn(2, ' ');
            let pid = parts.next()?.parse::<u32>().ok()?;
            Some((pid, parts.next().unwrap_or_default().to_string()))
        })
        .collect()
}

fn pid_is_alive(pid: u32) -> bool {
    let script = format!(
        "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ 'ALIVE' }} else {{ 'DEAD' }}"
    );
    powershell(&script) == "ALIVE"
}

/// Waits for `pid` to have at least one child, returning them. Spawning is not
/// instant, so asserting immediately after `spawn()` would be a race.
fn wait_for_children(pid: u32) -> Vec<(u32, String)> {
    let deadline = Instant::now() + CHILD_START_BUDGET;
    loop {
        let children = children_of(pid);
        if !children.is_empty() {
            return children;
        }
        if Instant::now() >= deadline {
            return Vec::new();
        }
        std::thread::sleep(CHILD_POLL);
    }
}

/// The whole descendant tree of `pid` per the CIM process table. Git for
/// Windows layers a shim, so "the git process" is not one process.
fn descendants_of(pid: u32) -> Vec<(u32, String)> {
    let mut found: Vec<(u32, String)> = Vec::new();
    let mut frontier = vec![pid];
    for _ in 0..8 {
        let mut next = Vec::new();
        for parent in frontier {
            for (child, name) in children_of(parent) {
                if found.iter().any(|(seen, _)| *seen == child) {
                    continue;
                }
                found.push((child, name));
                next.push(child);
            }
        }
        if next.is_empty() {
            break;
        }
        frontier = next;
    }
    found
}

fn wait_for_named_child(pid: u32, name: &str) -> Option<u32> {
    let deadline = Instant::now() + CHILD_START_BUDGET;
    loop {
        if let Some((child, _)) = children_of(pid)
            .into_iter()
            .find(|(_, image)| image.eq_ignore_ascii_case(name))
        {
            return Some(child);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(CHILD_POLL);
    }
}

/// The core claim this whole change exists to make true: a stop reaches the
/// grandchild, not just the process we spawned. Before this change
/// `kill_group_and_await` returned `(0, 0)` on Windows without touching
/// anything, so this test would have failed on BOTH the census and the
/// liveness assertion - which is the negative control for it.
#[tokio::test]
async fn kills_a_real_process_tree_including_the_grandchild() {
    let mut root = Command::new("cmd.exe")
        .args(["/c", "ping", "-n", "120", "127.0.0.1"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn cmd.exe");
    let root_pid = root.id();

    let children = wait_for_children(root_pid);
    assert!(
        !children.is_empty(),
        "cmd.exe never started its ping.exe child, so there is no tree to prove anything about"
    );
    let (grandchild_pid, grandchild_name) = children[0].clone();

    let (total, _git) = kill_group_and_await(root_pid as i32).await;
    assert!(
        total >= 2,
        "the census counted {total}; it must include cmd.exe (pid {root_pid}) and its {grandchild_name} child (pid {grandchild_pid})"
    );

    // `Child::wait` is the OS's own answer about the direct child, entirely
    // separate from the snapshot code under test.
    let status = root.wait().expect("wait on cmd.exe");
    assert!(
        !status.success(),
        "cmd.exe exited cleanly ({status:?}); it should have been terminated"
    );
    assert!(
        !pid_is_alive(grandchild_pid),
        "the {grandchild_name} grandchild (pid {grandchild_pid}) outlived the kill"
    );
}

/// The `git` half of the census, against a REAL `git.exe`.
///
/// This is not a detail. `PlaneKills::git` is evidence, not telemetry: R2's
/// `repair_kill_debris` aborts a conflict sentinel only when `killed_git > 0`.
/// The unix enumeration compares the base name against exactly `"git"`, and on
/// Windows the base name is `git.exe`, so reusing that comparison would have
/// counted zero forever and silently changed a product decision while looking
/// entirely correct.
///
/// `git stripspace` is a plumbing filter that needs no repository and blocks
/// reading stdin, which keeps a genuine `git.exe` alive as a grandchild for as
/// long as we hold the pipe open.
#[tokio::test]
async fn the_census_counts_a_real_git_exe_grandchild() {
    let mut root = Command::new("cmd.exe")
        .args(["/c", "git", "stripspace"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn cmd.exe");
    let root_pid = root.id();
    // Held, not dropped: closing this pipe would let git exit on EOF.
    let stdin = root.stdin.take().expect("cmd.exe stdin");

    let git_pid = wait_for_named_child(root_pid, "git.exe")
        .unwrap_or_else(|| panic!("cmd.exe never started git.exe under pid {root_pid}"));

    // The negative control for the whole point of this test, read from the
    // independent oracle: every git process in the tree is named `git.exe`,
    // never a bare `git`. The unix path's exact `"git"` comparison would
    // therefore have counted ZERO here while looking entirely correct.
    let tree = descendants_of(root_pid);
    let git_names: Vec<String> = tree
        .iter()
        .map(|(_, name)| name.clone())
        .filter(|name| name.to_ascii_lowercase().starts_with("git"))
        .collect();
    assert!(
        !git_names.is_empty(),
        "the CIM oracle saw no git process under pid {root_pid}; tree was {tree:?}"
    );
    assert!(
        git_names.iter().all(|name| name != "git"),
        "expected Windows-shaped names that an exact \"git\" comparison would miss, saw {git_names:?}"
    );

    let (total, git) = kill_group_and_await(root_pid as i32).await;
    // NOT `== 1`. Git for Windows resolves `git` to a shim in `cmd\git.exe`
    // that launches the real `git.exe` from `mingw64\bin`, so a single `git`
    // invocation is two `git.exe` processes and this tree is three deep. The
    // load-bearing claim is that the count is NONZERO, because that is exactly
    // what R2's `repair_kill_debris` branches on (`killed_git > 0`); an exact
    // `"git"` comparison would have made it zero forever.
    assert!(
        git >= 1,
        "the census counted {git} git processes out of {total}; the real git.exe at pid {git_pid} must be recognised (oracle saw {git_names:?})"
    );
    assert!(
        total >= 2,
        "the census counted {total}; it must include cmd.exe and its git.exe child"
    );

    assert!(
        !pid_is_alive(git_pid),
        "the git.exe grandchild (pid {git_pid}) outlived the kill"
    );
    drop(stdin);
    let _ = root.wait();
}
