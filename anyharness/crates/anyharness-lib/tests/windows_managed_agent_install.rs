//! Does the managed-agent install path produce something Windows can actually
//! execute, and does spawning it work?
//!
//! Every Windows fix so far has been derived by reading source, and each review
//! round found one more broken layer under the last: packaging, then the
//! install path, then the launcher, then what the launcher invokes. Nobody
//! knows how many layers remain because the path has never been RUN. This test
//! runs it, end to end, against the real production code:
//!
//!   bundled catalog -> registry descriptor -> `install_agent_with_pins`
//!   -> real `npm install` of the pinned package -> emitted managed launcher
//!   -> spawn that launcher the way `live::sessions::driver::process` does.
//!
//! Layers under test, all at once:
//!   1. `installer::npm` shelling out to npm — on Windows Node ships
//!      `npm.cmd`, not `npm.exe` (fixed in #2152 @ f3122f08fc; asserted here
//!      by actually spawning it, not by asserting the string).
//!   2. The emitted launcher: extension-less `#!/bin/sh` on unix, `.cmd` on
//!      Windows (PR #2152).
//!   3. What the launcher invokes: the `node_modules\.bin\grok` shim. #2152 @
//!      f3122f08fc points it at the `.cmd` sibling npm's cmd-shim writes; what
//!      npm ACTUALLY writes into `.bin` on Windows is observed here, on a real
//!      filesystem, rather than asserted as a string.
//!   4. `make_executable` being a no-op on Windows and `is_valid_executable`
//!      being only `path.is_file()` there.
//!   5. Whether the resulting artifact is spawnable by `CreateProcess`.
//!
//! Why an integration test target rather than a unit test: `anyharness-lib`'s
//! `lib test` target does not build for Windows today (ten pre-existing
//! errors, all test-only POSIX assumptions in unrelated modules). An
//! integration test compiles as its own crate against the library's public
//! surface, so it never pulls those in. Precedent: PR #2147's
//! `tests/windows_process_tree.rs`.
//!
//! Why grok: its agent-process pin is a plain public npm package
//! (`@xai-official/grok`), so the install needs no GitHub credentials, and it
//! declares no native CLI, so the run is one artifact and no LLM, no auth, no
//! desktop app. Its executable shape (`node_modules/.bin/<name>`) is identical
//! to claude's and codex's, which is the shape actually in doubt.
//!
//! Deliberately NOT weakened: no stubs, no mocks, no `continue-on-error`, no
//! skip-if-unavailable. A failure here with a real Windows error message is
//! the finding.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyharness_lib::domains::agents::catalog::service::AgentCatalogService;
use anyharness_lib::domains::agents::catalog::sync::CatalogSyncService;
use anyharness_lib::domains::agents::installer::{install_agent_with_pins, InstallOptions};
use anyharness_lib::domains::agents::model::ArtifactRole;
use anyharness_lib::domains::agents::registry;

fn scratch_runtime_home(label: &str) -> PathBuf {
    let unique = format!(
        "anyharness-win-agent-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    );
    let path = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&path).expect("create scratch runtime home");
    path
}

fn list_dir(label: &str, dir: &Path) {
    println!("--- {label}: {}", dir.display());
    match std::fs::read_dir(dir) {
        Ok(entries) => {
            let mut names: Vec<String> = entries
                .flatten()
                .map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let kind = if entry.path().is_dir() { "dir " } else { "file" };
                    let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                    format!("  {kind} {size:>9}  {name}")
                })
                .collect();
            names.sort();
            for name in names {
                println!("{name}");
            }
        }
        Err(error) => println!("  <unreadable: {error}>"),
    }
}

/// Layer 1, isolated so its failure cannot be confused with anything deeper.
///
/// `installer/npm.rs` shells out to npm through `npm_program_name()`, which is
/// crate-private, so this mirrors its choice rather than calling it. The point
/// is not the string — a unit test already asserts that — it is whether the
/// name Rust is handed can actually be RESOLVED AND SPAWNED. On Windows, Node
/// ships `npm.cmd` and `npm` (a sh script) but no `npm.exe`, and
/// `std::process::Command` has its own `.cmd`/`.bat` branch plus a CVE-era
/// argument restriction. Only running it settles it.
///
/// The bare `npm` result is recorded alongside, as the control that shows what
/// the pre-fix call shape does on this host.
#[test]
fn the_npm_program_name_the_installer_uses_actually_spawns() {
    println!(
        "PATHEXT = {:?}",
        std::env::var("PATHEXT").unwrap_or_else(|_| "<unset>".into())
    );

    // Control, non-fatal: the call shape `installer/npm.rs` used before the
    // Windows fix. Recorded so the fix's necessity is visible in the log.
    match Command::new("npm").arg("--version").output() {
        Ok(output) => println!(
            "control: bare `npm --version` -> status {:?} stdout {:?}",
            output.status,
            String::from_utf8_lossy(&output.stdout).trim()
        ),
        Err(error) => println!(
            "control: bare `npm --version` -> NOT SPAWNABLE: {error} (kind {:?}, raw os error {:?})",
            error.kind(),
            error.raw_os_error()
        ),
    }

    // Mirrors `installer::npm::npm_program_name()`.
    let program = if cfg!(windows) { "npm.cmd" } else { "npm" };
    println!("installer program name = {program:?}");
    match Command::new(program).arg("--version").output() {
        Ok(output) => {
            println!(
                "{program} --version -> status {:?} stdout {:?} stderr {:?}",
                output.status,
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            );
            assert!(
                output.status.success(),
                "`Command::new({program:?})` ran but failed: {output:?}"
            );
        }
        Err(error) => panic!(
            "`Command::new({program:?})` could not be spawned: {error} (kind {:?}, raw os error {:?}). \
             This is installer/npm.rs's exact call shape.",
            error.kind(),
            error.raw_os_error()
        ),
    }
}

/// The whole path: install the managed agent, then spawn what the install
/// produced.
///
/// `grok` is the minimal case: one artifact, a plain public npm package, no
/// native CLI. It isolates the npm + launcher + spawn layers.
#[test]
fn installs_the_managed_grok_agent_and_spawns_the_launcher_it_produces() {
    install_and_spawn("grok");
}

/// `claude` is the case that actually matters for a Windows beta: it is the
/// default agent, and it is the only shape that exercises BOTH remaining
/// install mechanisms in one run —
///   * a pinned native binary download (`claude.exe`, sha256-verified, ~324MB,
///     windows_x64 pin added by #2149), which is where `platform_binary_filename`
///     and `make_executable`'s Windows no-op land, and
///   * a GIT-sourced agent process (`npm install git+https://...#<sha>`), which
///     is a different npm invocation from grok's registry install and needs
///     `git` on PATH inside npm.
#[test]
fn installs_the_managed_claude_agent_and_spawns_the_launcher_it_produces() {
    install_and_spawn("claude");
}

fn install_and_spawn(agent_kind: &str) {
    let runtime_home = scratch_runtime_home(agent_kind);
    println!("runtime_home = {}", runtime_home.display());

    // Real bundled catalog + real bundled registry: the same two documents the
    // shipped runtime boots with.
    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()));
    let pins = catalog
        .pin_overrides(agent_kind)
        .unwrap_or_else(|| panic!("{agent_kind} must have catalog pins"));
    println!("catalog pins = {pins:?}");
    let descriptor = registry::descriptor(agent_kind)
        .unwrap_or_else(|| panic!("{agent_kind} must have a registry descriptor"));
    println!(
        "descriptor.launch.executable_name = {}",
        descriptor.launch.executable_name
    );

    // The production installer entry point, forced to actually do the work.
    let options = InstallOptions {
        reinstall: true,
        ..InstallOptions::default()
    };
    let installed = match install_agent_with_pins(&descriptor, &runtime_home, &options, Some(&pins))
    {
        Ok(installed) => installed,
        Err(error) => {
            let managed_dir = runtime_home
                .join("agents")
                .join(agent_kind)
                .join("agent_process");
            list_dir("agent_process dir after failed install", &managed_dir);
            list_dir(
                "node_modules/.bin after failed install",
                &managed_dir.join("node_modules").join(".bin"),
            );
            panic!(
                "install_agent_with_pins failed: {error} (kind {:?})",
                error.kind()
            );
        }
    };

    println!("installed artifacts:");
    for artifact in &installed {
        println!(
            "  role={:?} source={} version={:?} path={}",
            artifact.role,
            artifact.source,
            artifact.version,
            artifact.path.display()
        );
    }
    // The launcher is the agent-process artifact. `claude` also reports a
    // NativeCli artifact (the downloaded `claude.exe`); that one is a plain
    // binary, not the thing a session spawns.
    let artifact = installed
        .iter()
        .find(|artifact| matches!(artifact.role, ArtifactRole::AgentProcess))
        .expect("install must report an agent-process artifact");
    let launcher = artifact.path.clone();
    for artifact in &installed {
        if matches!(artifact.role, ArtifactRole::NativeCli) {
            // Windows has no exec bit, so the only thing that makes a
            // downloaded native CLI runnable is its name.
            println!(
                "native CLI installed at {} (exists={}, extension={:?})",
                artifact.path.display(),
                artifact.path.is_file(),
                artifact.path.extension()
            );
            assert!(
                artifact.path.is_file(),
                "the installer reported a native CLI at {} but no such file exists",
                artifact.path.display()
            );
        }
    }
    list_dir(
        "managed native dir",
        &runtime_home.join("agents").join(agent_kind).join("native"),
    );

    let managed_dir = runtime_home
        .join("agents")
        .join(agent_kind)
        .join("agent_process");
    list_dir("managed agent_process dir", &managed_dir);
    list_dir("node_modules/.bin", &managed_dir.join("node_modules").join(".bin"));

    assert!(
        launcher.is_file(),
        "the installer reported {} but no such file exists",
        launcher.display()
    );
    match std::fs::read_to_string(&launcher) {
        Ok(script) => println!("--- launcher script ({})\n{script}", launcher.display()),
        Err(error) => println!("--- launcher is not UTF-8 text: {error}"),
    }

    // Spawn it the way `live::sessions::driver::process::spawn_agent_process`
    // does: the launcher path as the program, all three stdio handles piped.
    // No extra args — the launcher already bakes the catalog's ACP args
    // (`agent stdio`), which is exactly what a real session runs.
    let mut command = Command::new(&launcher);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(&runtime_home);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => panic!(
            "spawning the managed launcher {} failed: {error} (kind {:?}, raw os error {:?})",
            launcher.display(),
            error.kind(),
            error.raw_os_error()
        ),
    };
    println!("spawned pid {}", child.id());

    // Close stdin: an ACP stdio server should see EOF and shut down cleanly.
    drop(child.stdin.take());
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let stdout_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stdout.read_to_string(&mut buffer);
        buffer
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + Duration::from_secs(60);
    let mut status = None;
    while Instant::now() < deadline {
        match child.try_wait().expect("try_wait") {
            Some(exited) => {
                status = Some(exited);
                break;
            }
            None => std::thread::sleep(Duration::from_millis(200)),
        }
    }
    let still_running = status.is_none();
    if still_running {
        // A live ACP server that outlives stdin EOF is a perfectly good
        // outcome: it started. Reap it so the pipes close.
        let _ = child.kill();
        let _ = child.wait();
    }
    let out = stdout_reader.join().unwrap_or_default();
    let err = stderr_reader.join().unwrap_or_default();
    println!("--- launcher stdout\n{out}");
    println!("--- launcher stderr\n{err}");
    println!("--- launcher status: {status:?} (still_running={still_running})");

    let _ = std::fs::remove_dir_all(&runtime_home);

    if let Some(status) = status {
        assert!(
            status.success(),
            "the managed launcher spawned but exited unsuccessfully: {status:?}\nstdout:\n{out}\nstderr:\n{err}"
        );
    }
}
