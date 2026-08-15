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
    cargo_build_command, is_elf_image, is_macho_image, is_pe_image, select_worker_launcher,
    CandidateRejection, CargoBuildRunner, DebugBuild, WorkerLauncher, WorkerLauncherError,
    ELF_MACHINE_AARCH64, ELF_MACHINE_X86_64, MACHO_CPU_TYPE_ARM64, MACHO_CPU_TYPE_X86_64,
    MACHO_FAT_MAGIC_64_BE, MACHO_FAT_MAGIC_BE, PE_MACHINE_ARM64, PE_MACHINE_X86_64,
    WORKER_MANIFEST,
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
            .env(FAKE_MANIFEST, workspace_root.join(WORKER_MANIFEST))
            .kill_on_drop(true);
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
        // Streams valid-shaped lines until the bounded parent reader kills
        // this process; exiting the loop naturally would mean the bound and
        // the kill both failed.
        "flood" => loop {
            println!("{near_miss}");
        },
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

    let selection =
        select_worker_launcher(Some(current.clone()), Some(debug_build()), &runner, || {
            scanned.set(true);
            Some(current_launcher())
        })
        .await
        .expect("select explicit launcher");

    let launcher = selection.launcher.expect("explicit launcher");
    assert_eq!(launcher.executable(), current.canonicalize().unwrap());
    assert_eq!(selection.invalid_override, None);
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

    let selection = select_worker_launcher(None, Some(debug_build()), &runner, || {
        scanned.set(true);
        Some(current_launcher())
    })
    .await
    .expect("prepare debug launcher");

    let launcher = selection.launcher.expect("debug launcher");
    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
    assert_eq!(selection.invalid_override, None);
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
async fn oversized_debug_build_output_is_killed_while_streaming() {
    let scanned = Cell::new(false);
    let runner = SelfReexecBuildRunner {
        mode: "flood",
        calls: Arc::new(AtomicUsize::new(0)),
    };

    // The flood build writes until killed, so this test completing at all
    // proves the reader bounds collection while the child runs and then
    // terminates and reaps it instead of buffering an unbounded pipe.
    let error = select_worker_launcher(None, Some(debug_build()), &runner, || {
        scanned.set(true);
        Some(current_launcher())
    })
    .await
    .expect_err("unbounded build output must fail closed");

    assert!(
        matches!(error, WorkerLauncherError::CargoOutputTooLarge),
        "{error}"
    );
    assert!(!scanned.get());
}

#[tokio::test(flavor = "current_thread")]
async fn missing_worker_manifest_is_classified_before_any_build() {
    let calls = Arc::new(AtomicUsize::new(0));
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::clone(&calls),
    };
    let missing_root = DebugBuild {
        cargo: PathBuf::from("/unused/fake-cargo"),
        workspace_root: std::env::temp_dir(),
    };

    let error = select_worker_launcher(None, Some(missing_root), &runner, || {
        panic!("missing manifest must not fall back to scan")
    })
    .await
    .expect_err("missing manifest must fail closed");

    assert!(
        matches!(error, WorkerLauncherError::DebugManifestUnavailable),
        "{error}"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "current_thread")]
async fn invalid_override_preserves_debug_build_precedence() {
    let calls = Arc::new(AtomicUsize::new(0));
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::clone(&calls),
    };

    let selection = select_worker_launcher(
        Some(workspace_root().join("Cargo.toml")),
        Some(debug_build()),
        &runner,
        || panic!("debug preparation must precede scan"),
    )
    .await
    .expect("invalid override falls through to debug build");

    assert_eq!(calls.load(Ordering::SeqCst), 1);
    let launcher = selection.launcher.expect("debug launcher");
    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
    let rejection = selection
        .invalid_override
        .expect("invalid override must surface a closed classification");
    assert!(matches!(
        rejection,
        CandidateRejection::NotExecutable | CandidateRejection::ImageFormatUnsupported
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn unavailable_override_is_classified_and_scan_still_runs() {
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::new(AtomicUsize::new(0)),
    };

    let selection = select_worker_launcher(
        Some(PathBuf::from("/nonexistent/proliferate-worker-override")),
        None,
        &runner,
        || Some(current_launcher()),
    )
    .await
    .expect("select scanned launcher");

    assert_eq!(
        selection.invalid_override,
        Some(CandidateRejection::Unavailable)
    );
    assert!(selection.launcher.is_some());
}

#[tokio::test(flavor = "current_thread")]
async fn scan_is_used_only_without_an_explicit_or_debug_preparer() {
    let runner = SelfReexecBuildRunner {
        mode: "success",
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let selection = select_worker_launcher(None, None, &runner, || Some(current_launcher()))
        .await
        .expect("select scanned launcher");

    let launcher = selection.launcher.expect("scanned launcher");
    assert_eq!(
        launcher.executable(),
        std::env::current_exe().unwrap().canonicalize().unwrap()
    );
    assert_eq!(selection.invalid_override, None);
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

    assert_eq!(
        WorkerLauncher::from_candidate(script_wrapper.path()).unwrap_err(),
        CandidateRejection::ImageFormatUnsupported
    );

    #[cfg(unix)]
    {
        let non_executable = TempFile::new("native", &[0xcf, 0xfa, 0xed, 0xfe], false);
        assert_eq!(
            WorkerLauncher::from_candidate(non_executable.path()).unwrap_err(),
            CandidateRejection::NotExecutable
        );
    }
}

#[test]
fn magic_prefixes_without_a_loadable_native_image_are_not_eligible() {
    let mut java_class = JAVA_CLASS_HEADER.to_vec();
    java_class.resize(256, 0);
    let java = TempFile::new("java-class", &java_class, true);
    assert_eq!(
        WorkerLauncher::from_candidate(java.path()).unwrap_err(),
        CandidateRejection::ImageFormatUnsupported
    );

    let mut bare_mz = b"MZ".to_vec();
    bare_mz.resize(256, 0);
    let mz = TempFile::new("bare-mz", &bare_mz, true);
    assert_eq!(
        WorkerLauncher::from_candidate(mz.path()).unwrap_err(),
        CandidateRejection::ImageFormatUnsupported
    );
}

/// Java class files begin with the fat Mach-O magic; bytes four through seven
/// are the class-format version (here 0x3d, Java 17) where a fat header keeps
/// its architecture count.
const JAVA_CLASS_HEADER: [u8; 8] = [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x3d];

fn thin_macho(cpu_type: u32) -> Vec<u8> {
    let mut image = vec![0xcf, 0xfa, 0xed, 0xfe];
    image.extend_from_slice(&cpu_type.to_le_bytes());
    image.resize(64, 0);
    image
}

fn fat_macho(magic: [u8; 4], arch_entry_bytes: usize, cpu_types: &[u32]) -> Vec<u8> {
    let mut image = magic.to_vec();
    image.extend_from_slice(&(cpu_types.len() as u32).to_be_bytes());
    for cpu_type in cpu_types {
        let mut entry = vec![0_u8; arch_entry_bytes];
        entry[..4].copy_from_slice(&cpu_type.to_be_bytes());
        image.extend_from_slice(&entry);
    }
    image
}

fn elf_image_bytes(class: u8, machine: u16) -> Vec<u8> {
    let mut image = vec![0x7f, b'E', b'L', b'F', class, 1, 1];
    image.resize(18, 0);
    image.extend_from_slice(&machine.to_le_bytes());
    image.resize(64, 0);
    image
}

fn pe_image_bytes(machine: u16) -> Vec<u8> {
    let mut image = b"MZ".to_vec();
    image.resize(0x3c, 0);
    image.extend_from_slice(&0x40_u32.to_le_bytes());
    image.extend_from_slice(b"PE\0\0");
    image.extend_from_slice(&machine.to_le_bytes());
    image.resize(0x80, 0);
    image
}

#[test]
fn thin_macho_requires_the_matching_architecture() {
    let arm64 = thin_macho(MACHO_CPU_TYPE_ARM64);
    assert!(is_macho_image(&arm64, MACHO_CPU_TYPE_ARM64));
    assert!(!is_macho_image(&arm64, MACHO_CPU_TYPE_X86_64));
    assert!(!is_macho_image(
        &thin_macho(MACHO_CPU_TYPE_X86_64),
        MACHO_CPU_TYPE_ARM64
    ));
    // 32-bit magic and truncated headers are rejected.
    assert!(!is_macho_image(
        &[0xce, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01],
        MACHO_CPU_TYPE_ARM64
    ));
    assert!(!is_macho_image(&arm64[..6], MACHO_CPU_TYPE_ARM64));
}

#[test]
fn fat_macho_requires_a_declared_matching_architecture() {
    let universal = fat_macho(
        MACHO_FAT_MAGIC_BE,
        20,
        &[MACHO_CPU_TYPE_X86_64, MACHO_CPU_TYPE_ARM64],
    );
    assert!(is_macho_image(&universal, MACHO_CPU_TYPE_ARM64));
    assert!(is_macho_image(&universal, MACHO_CPU_TYPE_X86_64));

    let x86_only = fat_macho(MACHO_FAT_MAGIC_BE, 20, &[MACHO_CPU_TYPE_X86_64]);
    assert!(!is_macho_image(&x86_only, MACHO_CPU_TYPE_ARM64));

    let fat64 = fat_macho(MACHO_FAT_MAGIC_64_BE, 32, &[MACHO_CPU_TYPE_ARM64]);
    assert!(is_macho_image(&fat64, MACHO_CPU_TYPE_ARM64));

    // Zero declared architectures and a header truncated before its declared
    // architecture table are both structurally invalid.
    assert!(!is_macho_image(
        &fat_macho(MACHO_FAT_MAGIC_BE, 20, &[]),
        MACHO_CPU_TYPE_ARM64
    ));
    assert!(!is_macho_image(&universal[..20], MACHO_CPU_TYPE_ARM64));
}

#[test]
fn java_class_magic_is_not_a_fat_macho() {
    let mut class_file = JAVA_CLASS_HEADER.to_vec();
    class_file.resize(4096, 0);
    assert!(!is_macho_image(&class_file, MACHO_CPU_TYPE_ARM64));
    assert!(!is_macho_image(&class_file, MACHO_CPU_TYPE_X86_64));
}

#[test]
fn elf_and_pe_images_require_structure_and_machine() {
    let elf = elf_image_bytes(2, ELF_MACHINE_X86_64);
    assert!(is_elf_image(&elf, ELF_MACHINE_X86_64));
    assert!(!is_elf_image(&elf, ELF_MACHINE_AARCH64));
    // 32-bit class is not loadable by the 64-bit targets.
    assert!(!is_elf_image(
        &elf_image_bytes(1, ELF_MACHINE_X86_64),
        ELF_MACHINE_X86_64
    ));

    let pe = pe_image_bytes(PE_MACHINE_X86_64);
    assert!(is_pe_image(&pe, PE_MACHINE_X86_64));
    assert!(!is_pe_image(&pe, PE_MACHINE_ARM64));
    // An arbitrary MZ prefix without a PE signature is rejected.
    let mut bare_mz = b"MZ".to_vec();
    bare_mz.resize(0x80, 0);
    assert!(!is_pe_image(&bare_mz, PE_MACHINE_X86_64));
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
