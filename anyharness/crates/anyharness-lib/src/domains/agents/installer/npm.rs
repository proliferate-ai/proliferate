use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::managed_npm::{
    apply_npm_version_override, installed_npm_package_version, managed_npm_install_issue,
    npm_package_version, source_build_install_issue, write_managed_npm_source_marker,
};
use super::downloads::activate_local_tree;
use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::model::ArtifactRole;
use crate::integrations::agent_cli::executable::{make_executable, platform_binary_filename};
use crate::integrations::agent_cli::launcher::{
    generate_launcher_script, generate_launcher_script_atomic,
};
use uuid::Uuid;

pub(super) fn install_managed_npm_package(
    package: &str,
    package_subdir: Option<&Path>,
    source_build_binary_name: Option<&str>,
    executable_relpath: &Path,
    managed_dir: &Path,
    launcher_path: &Path,
    version_override: Option<&str>,
    force_reinstall: bool,
    launcher_args: &[String],
    path_prefixes: &[PathBuf],
    launcher_env: &std::collections::HashMap<String, String>,
    source: &str,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let versioned_package = apply_npm_version_override(package, version_override);

    // Path (relative to a managed/staged tree root) of the executable the
    // launcher points at. Source builds land at the tree root; npm/git installs
    // land under node_modules.
    let exec_relpath: PathBuf = if let Some(binary_name) = source_build_binary_name {
        platform_binary_filename(binary_name)
    } else {
        executable_relpath.to_path_buf()
    };
    let active_exec = managed_dir.join(&exec_relpath);

    // Staleness is judged against the ACTIVE (live) tree, never a staging tree.
    let package_issue = if source_build_binary_name.is_none() {
        managed_npm_install_issue(&versioned_package, managed_dir)
    } else {
        source_build_install_issue(&versioned_package, managed_dir)
    };

    let tree_needs_install = force_reinstall || !active_exec.exists() || package_issue.is_some();

    if tree_needs_install {
        if let Some(issue) = package_issue.as_ref() {
            tracing::info!(
                package = %versioned_package,
                managed_dir = %managed_dir.display(),
                issue = %issue,
                "refreshing managed npm agent package (staged swap)"
            );
        }
        tracing::info!(
            package = %versioned_package,
            package_subdir = ?package_subdir.map(|path| path.display().to_string()),
            source_build_binary_name = ?source_build_binary_name,
            managed_dir = %managed_dir.display(),
            launcher_path = %launcher_path.display(),
            "installing managed npm agent package into staging, then atomically swapping"
        );
        stage_and_swap_managed_npm_tree(
            &versioned_package,
            package_subdir,
            source_build_binary_name,
            &exec_relpath,
            managed_dir,
            launcher_path,
            launcher_args,
            path_prefixes,
            launcher_env,
        )?;
    } else {
        // The live tree is healthy — never reinstall over it. Keep the running
        // inode and just refresh the launcher through the atomic promoter so
        // env/arg changes still take effect.
        std::fs::create_dir_all(managed_dir)?;
        if !active_exec.exists() {
            return Err(InstallError::MissingManagedArtifact(active_exec));
        }
        generate_launcher_script_atomic(
            launcher_path,
            &active_exec,
            launcher_args,
            launcher_env,
            path_prefixes,
        )?;
    }

    // Read the installed version from the ACTIVE tree; after a swap this is the
    // newly promoted tree.
    let version = installed_npm_package_version(&versioned_package, managed_dir)
        .or_else(|| npm_package_version(&versioned_package));

    Ok(Some(InstalledArtifactResult {
        role: ArtifactRole::AgentProcess,
        path: launcher_path.to_path_buf(),
        source: if source_build_binary_name.is_some() {
            "managed_source_build".into()
        } else {
            source.into()
        },
        version,
    }))
}

/// Build the complete managed adapter tree in a sibling `.{name}.staging`
/// directory (never touching the live `node_modules`), then atomically swap it
/// into `managed_dir` and promote the launcher through the same
/// `ArchiveTreeActivation` used by the archive adapter arm. A running managed
/// session keeps the old tree's inode until commit; a promotion failure rolls
/// the whole tree and the previous launcher back (FR-3 / R2.5).
#[allow(clippy::too_many_arguments)]
fn stage_and_swap_managed_npm_tree(
    versioned_package: &str,
    package_subdir: Option<&Path>,
    source_build_binary_name: Option<&str>,
    exec_relpath: &Path,
    managed_dir: &Path,
    launcher_path: &Path,
    launcher_args: &[String],
    path_prefixes: &[PathBuf],
    launcher_env: &std::collections::HashMap<String, String>,
) -> Result<(), InstallError> {
    let parent = managed_dir.parent().ok_or_else(|| {
        InstallError::InvalidInstallSpec("managed adapter dir has no parent".into())
    })?;
    let name = managed_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("agent_process");
    let staging_dir = parent.join(format!(".{name}.staging"));

    // Build the full final tree in staging. Marker writes (subdir/source-build)
    // land INSIDE the staged tree so post-swap staleness checks read them from
    // the active tree.
    let build = (|| -> Result<(), InstallError> {
        let _ = std::fs::remove_dir_all(&staging_dir);
        std::fs::create_dir_all(&staging_dir)?;
        if let Some(binary_name) = source_build_binary_name {
            install_managed_source_build_binary(versioned_package, &staging_dir, binary_name)?;
        } else if let Some(package_subdir) = package_subdir {
            install_managed_npm_package_from_subdir(versioned_package, package_subdir, &staging_dir)?;
        } else {
            install_npm_package_into_prefix(versioned_package, &staging_dir)?;
        }
        let staged_exec = staging_dir.join(exec_relpath);
        if !staged_exec.exists() {
            tracing::error!(
                package = %versioned_package,
                staging_dir = %staging_dir.display(),
                staged_exec = %staged_exec.display(),
                available_bin_entries = ?read_dir_entry_names(&staging_dir.join("node_modules").join(".bin")),
                available_node_modules = ?read_dir_entry_names(&staging_dir.join("node_modules")),
                "managed npm staging install completed but expected executable was not created"
            );
            return Err(InstallError::MissingManagedArtifact(staged_exec));
        }
        Ok(())
    })();
    if let Err(error) = build {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(error);
    }

    // Swap the whole staged tree into the live location, then promote the
    // launcher within the same transaction.
    let mut activation = activate_local_tree(managed_dir, &staging_dir, Some(launcher_path))?;
    let prepared = (|| -> Result<(), InstallError> {
        let final_exec = managed_dir.join(exec_relpath);
        // The staged launcher lives OUTSIDE the swapped tree so the tree rename
        // cannot move it; `activate_launcher` renames it into the live tree.
        let staged_launcher = parent.join(format!(".{name}-launcher.next"));
        let _ = std::fs::remove_file(&staged_launcher);
        generate_launcher_script(
            &staged_launcher,
            &final_exec,
            launcher_args,
            launcher_env,
            path_prefixes,
        )?;
        activation.activate_launcher(&staged_launcher)?;
        Ok(())
    })();

    match prepared {
        Ok(()) => {
            activation.commit()?;
            Ok(())
        }
        Err(error) => Err(activation.rollback_after(error)),
    }
}

#[derive(Debug)]
pub(super) struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    pub(super) fn new(prefix: &str) -> Result<Self, InstallError> {
        let path = std::env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn install_managed_npm_package_from_subdir(
    package: &str,
    package_subdir: &Path,
    managed_dir: &Path,
) -> Result<(), InstallError> {
    if package_subdir.is_absolute() {
        return Err(InstallError::InvalidInstallSpec(format!(
            "package_subdir must be relative, got {}",
            package_subdir.display()
        )));
    }

    let staging = TempDirGuard::new("npm-subdir")?;
    let source_root = materialize_npm_package_source(package, staging.path())?;
    let package_dir = resolve_npm_package_subdir(&source_root, package_subdir)?;
    let tarball_path = pack_npm_package_dir(&package_dir, staging.path())?;
    install_npm_package_into_prefix(&tarball_path.to_string_lossy(), managed_dir)?;
    // The managed prefix's npm metadata only references the temporary tarball,
    // so staleness checks need the original spec recorded alongside it.
    write_managed_npm_source_marker(package, managed_dir)?;
    Ok(())
}

fn install_managed_source_build_binary(
    package: &str,
    managed_dir: &Path,
    binary_name: &str,
) -> Result<(), InstallError> {
    let staging = TempDirGuard::new("source-build")?;
    let source_root = materialize_npm_package_source(package, staging.path())?;
    build_cargo_binary_from_source(&source_root, binary_name, managed_dir)?;
    // Source builds leave no npm metadata behind, so the marker is the only
    // way staleness checks can detect a later git-pin bump and rebuild.
    write_managed_npm_source_marker(package, managed_dir)?;
    Ok(())
}

fn materialize_npm_package_source(
    package: &str,
    staging_root: &Path,
) -> Result<PathBuf, InstallError> {
    if package.starts_with("git+") {
        return clone_git_package_source(package, staging_root);
    }

    if package.starts_with("file:") {
        return resolve_file_package_source(package);
    }

    Err(InstallError::InvalidInstallSpec(format!(
        "package_subdir is only supported for git+ and file: package specs, got {package}"
    )))
}

fn clone_git_package_source(package: &str, staging_root: &Path) -> Result<PathBuf, InstallError> {
    let without_prefix = package.strip_prefix("git+").ok_or_else(|| {
        InstallError::InvalidInstallSpec(format!("unsupported git package spec: {package}"))
    })?;
    let (repo_url, git_ref) = without_prefix
        .split_once('#')
        .map_or((without_prefix, None), |(url, reference)| {
            (url, Some(reference))
        });
    let source_root = staging_root.join("source");

    run_command_capture(
        "git",
        Command::new("git")
            .arg("clone")
            .arg("--quiet")
            .arg(repo_url)
            .arg(&source_root),
    )?;

    if let Some(git_ref) = git_ref.filter(|reference| !reference.is_empty()) {
        run_command_capture(
            "git",
            Command::new("git")
                .arg("-C")
                .arg(&source_root)
                .arg("checkout")
                .arg("--quiet")
                .arg(git_ref),
        )?;
    }

    Ok(source_root)
}

fn resolve_file_package_source(package: &str) -> Result<PathBuf, InstallError> {
    if let Ok(url) = url::Url::parse(package) {
        if url.scheme() == "file" {
            let path = url.to_file_path().map_err(|_| {
                InstallError::InvalidInstallSpec(format!(
                    "could not resolve file package path: {package}"
                ))
            })?;
            if path.is_dir() {
                return Ok(path);
            }
            return Err(InstallError::InvalidInstallSpec(format!(
                "file package source is not a directory: {}",
                path.display()
            )));
        }
    }

    let raw_path = package.strip_prefix("file:").ok_or_else(|| {
        InstallError::InvalidInstallSpec(format!("unsupported file package spec: {package}"))
    })?;
    let path = PathBuf::from(raw_path);
    let resolved = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    if resolved.is_dir() {
        Ok(resolved)
    } else {
        Err(InstallError::InvalidInstallSpec(format!(
            "file package source is not a directory: {}",
            resolved.display()
        )))
    }
}

fn resolve_npm_package_subdir(
    source_root: &Path,
    package_subdir: &Path,
) -> Result<PathBuf, InstallError> {
    let source_root = source_root.canonicalize()?;
    let package_dir = source_root.join(package_subdir);
    if !package_dir.exists() {
        return Err(InstallError::InvalidInstallSpec(format!(
            "package_subdir {} does not exist inside {}",
            package_subdir.display(),
            source_root.display()
        )));
    }

    let package_dir = package_dir.canonicalize()?;
    if !package_dir.starts_with(&source_root) {
        return Err(InstallError::InvalidInstallSpec(format!(
            "package_subdir {} escapes source root {}",
            package_subdir.display(),
            source_root.display()
        )));
    }

    let package_json = package_dir.join("package.json");
    if !package_json.is_file() {
        return Err(InstallError::InvalidInstallSpec(format!(
            "package_subdir {} does not contain package.json",
            package_subdir.display()
        )));
    }

    Ok(package_dir)
}

fn pack_npm_package_dir(package_dir: &Path, staging_root: &Path) -> Result<PathBuf, InstallError> {
    let output = run_command_capture(
        "npm",
        Command::new("npm")
            .arg("pack")
            .arg("--pack-destination")
            .arg(staging_root)
            .current_dir(package_dir),
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let tarball_name = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| InstallError::CommandFailed {
            program: "npm".into(),
            message: format!(
                "npm pack did not report a tarball name for {}",
                package_dir.display()
            ),
        })?
        .to_string();
    let tarball_path = staging_root.join(&tarball_name);
    if !tarball_path.is_file() {
        return Err(InstallError::CommandFailed {
            program: "npm".into(),
            message: format!(
                "npm pack did not create expected tarball {}",
                tarball_path.display()
            ),
        });
    }
    Ok(tarball_path)
}

fn build_cargo_binary_from_source(
    source_root: &Path,
    binary_name: &str,
    managed_dir: &Path,
) -> Result<(), InstallError> {
    let manifest_path = source_root.join("Cargo.toml");
    if !manifest_path.is_file() {
        return Err(InstallError::InvalidInstallSpec(format!(
            "source build requested but {} does not contain Cargo.toml",
            source_root.display()
        )));
    }

    let target_dir = managed_dir.join("source-build-target");
    let mut command = Command::new("cargo");
    command
        .arg("build")
        .arg("-j")
        .arg("1")
        .arg("--bin")
        .arg(binary_name)
        .current_dir(source_root)
        .env("CARGO_TARGET_DIR", &target_dir)
        .env("CARGO_INCREMENTAL", "0")
        .env("CARGO_BUILD_JOBS", "1")
        .env("RUSTFLAGS", "-C debuginfo=0")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if source_root.join("Cargo.lock").is_file() {
        command.arg("--locked");
    }
    run_command_capture("cargo", &mut command)?;

    let built_binary = target_dir
        .join("debug")
        .join(platform_binary_filename(binary_name));
    if !built_binary.is_file() {
        return Err(InstallError::MissingManagedArtifact(built_binary));
    }

    let installed_binary = managed_dir.join(platform_binary_filename(binary_name));
    if let Some(parent) = installed_binary.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&built_binary, &installed_binary)?;
    make_executable(&installed_binary)?;

    Ok(())
}

fn install_npm_package_into_prefix(package: &str, managed_dir: &Path) -> Result<(), InstallError> {
    run_command_capture(
        "npm",
        Command::new("npm")
            .args(["install", "--no-audit", "--no-fund", "--prefix"])
            .arg(managed_dir)
            .arg(package)
            .stdout(Stdio::null())
            .stderr(Stdio::piped()),
    )
    .map(|_| ())
}

pub(super) fn run_command_capture(
    program: &str,
    command: &mut Command,
) -> Result<std::process::Output, InstallError> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(output);
    }

    let status_message = output
        .status
        .code()
        .map(|code| format!("exit status {code}"))
        .unwrap_or_else(|| format!("terminated by signal: {}", output.status));
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(InstallError::CommandFailed {
        program: program.into(),
        message: if stderr.is_empty() {
            status_message
        } else {
            format!("{status_message}\n{stderr}")
        },
    })
}

fn read_dir_entry_names(dir: &Path) -> Vec<String> {
    let mut entries: Vec<String> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    entries.sort();
    entries
}
