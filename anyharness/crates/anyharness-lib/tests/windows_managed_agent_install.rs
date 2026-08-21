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
//!   1. `installer::npm` shelling out with `Command::new("npm")` — on Windows
//!      Node ships `npm.cmd`, not `npm.exe`.
//!   2. The emitted launcher: extension-less `#!/bin/sh` on unix, `.cmd` on
//!      Windows (PR #2152).
//!   3. What the launcher invokes: `...\node_modules\.bin\grok` with no
//!      extension, relying on cmd.exe's PATHEXT fallback.
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
use anyharness_lib::domains::agents::registry;

const AGENT_KIND: &str = "grok";

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
/// `installer/npm.rs` runs `Command::new("npm")`. On Windows, Node ships
/// `npm.cmd` and `npm` (a sh script) but no `npm.exe`, so whether this works
/// depends entirely on whether Rust's `std` process spawner applies `PATHEXT`
/// when resolving a bare program name. Assert it directly.
#[test]
fn command_new_npm_resolves_on_this_platform() {
    println!(
        "PATHEXT = {:?}",
        std::env::var("PATHEXT").unwrap_or_else(|_| "<unset>".into())
    );
    let result = Command::new("npm").arg("--version").output();
    match result {
        Ok(output) => {
            println!(
                "npm --version -> status {:?} stdout {:?} stderr {:?}",
                output.status,
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            );
            assert!(
                output.status.success(),
                "`Command::new(\"npm\")` ran but failed: {:?}",
                output
            );
        }
        Err(error) => panic!(
            "`Command::new(\"npm\")` could not be spawned: {error} (kind {:?}, raw os error {:?}). \
             This is installer/npm.rs's exact call shape.",
            error.kind(),
            error.raw_os_error()
        ),
    }
}

/// The whole path: install the managed agent, then spawn what the install
/// produced.
#[test]
fn installs_the_managed_agent_and_spawns_the_launcher_it_produces() {
    let runtime_home = scratch_runtime_home("install");
    println!("runtime_home = {}", runtime_home.display());

    // Real bundled catalog + real bundled registry: the same two documents the
    // shipped runtime boots with.
    let catalog = AgentCatalogService::new(Arc::new(CatalogSyncService::from_bundled()));
    let pins = catalog
        .pin_overrides(AGENT_KIND)
        .unwrap_or_else(|| panic!("{AGENT_KIND} must have catalog pins"));
    println!("catalog pins = {pins:?}");
    let descriptor = registry::descriptor(AGENT_KIND)
        .unwrap_or_else(|| panic!("{AGENT_KIND} must have a registry descriptor"));
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
            list_dir(
                "agent_process dir after failed install",
                &runtime_home
                    .join("agents")
                    .join(AGENT_KIND)
                    .join("agent_process"),
            );
            panic!("install_agent_with_pins failed: {error} (kind {:?})", error.kind());
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
    let artifact = installed
        .first()
        .expect("install must report at least one artifact");
    let launcher = artifact.path.clone();

    let managed_dir = runtime_home
        .join("agents")
        .join(AGENT_KIND)
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
