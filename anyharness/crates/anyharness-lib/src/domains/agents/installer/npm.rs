use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::{InstallError, InstalledArtifactResult};
use crate::domains::agents::managed_npm::{
    apply_npm_version_override, installed_npm_package_version, managed_npm_install_issue,
    npm_package_version,
};
use crate::domains::agents::model::ArtifactRole;
use crate::integrations::agent_cli::executable::make_executable;
use crate::integrations::agent_cli::launcher::generate_launcher_script;
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
    let exec_path = if let Some(binary_name) = source_build_binary_name {
        managed_dir.join(platform_binary_filename(binary_name))
    } else {
        managed_dir.join(executable_relpath)
    };
    std::fs::create_dir_all(managed_dir)?;

    let package_issue = if source_build_binary_name.is_none() {
        managed_npm_install_issue(&versioned_package, managed_dir)
    } else {
        None
    };

    if force_reinstall || !exec_path.exists() || !launcher_path.exists() || package_issue.is_some()
    {
        if let Some(issue) = package_issue.as_ref() {
            tracing::info!(
                package = %versioned_package,
                managed_dir = %managed_dir.display(),
                issue = %issue,
                "refreshing managed npm agent package"
            );
        }
        tracing::info!(
            package = %versioned_package,
            package_subdir = ?package_subdir.map(|path| path.display().to_string()),
            source_build_binary_name = ?source_build_binary_name,
            managed_dir = %managed_dir.display(),
            launcher_path = %launcher_path.display(),
            exec_path = %exec_path.display(),
            "installing managed npm agent package"
        );
        if let Some(binary_name) = source_build_binary_name {
            install_managed_source_build_binary(&versioned_package, managed_dir, binary_name)?;
        } else if let Some(package_subdir) = package_subdir {
            install_managed_npm_package_from_subdir(
                &versioned_package,
                package_subdir,
                managed_dir,
            )?;
        } else {
            install_npm_package_into_prefix(&versioned_package, managed_dir)?;
        }
    }

    if !exec_path.exists() {
        tracing::error!(
            package = %apply_npm_version_override(package, version_override),
            managed_dir = %managed_dir.display(),
            launcher_path = %launcher_path.display(),
            exec_path = %exec_path.display(),
            available_bin_entries = ?read_dir_entry_names(&managed_dir.join("node_modules").join(".bin")),
            available_node_modules = ?read_dir_entry_names(&managed_dir.join("node_modules")),
            "managed npm install completed but expected executable was not created"
        );
        return Err(InstallError::MissingManagedArtifact(exec_path));
    }

    generate_launcher_script(
        launcher_path,
        &exec_path,
        launcher_args,
        launcher_env,
        path_prefixes,
    )?;

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
    install_npm_package_into_prefix(&tarball_path.to_string_lossy(), managed_dir)
}

fn install_managed_source_build_binary(
    package: &str,
    managed_dir: &Path,
    binary_name: &str,
) -> Result<(), InstallError> {
    let staging = TempDirGuard::new("source-build")?;
    let source_root = materialize_npm_package_source(package, staging.path())?;
    build_cargo_binary_from_source(&source_root, binary_name, managed_dir)
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

fn platform_binary_filename(binary_name: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(format!("{binary_name}.exe"))
    } else {
        PathBuf::from(binary_name)
    }
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
