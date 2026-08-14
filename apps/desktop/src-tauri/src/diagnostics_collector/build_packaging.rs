use std::env;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::packaging_contract::is_placeholder_executable;
use super::{copy_executable, find_named_binary, mark_executable, write_placeholder_sidecar};

pub(super) fn stage_dependency_placeholders() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|e| e.to_string())?;
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir).map_err(|e| e.to_string())?;

    for binary in ["proliferate-debug", "anyharness", "proliferate-worker"] {
        let suffix = if target.contains("windows") {
            ".exe"
        } else {
            ""
        };
        let destination = binaries_dir.join(format!("{binary}-{target}{suffix}"));
        if !destination.exists() {
            write_placeholder_sidecar(&destination, &target)?;
        }
    }
    ensure_collector_placeholder(&binaries_dir, &target)
}

pub(super) fn validate_staged_sidecars() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|e| e.to_string())?;
    let suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    for binary in [
        "anyharness",
        "proliferate-worker",
        "proliferate-debug",
        "proliferate-diagnostics-collector",
    ] {
        let path = manifest_dir
            .join("binaries")
            .join(format!("{binary}-{target}{suffix}"));
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.file_type().is_file() || metadata.len() == 0 {
            return Err(format!(
                "{} is not a non-empty regular file",
                path.display()
            ));
        }
        let mut prefix = [0_u8; 512];
        let read = fs::File::open(&path)
            .and_then(|mut file| file.read(&mut prefix))
            .map_err(|error| error.to_string())?;
        let unsupported_collector = binary == "proliferate-diagnostics-collector"
            && !is_supported_diagnostics_collector_target(&target);
        if is_placeholder_executable(&prefix[..read]) && !unsupported_collector {
            return Err(format!("{} is a placeholder", path.display()));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(format!("{} is not executable", path.display()));
            }
        }
    }
    Ok(())
}

pub(super) fn ensure_collector_placeholder(
    binaries_dir: &Path,
    target: &str,
) -> Result<(), String> {
    let suffix = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    let destination = binaries_dir.join(format!(
        "proliferate-diagnostics-collector-{target}{suffix}"
    ));
    if !destination.exists() {
        write_collector_placeholder(&destination, target)?;
    }
    Ok(())
}

pub(super) fn stage_diagnostics_collector_binary() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|e| e.to_string())?;
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir).map_err(|e| e.to_string())?;
    let dest_name = if target.contains("windows") {
        format!("proliferate-diagnostics-collector-{target}.exe")
    } else {
        format!("proliferate-diagnostics-collector-{target}")
    };
    let dest = binaries_dir.join(dest_name);

    if !is_supported_diagnostics_collector_target(&target) {
        write_collector_placeholder(&dest, &target)?;
        println!(
            "cargo:warning=staged unsupported-target diagnostics collector placeholder for {target}"
        );
        return Ok(());
    }

    match resolve_diagnostics_collector_binary(&manifest_dir, &target, &profile) {
        Ok(source) => {
            copy_executable(&source, &dest)?;
            println!(
                "cargo:warning=staged diagnostics collector from {}",
                source.display()
            );
            println!("cargo:warning=collector resource path {}", dest.display());
            Ok(())
        }
        Err(error) if profile != "release" => {
            write_collector_placeholder(&dest, &target)?;
            println!(
                "cargo:warning=staged diagnostics collector placeholder for supported debug target {target}: {error}"
            );
            Ok(())
        }
        Err(error) => Err(error),
    }
}

pub(super) fn register_diagnostics_collector_rerun_inputs() {
    let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let collector_dir = PathBuf::from(manifest_dir)
        .join("../../../anyharness/crates/proliferate-diagnostics-collector");
    if collector_dir.is_dir() {
        println!("cargo:rerun-if-changed={}", collector_dir.display());
    }
}

pub(super) fn resolve_diagnostics_collector_binary(
    manifest_dir: &Path,
    target: &str,
    profile: &str,
) -> Result<PathBuf, String> {
    if let Ok(explicit) = env::var("PROLIFERATE_DIAGNOSTICS_COLLECTOR_BIN") {
        let explicit = PathBuf::from(explicit);
        if explicit.is_file() {
            return Ok(explicit);
        }
        return Err(format!(
            "PROLIFERATE_DIAGNOSTICS_COLLECTOR_BIN does not name a file for {target}"
        ));
    }

    let repo_root = manifest_dir.join("../../..");
    find_named_binary(
        &repo_root,
        target,
        profile,
        "proliferate-diagnostics-collector",
    )
    .ok_or_else(|| {
        format!(
            "could not find prebuilt proliferate-diagnostics-collector for supported target {target}; build package proliferate-diagnostics-collector first (debug builds may set PROLIFERATE_DIAGNOSTICS_COLLECTOR_BIN)"
        )
    })
}

pub(super) fn write_collector_placeholder(dest: &Path, target: &str) -> Result<(), String> {
    if target.contains("windows") {
        fs::write(dest, b"proliferate diagnostics collector placeholder")
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' 'Proliferate diagnostics collector placeholder is not available for target {target}.' >&2\nexit 1\n"
    );
    fs::write(dest, script).map_err(|e| e.to_string())?;
    mark_executable(dest)
}

pub(super) fn is_supported_diagnostics_collector_target(target: &str) -> bool {
    matches!(target, "aarch64-apple-darwin" | "x86_64-apple-darwin")
}
