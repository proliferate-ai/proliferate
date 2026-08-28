use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use super::packaging_contract::is_placeholder_executable;

const COLLECTOR_FILE_STEM: &str = "proliferate-diagnostics-collector";
const COLLECTOR_DEPS_PREFIX: &str = "proliferate_diagnostics_collector-";

static BUILT_COLLECTOR_BINARY: OnceLock<PathBuf> = OnceLock::new();

pub(super) fn built_collector_binary() -> PathBuf {
    BUILT_COLLECTOR_BINARY
        .get_or_init(|| resolve_built_collector_binary().unwrap_or_else(|error| panic!("{error}")))
        .clone()
}

fn resolve_built_collector_binary() -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("cannot locate the Desktop test executable: {error}"))?;
    let executable_dir = current_exe
        .parent()
        .ok_or_else(|| "Desktop test executable has no parent directory".to_owned())?;
    let profile_dir = executable_dir
        .file_name()
        .filter(|name| *name == "deps")
        .and_then(|_| executable_dir.parent())
        .unwrap_or(executable_dir);

    let deps_dir = profile_dir.join("deps");
    let fingerprint_dir = profile_dir.join(".fingerprint");
    let entries = fs::read_dir(&deps_dir)
        .map_err(|error| format!("cannot inspect {}: {error}", deps_dir.display()))?;
    let mut candidates = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let hash = collector_artifact_hash(&entry.file_name())?;
            let fingerprint = fingerprint_dir
                .join(format!("proliferate-diagnostics-collector-{hash}"))
                .join("bin-proliferate-diagnostics-collector");
            if !fingerprint.is_file() || !is_collector_main_binary(&entry.path()) {
                return None;
            }
            let freshness = fingerprint
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH);
            Some((freshness, entry.path()))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(compare_candidates);
    if let Some((_, path)) = candidates.pop() {
        return Ok(path);
    }

    let profile_binary = profile_dir.join(collector_file_name());
    is_collector_main_binary(&profile_binary)
        .then_some(profile_binary)
        .ok_or_else(|| {
            format!(
                "no real Cargo-built {COLLECTOR_FILE_STEM} binary was found under {}",
                profile_dir.display()
            )
        })
}

fn collector_file_name() -> &'static str {
    if cfg!(windows) {
        "proliferate-diagnostics-collector.exe"
    } else {
        COLLECTOR_FILE_STEM
    }
}

fn collector_artifact_hash(file_name: &std::ffi::OsStr) -> Option<String> {
    let file_name = file_name.to_str()?;
    let without_extension = if cfg!(windows) {
        file_name.strip_suffix(".exe")?
    } else {
        file_name
    };
    let hash = without_extension.strip_prefix(COLLECTOR_DEPS_PREFIX)?;
    (!hash.is_empty() && hash.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| hash.to_owned())
}

fn is_collector_main_binary(path: &Path) -> bool {
    if !is_executable_regular_file(path) || is_placeholder(path) {
        return false;
    }
    let Ok(output) = Command::new(path)
        .arg("--help")
        .stdin(Stdio::null())
        .output()
    else {
        return false;
    };
    let mut help = output.stdout;
    help.extend_from_slice(&output.stderr);
    output.status.success()
        && contains(&help, b"--capability-fd")
        && contains(&help, b"--control-fd")
        && !contains(&help, b"--include-ignored")
        && !contains(&help, b"[FILTERS...]")
}

fn is_executable_regular_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.file_type().is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    true
}

fn is_placeholder(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return true;
    };
    let mut prefix = [0_u8; 512];
    let Ok(read) = file.read(&mut prefix) else {
        return true;
    };
    is_placeholder_executable(&prefix[..read])
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn compare_candidates(
    (left_time, left_path): &(SystemTime, PathBuf),
    (right_time, right_path): &(SystemTime, PathBuf),
) -> std::cmp::Ordering {
    left_time
        .cmp(right_time)
        .then_with(|| left_path.cmp(right_path))
}
