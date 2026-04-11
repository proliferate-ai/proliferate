use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-env-changed=ANYHARNESS_BIN");
    println!("cargo:rerun-if-env-changed=TAURI_ENV_TARGET_TRIPLE");
    println!("cargo:rerun-if-env-changed=TARGET");
    println!("cargo:rerun-if-env-changed=PROFILE");
    propagate_native_telemetry_env();
    register_anyharness_rerun_inputs();

    if let Err(err) = stage_anyharness_binary() {
        panic!("failed to stage AnyHarness sidecar binary: {err}");
    }

    tauri_build::build()
}

fn propagate_native_telemetry_env() {
    const NATIVE_TELEMETRY_ENV_KEYS: &[&str] = &[
        "PROLIFERATE_DESKTOP_SENTRY_DSN",
        "PROLIFERATE_DESKTOP_SENTRY_ENVIRONMENT",
        "PROLIFERATE_DESKTOP_SENTRY_RELEASE",
        "PROLIFERATE_DESKTOP_SENTRY_TRACES_SAMPLE_RATE",
        "ANYHARNESS_SENTRY_DSN",
        "ANYHARNESS_SENTRY_ENVIRONMENT",
        "ANYHARNESS_SENTRY_RELEASE",
        "ANYHARNESS_SENTRY_TRACES_SAMPLE_RATE",
        "VITE_PROLIFERATE_API_BASE_URL",
        "VITE_PROLIFERATE_TELEMETRY_DISABLED",
    ];

    for key in NATIVE_TELEMETRY_ENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");

        if let Ok(value) = env::var(key) {
            if !value.trim().is_empty() {
                let propagated_key = match *key {
                    "VITE_PROLIFERATE_API_BASE_URL" => "PROLIFERATE_DEFAULT_API_BASE_URL",
                    "VITE_PROLIFERATE_TELEMETRY_DISABLED" => "PROLIFERATE_BUILD_TELEMETRY_DISABLED",
                    _ => key,
                };
                println!("cargo:rustc-env={propagated_key}={value}");
            }
        }
    }
}

fn stage_anyharness_binary() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .map_err(|e| e.to_string())?;
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());

    let binaries_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&binaries_dir).map_err(|e| e.to_string())?;
    let dest_name = if target.contains("windows") {
        format!("anyharness-{target}.exe")
    } else {
        format!("anyharness-{target}")
    };
    let dest = binaries_dir.join(dest_name);

    if !is_supported_sidecar_target(&target) {
        write_placeholder_sidecar(&dest, &target)?;
        println!(
            "cargo:warning=staged placeholder AnyHarness sidecar for unsupported target {target}; set ANYHARNESS_BIN to override"
        );
        return Ok(());
    }

    let source = resolve_anyharness_binary(&manifest_dir, &target, &profile)?;
    copy_executable(&source, &dest)?;

    println!(
        "cargo:warning=staged AnyHarness sidecar from {}",
        source.display()
    );
    println!("cargo:warning=sidecar resource path {}", dest.display());
    Ok(())
}

fn resolve_anyharness_binary(
    manifest_dir: &Path,
    target: &str,
    profile: &str,
) -> Result<PathBuf, String> {
    if let Ok(explicit) = env::var("ANYHARNESS_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
    }

    let repo_candidates = anyharness_repo_candidates(manifest_dir);
    let existing_repos: Vec<&PathBuf> = repo_candidates.iter().filter(|p| p.is_dir()).collect();

    if let Some(primary_repo) = existing_repos.first() {
        if let Some(path) = find_existing_binary(primary_repo, target, profile) {
            return Ok(path);
        }
        build_anyharness(primary_repo, target, profile)?;
        if let Some(path) = find_existing_binary(primary_repo, target, profile) {
            return Ok(path);
        }
    }

    for repo in existing_repos.iter().skip(1) {
        if let Some(path) = find_existing_binary(repo, target, profile) {
            return Ok(path);
        }
    }

    for repo in existing_repos.iter().skip(1) {
        build_anyharness(repo, target, profile)?;
        if let Some(path) = find_existing_binary(repo, target, profile) {
            return Ok(path);
        }
    }

    let path_candidates = [
        home_dir().map(|h| h.join(".cargo/bin/anyharness")),
        Some(PathBuf::from("/usr/local/bin/anyharness")),
        Some(PathBuf::from("/opt/homebrew/bin/anyharness")),
    ];
    for candidate in path_candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "could not find or build anyharness for target {target}; tried ANYHARNESS_BIN, sibling repos, and common install locations"
    ))
}

fn register_anyharness_rerun_inputs() {
    let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") else {
        return;
    };
    let manifest_dir = PathBuf::from(manifest_dir);

    for repo in anyharness_repo_candidates(&manifest_dir) {
        if repo.is_dir() {
            println!("cargo:rerun-if-changed={}", repo.display());
        }
    }
}

fn anyharness_repo_candidates(manifest_dir: &Path) -> Vec<PathBuf> {
    let candidates = vec![
        manifest_dir.join("../../anyharness"),
        manifest_dir.join("../../../anyharness"),
        manifest_dir.join("../../../anyharness-acp-chat-surface"),
        manifest_dir.join("../../../anyharness-git-slice"),
        manifest_dir.join("../../../anyharness-files"),
    ];

    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique
            .iter()
            .any(|existing: &PathBuf| existing == &candidate)
        {
            unique.push(candidate);
        }
    }
    unique
}

fn build_anyharness(repo_root: &Path, target: &str, profile: &str) -> Result<(), String> {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(repo_root)
        .env("CARGO_TARGET_DIR", repo_root.join("target"))
        .arg("build")
        .arg("-p")
        .arg("anyharness")
        .arg("--target")
        .arg(target);

    if profile == "release" {
        cmd.arg("--release");
    }

    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "cargo build -p anyharness failed in {}",
            repo_root.display()
        ))
    }
}

fn find_existing_binary(repo_root: &Path, target: &str, profile: &str) -> Option<PathBuf> {
    let bin_name = if target.contains("windows") {
        "anyharness.exe"
    } else {
        "anyharness"
    };

    let candidates = [
        repo_root
            .join("target")
            .join(target)
            .join(profile)
            .join(bin_name),
        repo_root.join("target").join(profile).join(bin_name),
    ];

    candidates.into_iter().find(|p| p.is_file())
}

fn copy_executable(source: &Path, dest: &Path) -> Result<(), String> {
    if paths_refer_to_same_file(source, dest) {
        mark_executable(dest)?;
        return Ok(());
    }

    fs::copy(source, dest).map_err(|e| e.to_string())?;
    mark_executable(dest)?;

    Ok(())
}

fn paths_refer_to_same_file(source: &Path, dest: &Path) -> bool {
    if source == dest {
        return true;
    }

    match (fs::canonicalize(source), fs::canonicalize(dest)) {
        (Ok(source), Ok(dest)) => source == dest,
        _ => false,
    }
}

fn write_placeholder_sidecar(dest: &Path, target: &str) -> Result<(), String> {
    if target.contains("windows") {
        fs::write(dest, b"unsupported target placeholder").map_err(|e| e.to_string())?;
        return Ok(());
    }

    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' 'AnyHarness sidecar is not available for target {target}.' >&2\nexit 1\n"
    );
    fs::write(dest, script).map_err(|e| e.to_string())?;
    mark_executable(dest)?;
    Ok(())
}

fn mark_executable(dest: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(dest, perms).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn home_dir() -> Option<PathBuf> {
    env::var("HOME").ok().map(PathBuf::from)
}

fn is_supported_sidecar_target(target: &str) -> bool {
    matches!(
        target,
        "aarch64-apple-darwin"
            | "x86_64-apple-darwin"
            | "x86_64-unknown-linux-musl"
            | "aarch64-unknown-linux-musl"
            | "x86_64-pc-windows-msvc"
            | "aarch64-pc-windows-msvc"
    )
}
