use std::{
    cell::Cell,
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use serde_json::json;
use tokio::process::Command;

use super::{
    cargo_build_command, select_worker_launcher, CargoBuildRunner, DebugBuild, WorkerLauncher,
    WorkerLauncherError, WORKER_MANIFEST,
};

const FAKE_BUILD_MODE: &str = "PROLIFERATE_LAUNCHER_TEST_BUILD_MODE";
const FAKE_MANIFEST: &str = "PROLIFERATE_LAUNCHER_TEST_MANIFEST";

struct SelfReexecBuildRunner {
    mode: &'static str,
    calls: Arc<AtomicUsize>,
}

impl CargoBuildRunner for SelfReexecBuildRunner {
    fn command(&self, _cargo: &Path, workspace_root: &Path) -> Command {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut command = Command::new(std::env::current_exe().expect("resolve test executable"));
        command
            .arg("launcher_fake_build_process")
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(FAKE_BUILD_MODE, self.mode)
            .env(FAKE_MANIFEST, workspace_root.join(WORKER_MANIFEST));
        command
    }
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("canonical workspace root")
}

fn debug_build() -> DebugBuild {
    DebugBuild {
        cargo: PathBuf::from("/unused/fake-cargo"),
        workspace_root: workspace_root(),
    }
}

fn current_launcher() -> WorkerLauncher {
    WorkerLauncher::from_candidate(
        &std::env::current_exe().expect("resolve current test executable"),
    )
    .expect("test executable is a native executable")
}

#[test]
fn launcher_fake_build_process() {
    let Ok(mode) = std::env::var(FAKE_BUILD_MODE) else {
        return;
    };
    let manifest = std::env::var(FAKE_MANIFEST).expect("fake manifest path");
    let executable = std::env::current_exe().expect("resolve fake artifact");

    let exact = json!({
        "reason": "compiler-artifact",
        "package_id": "path+file:///workspace#proliferate-worker@0.1.0",
        "manifest_path": manifest,
        "target": { "name": "proliferate-worker", "kind": ["bin"] },
        "executable": executable.clone(),
    });
    let near_miss = json!({
        "reason": "compiler-artifact",
        "manifest_path": PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
        "target": { "name": "proliferate-worker", "kind": ["bin"] },
        "executable": executable,
    });

    // Libtest may print `test <name> ... ` without a newline before uncaptured
    // output. Start a fresh line so Cargo-shaped messages remain exact lines.
    println!();
    match mode.as_str() {
        "success" => {
            println!("not cargo json and intentionally ignored");
            println!("{near_miss}");
            println!("{exact}");
        }
        "duplicate" => {
            println!("{exact}");
            println!("{exact}");
        }
        "missing" => println!("{near_miss}"),
        "malformed" => println!("{{not-json"),
        "failure" => std::process::exit(23),
        other => panic!("unknown fake build mode {other}"),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn explicit_native_override_wins_without_build_or_scan() {
    let calls = Arc::new(AtomicUsize::new(0));
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::clone(&calls),
    };
    let scanned = Cell::new(false);
    let current = std::env::current_exe().expect("resolve current test executable");

    let launcher =
        select_worker_launcher(Some(current.clone()), Some(debug_build()), &runner, || {
            scanned.set(true);
            Some(current_launcher())
        })
        .await
        .expect("select explicit launcher")
        .expect("explicit launcher");

    assert_eq!(launcher.executable(), current.canonicalize().unwrap());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(!scanned.get());
}

#[tokio::test(flavor = "current_thread")]
async fn debug_preparer_uses_exact_self_reexec_artifact_before_scan() {
    let calls = Arc::new(AtomicUsize::new(0));
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::clone(&calls),
    };
    let scanned = Cell::new(false);

    let launcher = select_worker_launcher(None, Some(debug_build()), &runner, || {
        scanned.set(true);
        Some(current_launcher())
    })
    .await
    .expect("prepare debug launcher")
    .expect("debug launcher");

    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(!scanned.get());
}

#[tokio::test(flavor = "current_thread")]
async fn failed_or_ambiguous_debug_build_never_falls_back_to_stale_scan() {
    for (mode, expected) in [
        ("failure", "debug build failed"),
        ("duplicate", "multiple executables"),
        ("missing", "no exact executable"),
        ("malformed", "invalid Cargo JSON"),
    ] {
        let scanned = Cell::new(false);
        let runner = SelfReexecBuildRunner {
            mode,
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let error = select_worker_launcher(None, Some(debug_build()), &runner, || {
            scanned.set(true);
            Some(current_launcher())
        })
        .await
        .expect_err("debug preparation must fail closed");

        assert!(error.to_string().contains(expected), "{error}");
        assert!(!scanned.get(), "{mode} unexpectedly scanned stale binaries");
    }
}

#[tokio::test(flavor = "current_thread")]
async fn invalid_override_preserves_debug_build_precedence() {
    let calls = Arc::new(AtomicUsize::new(0));
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::clone(&calls),
    };

    let launcher = select_worker_launcher(
        Some(workspace_root().join("Cargo.toml")),
        Some(debug_build()),
        &runner,
        || panic!("debug preparation must precede scan"),
    )
    .await
    .expect("invalid override falls through to debug build")
    .expect("debug launcher");

    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn scan_is_used_only_without_an_explicit_or_debug_preparer() {
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let launcher = select_worker_launcher(None, None, &runner, || Some(current_launcher()))
        .await
        .expect("select scanned launcher")
        .expect("scanned launcher");

    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
}

#[test]
fn production_preparer_builds_but_never_runs_or_wraps_the_worker() {
    let command = cargo_build_command(Path::new("/toolchain/cargo"), Path::new("/workspace"));
    let command = command.as_std();
    let args = command.get_args().collect::<Vec<_>>();

    assert_eq!(command.get_program(), OsStr::new("/toolchain/cargo"));
    assert_eq!(command.get_current_dir(), Some(Path::new("/workspace")));
    assert_eq!(
        args,
        [
            "build",
            "--locked",
            "--package",
            "proliferate-worker",
            "--bin",
            "proliferate-worker",
            "--message-format=json",
            "--color=never",
        ]
        .map(OsStr::new)
    );
    assert!(!args.contains(&OsStr::new("run")));

    let removed_env = command
        .get_envs()
        .filter_map(|(name, value)| value.is_none().then_some(name))
        .collect::<Vec<_>>();
    for env_var in super::DESKTOP_DEV_CARGO_RUNNER_ENV_VARS {
        assert!(removed_env.contains(&OsStr::new(env_var)));
    }
}

#[test]
fn launcher_command_directly_executes_only_the_prepared_binary() {
    let launcher = current_launcher();
    let command = launcher.command(Path::new("/worker/config.toml"));
    let command = command.as_std();

    assert_eq!(command.get_program(), launcher.executable().as_os_str());
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        ["--config", "/worker/config.toml"].map(OsStr::new)
    );
}

#[test]
fn executable_script_wrappers_and_non_executables_are_not_eligible() {
    let script_wrapper = TempFile::new(
        "script-wrapper",
        b"#!/bin/sh\nexec proliferate-worker \"$@\"\n",
        true,
    );

    assert!(matches!(
        WorkerLauncher::from_candidate(script_wrapper.path()),
        Err(WorkerLauncherError::ExecutableInvalid(_))
    ));

    #[cfg(unix)]
    {
        let non_executable = TempFile::new("native", &[0xcf, 0xfa, 0xed, 0xfe], false);
        assert!(matches!(
            WorkerLauncher::from_candidate(non_executable.path()),
            Err(WorkerLauncherError::ExecutableInvalid(_))
        ));
    }
}

struct TempFile {
    path: PathBuf,
}

impl TempFile {
    fn new(label: &str, bytes: &[u8], executable: bool) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "proliferate-launcher-{}-{label}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, bytes).expect("write temporary launcher fixture");
        set_executable(&path, executable);
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(unix)]
fn set_executable(path: &Path, executable: bool) {
    use std::os::unix::fs::PermissionsExt;

    let mode = if executable { 0o700 } else { 0o600 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .expect("set temporary fixture permissions");
}

#[cfg(not(unix))]
fn set_executable(_path: &Path, _executable: bool) {}
