use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::acp_registry::{self, ResolvedRegistryDistribution};
use super::model::*;
use super::resolver::artifact_root;
use uuid::Uuid;

const CURL_CONNECT_TIMEOUT: &str = "10";
const CURL_MAX_TIME_METADATA: &str = "30";
const CURL_MAX_TIME_DOWNLOAD: &str = "900";

#[derive(Debug, Clone)]
pub struct InstalledArtifactResult {
    pub role: ArtifactRole,
    pub path: PathBuf,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct InstallOptions {
    pub reinstall: bool,
    pub native_version: Option<String>,
    pub agent_process_version: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("agent kind not installable via managed install")]
    NotInstallable,
    #[error("no compatible platform detected for native binary download")]
    UnsupportedPlatform,
    #[error("invalid install spec: {0}")]
    InvalidInstallSpec(String),
    #[error("failed to run install command `{program}`: {message}")]
    CommandFailed { program: String, message: String },
    #[error("managed artifact missing after install: {0}")]
    MissingManagedArtifact(PathBuf),
    #[error("network fetch failed: {url}: {message}")]
    FetchFailed { url: String, message: String },
    #[error("ACP registry error: {0}")]
    RegistryFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub fn install_agent(
    descriptor: &AgentDescriptor,
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Vec<InstalledArtifactResult>, InstallError> {
    let mut installed = Vec::new();
    let mut has_installable = false;

    tracing::info!(
        agent = descriptor.kind.as_str(),
        reinstall = options.reinstall,
        native_version = ?options.native_version,
        agent_process_version = ?options.agent_process_version,
        runtime_home = %runtime_home.display(),
        "starting managed agent install"
    );

    if let Some(native_spec) = &descriptor.native {
        if is_native_installable(&native_spec.install) {
            has_installable = true;
            if let Some(result) =
                install_native_artifact(native_spec, &descriptor.kind, runtime_home, options)?
            {
                tracing::info!(
                    agent = descriptor.kind.as_str(),
                    role = "native_cli",
                    path = %result.path.display(),
                    source = %result.source,
                    version = ?result.version,
                    "installed managed agent artifact"
                );
                installed.push(result);
            }
        }
    }

    if is_agent_process_installable(&descriptor.agent_process.install) {
        has_installable = true;
        if let Some(result) = install_agent_process_artifact(
            &descriptor.agent_process,
            &descriptor.kind,
            runtime_home,
            options,
        )? {
            tracing::info!(
                agent = descriptor.kind.as_str(),
                role = "agent_process",
                path = %result.path.display(),
                source = %result.source,
                version = ?result.version,
                "installed managed agent artifact"
            );
            installed.push(result);
        }
    }

    if !has_installable {
        return Err(InstallError::NotInstallable);
    }

    Ok(installed)
}

fn is_native_installable(spec: &NativeInstallSpec) -> bool {
    matches!(
        spec,
        NativeInstallSpec::DirectBinary { .. } | NativeInstallSpec::TarballRelease { .. }
    )
}

fn is_agent_process_installable(spec: &AgentProcessInstallSpec) -> bool {
    matches!(
        spec,
        AgentProcessInstallSpec::RegistryBacked { .. }
            | AgentProcessInstallSpec::ManagedNpmPackage { .. }
    )
}

// ---------------------------------------------------------------------------
// Native artifact install (atomic: download to temp, rename into place)
// ---------------------------------------------------------------------------

fn install_native_artifact(
    spec: &NativeArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);
    let target_path = managed_dir.join(kind.as_str());

    if is_valid_executable(&target_path) && !options.reinstall {
        return Ok(None);
    }

    std::fs::create_dir_all(&managed_dir)?;
    let temp_path = managed_dir.join(format!(".{}.downloading", kind.as_str()));

    match &spec.install {
        NativeInstallSpec::DirectBinary {
            binary_url_template,
            platform_map,
            latest_version_url,
        } => {
            let platform = Platform::detect().ok_or(InstallError::UnsupportedPlatform)?;
            let platform_str = platform_map
                .iter()
                .find(|(p, _)| *p == platform)
                .map(|(_, s)| s.as_str())
                .ok_or(InstallError::UnsupportedPlatform)?;

            let version = options.native_version.clone().unwrap_or_else(|| {
                latest_version_url
                    .as_ref()
                    .and_then(|url| curl_fetch_text(url).ok())
                    .unwrap_or_else(|| "latest".into())
                    .trim()
                    .to_string()
            });

            let url = binary_url_template
                .replace("{version}", &version)
                .replace("{platform}", platform_str);

            let result = curl_download_binary(&url, &temp_path);
            if result.is_err() {
                let _ = std::fs::remove_file(&temp_path);
                return Err(result.unwrap_err());
            }
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::NativeCli,
                path: target_path,
                source: "managed_download".into(),
                version: Some(version),
            }))
        }
        NativeInstallSpec::TarballRelease {
            latest_url_template,
            versioned_url_template,
            expected_binary_template,
            platform_map,
        } => {
            let platform = Platform::detect().ok_or(InstallError::UnsupportedPlatform)?;
            let target_triple = platform_map
                .iter()
                .find(|(p, _)| *p == platform)
                .map(|(_, s)| s.as_str())
                .ok_or(InstallError::UnsupportedPlatform)?;

            let url = match &options.native_version {
                Some(v) => versioned_url_template
                    .replace("{version}", v)
                    .replace("{target}", target_triple),
                None => latest_url_template.replace("{target}", target_triple),
            };
            let expected_binary = expected_binary_template.replace("{target}", target_triple);

            download_and_extract_tarball(&url, &expected_binary, &managed_dir, &temp_path)?;
            make_executable(&temp_path)?;
            std::fs::rename(&temp_path, &target_path)?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::NativeCli,
                path: target_path,
                source: "managed_release".into(),
                version: options.native_version.clone(),
            }))
        }
        NativeInstallSpec::PathOnly { .. } | NativeInstallSpec::Manual { .. } => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Agent-process artifact install (registry-backed or direct managed npm)
// ---------------------------------------------------------------------------

fn install_agent_process_artifact(
    spec: &AgentProcessArtifactSpec,
    kind: &AgentKind,
    runtime_home: &Path,
    options: &InstallOptions,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let managed_dir = artifact_root(runtime_home, kind, &ArtifactRole::AgentProcess);
    let launcher_path = managed_dir.join(format!("{}-launcher", kind.as_str()));
    let managed_native_dir = artifact_root(runtime_home, kind, &ArtifactRole::NativeCli);
    let managed_native_binary = managed_native_dir.join(kind.as_str());
    let launcher_path_prefixes = if is_valid_executable(&managed_native_binary) {
        vec![managed_native_dir.clone()]
    } else {
        Vec::new()
    };

    if launcher_path.exists() && !options.reinstall {
        return Ok(None);
    }

    match &spec.install {
        AgentProcessInstallSpec::RegistryBacked {
            registry_id,
            fallback,
        } => {
            match install_from_registry(
                registry_id,
                kind,
                &managed_dir,
                &launcher_path,
                options.agent_process_version.as_deref(),
                &launcher_path_prefixes,
            ) {
                Ok(result) => return Ok(Some(result)),
                Err(e) => {
                    tracing::warn!(
                        agent = kind.as_str(),
                        registry_id = registry_id,
                        error = %e,
                        "registry install failed, falling back to local install"
                    );
                }
            }

            install_agent_process_fallback(
                fallback,
                kind,
                &managed_dir,
                &launcher_path,
                options,
                &launcher_path_prefixes,
                if is_valid_executable(&managed_native_binary) {
                    Some(managed_native_binary)
                } else {
                    None
                },
            )
        }
        AgentProcessInstallSpec::ManagedNpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => install_managed_npm_package(
            package,
            package_subdir.as_deref(),
            source_build_binary_name.as_deref(),
            executable_relpath,
            &managed_dir,
            &launcher_path,
            options.agent_process_version.as_deref(),
            options.reinstall,
            &launcher_path_prefixes,
            "managed_npm",
        ),
        AgentProcessInstallSpec::PathOnly { .. } | AgentProcessInstallSpec::Manual { .. } => {
            Ok(None)
        }
    }
}

fn install_from_registry(
    registry_id: &str,
    _kind: &AgentKind,
    managed_dir: &Path,
    launcher_path: &Path,
    version_override: Option<&str>,
    path_prefixes: &[PathBuf],
) -> Result<InstalledArtifactResult, InstallError> {
    let resolved = acp_registry::resolve_from_registry(registry_id, version_override)
        .map_err(|e| InstallError::RegistryFailed(e.to_string()))?;

    std::fs::create_dir_all(managed_dir)?;

    match resolved {
        ResolvedRegistryDistribution::Npx {
            package,
            args,
            env,
            version,
        } => {
            let storage = managed_dir.join("registry_npm");
            if storage.exists() {
                let _ = std::fs::remove_dir_all(&storage);
            }
            acp_registry::install_npm_package(&storage, &package).map_err(|e| {
                InstallError::CommandFailed {
                    program: "npm".into(),
                    message: e,
                }
            })?;

            let bin_hint = registry_id.strip_suffix("-acp").unwrap_or(registry_id);
            let bin_name = format!("{bin_hint}");
            let npm_bin = storage.join("node_modules").join(".bin").join(&bin_name);
            let cmd_path = if npm_bin.exists() {
                npm_bin
            } else {
                find_npm_bin(&storage, registry_id)
                    .ok_or_else(|| InstallError::MissingManagedArtifact(npm_bin))?
            };

            generate_launcher_script(launcher_path, &cmd_path, &args, &env, path_prefixes)?;

            Ok(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "registry_npm".into(),
                version,
            })
        }
        ResolvedRegistryDistribution::Binary {
            archive_url,
            cmd,
            args,
            env,
            version,
        } => {
            let storage = managed_dir.join("registry_binary");
            let cmd_path = acp_registry::install_binary_archive(&archive_url, &cmd, &storage)
                .map_err(|e| InstallError::FetchFailed {
                    url: archive_url,
                    message: e,
                })?;

            generate_launcher_script(launcher_path, &cmd_path, &args, &env, path_prefixes)?;

            Ok(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "registry_binary".into(),
                version,
            })
        }
    }
}

fn find_npm_bin(storage_root: &Path, hint: &str) -> Option<PathBuf> {
    let bin_dir = storage_root.join("node_modules").join(".bin");
    if !bin_dir.exists() {
        return None;
    }
    for entry in std::fs::read_dir(&bin_dir).ok()?.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.contains(hint) {
            return Some(entry.path());
        }
    }
    std::fs::read_dir(&bin_dir)
        .ok()?
        .flatten()
        .next()
        .map(|e| e.path())
}

fn install_managed_npm_package(
    package: &str,
    package_subdir: Option<&Path>,
    source_build_binary_name: Option<&str>,
    executable_relpath: &Path,
    managed_dir: &Path,
    launcher_path: &Path,
    version_override: Option<&str>,
    force_reinstall: bool,
    path_prefixes: &[PathBuf],
    source: &str,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    let exec_path = if let Some(binary_name) = source_build_binary_name {
        managed_dir.join(platform_binary_filename(binary_name))
    } else {
        managed_dir.join(executable_relpath)
    };
    std::fs::create_dir_all(managed_dir)?;

    if force_reinstall || !exec_path.exists() || !launcher_path.exists() {
        let versioned_package = apply_npm_version_override(package, version_override);
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
        &[],
        &HashMap::new(),
        path_prefixes,
    )?;

    Ok(Some(InstalledArtifactResult {
        role: ArtifactRole::AgentProcess,
        path: launcher_path.to_path_buf(),
        source: if source_build_binary_name.is_some() {
            "managed_source_build".into()
        } else {
            source.into()
        },
        version: npm_package_version(&apply_npm_version_override(package, version_override)),
    }))
}

#[derive(Debug)]
struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Result<Self, InstallError> {
        let path = std::env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    fn path(&self) -> &Path {
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

fn run_command_capture(
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

fn apply_npm_version_override(package: &str, version_override: Option<&str>) -> String {
    if let Some(version) = version_override {
        if is_npm_non_registry_spec(package) {
            let base = package
                .split_once('#')
                .map_or(package, |(specifier, _)| specifier);
            return format!("{base}#{version}");
        }
    }

    match version_override {
        Some(version) => format!("{}@{version}", strip_npm_version(package)),
        None => package.to_string(),
    }
}

fn strip_npm_version(package: &str) -> &str {
    if let Some(scoped_package) = package.strip_prefix('@') {
        if let Some(version_separator) = scoped_package.rfind('@') {
            return &package[..version_separator + 1];
        }
        return package;
    }

    package.split_once('@').map_or(package, |(name, _)| name)
}

fn npm_package_version(package: &str) -> Option<String> {
    if is_npm_non_registry_spec(package) {
        return package
            .split_once('#')
            .map(|(_, version_or_ref)| version_or_ref.to_string());
    }

    if let Some(scoped_package) = package.strip_prefix('@') {
        return scoped_package
            .rsplit_once('@')
            .map(|(_, version)| version.to_string());
    }

    package
        .split_once('@')
        .map(|(_, version)| version.to_string())
}

fn is_npm_non_registry_spec(package: &str) -> bool {
    package.starts_with("git+")
        || package.starts_with("github:")
        || package.starts_with("file:")
        || package.starts_with("http://")
        || package.starts_with("https://")
}

fn install_agent_process_fallback(
    fallback: &AgentProcessFallback,
    kind: &AgentKind,
    managed_dir: &Path,
    launcher_path: &Path,
    options: &InstallOptions,
    path_prefixes: &[PathBuf],
    managed_native_binary: Option<PathBuf>,
) -> Result<Option<InstalledArtifactResult>, InstallError> {
    match fallback {
        AgentProcessFallback::NpmPackage {
            package,
            package_subdir,
            source_build_binary_name,
            executable_relpath,
        } => install_managed_npm_package(
            package,
            package_subdir.as_deref(),
            source_build_binary_name.as_deref(),
            executable_relpath,
            managed_dir,
            launcher_path,
            options.agent_process_version.as_deref(),
            options.reinstall,
            path_prefixes,
            "fallback_npm",
        ),
        AgentProcessFallback::NativeSubcommand { args } => {
            std::fs::create_dir_all(managed_dir)?;
            let native_exec = managed_native_binary.unwrap_or_else(|| PathBuf::from(kind.as_str()));
            generate_launcher_script(
                launcher_path,
                &native_exec,
                args,
                &HashMap::new(),
                path_prefixes,
            )?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "native_subcommand".into(),
                version: None,
            }))
        }
        AgentProcessFallback::BinaryHint {
            candidate_binaries,
            args,
        } => {
            let bin = candidate_binaries.first().cloned().unwrap_or_default();
            if bin.is_empty() {
                return Err(InstallError::NotInstallable);
            }
            std::fs::create_dir_all(managed_dir)?;
            generate_launcher_script(
                launcher_path,
                &PathBuf::from(&bin),
                args,
                &HashMap::new(),
                path_prefixes,
            )?;

            Ok(Some(InstalledArtifactResult {
                role: ArtifactRole::AgentProcess,
                path: launcher_path.to_path_buf(),
                source: "binary_hint".into(),
                version: None,
            }))
        }
    }
}

// ---------------------------------------------------------------------------
// Launcher script generation
// ---------------------------------------------------------------------------

fn generate_launcher_script(
    launcher_path: &Path,
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<(), InstallError> {
    let mut script = String::from("#!/bin/sh\nset -e\n");

    if !path_prefixes.is_empty() {
        let joined =
            std::env::join_paths(path_prefixes).map_err(|e| InstallError::CommandFailed {
                program: "launcher".into(),
                message: e.to_string(),
            })?;
        script.push_str(&format!(
            "export PATH='{}':\"$PATH\"\n",
            shell_escape(&joined.to_string_lossy())
        ));
    }

    for (key, value) in env {
        script.push_str(&format!("export {}='{}'\n", key, shell_escape(value)));
    }

    script.push_str(&format!("exec \"{}\"", exec_path.display()));
    for arg in extra_args {
        script.push(' ');
        script.push_str(&shell_escape(arg));
    }
    script.push_str(" \"$@\"\n");

    std::fs::write(launcher_path, script)?;
    make_executable(launcher_path)?;
    Ok(())
}

fn shell_escape(s: &str) -> String {
    if s.contains(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '\\') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

// ---------------------------------------------------------------------------
// Download / extraction helpers (with timeouts)
// ---------------------------------------------------------------------------

fn curl_fetch_text(url: &str) -> Result<String, InstallError> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            CURL_CONNECT_TIMEOUT,
            "--max-time",
            CURL_MAX_TIME_METADATA,
            url,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| InstallError::FetchFailed {
            url: url.into(),
            message: e.to_string(),
        })?;

    if !output.status.success() {
        return Err(InstallError::FetchFailed {
            url: url.into(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn curl_download_binary(url: &str, dest: &Path) -> Result<(), InstallError> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            CURL_CONNECT_TIMEOUT,
            "--max-time",
            CURL_MAX_TIME_DOWNLOAD,
            "-o",
        ])
        .arg(dest)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| InstallError::FetchFailed {
            url: url.into(),
            message: e.to_string(),
        })?;

    if !output.status.success() {
        return Err(InstallError::FetchFailed {
            url: url.into(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(())
}

fn download_and_extract_tarball(
    url: &str,
    expected_binary: &str,
    managed_dir: &Path,
    target_path: &Path,
) -> Result<(), InstallError> {
    let staging_dir = managed_dir.join("_staging");
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)?;

    let output = Command::new("sh")
        .args([
            "-c",
            &format!(
                "curl -fsSL --connect-timeout {} --max-time {} '{}' | tar xz -C '{}'",
                CURL_CONNECT_TIMEOUT,
                CURL_MAX_TIME_DOWNLOAD,
                url,
                staging_dir.display()
            ),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| InstallError::FetchFailed {
            url: url.into(),
            message: e.to_string(),
        })?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(InstallError::FetchFailed {
            url: url.into(),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    let extracted = staging_dir.join(expected_binary);
    if extracted.exists() {
        std::fs::rename(&extracted, target_path)?;
    } else if let Some(found) = find_binary_in_dir(&staging_dir, expected_binary) {
        std::fs::rename(&found, target_path)?;
    } else {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(InstallError::MissingManagedArtifact(PathBuf::from(
            expected_binary,
        )));
    }

    let _ = std::fs::remove_dir_all(&staging_dir);
    Ok(())
}

fn find_binary_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_binary_in_dir(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

/// Check whether a path points to a valid, executable file (not a partial download).
pub(crate) fn is_valid_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(meta) if meta.is_file() => meta.permissions().mode() & 0o111 != 0,
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), InstallError> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)?;
    Ok(())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), InstallError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use url::Url;

    #[test]
    fn direct_managed_npm_agent_processes_are_installable() {
        let install = AgentProcessInstallSpec::ManagedNpmPackage {
            package: "@proliferate/claude-agent-acp@0.24.2".into(),
            package_subdir: None,
            source_build_binary_name: None,
            executable_relpath: PathBuf::from("node_modules/.bin/claude-agent-acp"),
        };

        assert!(is_agent_process_installable(&install));
    }

    #[test]
    fn npm_version_override_rewrites_scoped_and_unscoped_packages() {
        assert_eq!(
            apply_npm_version_override("@proliferate/claude-agent-acp@0.24.2", Some("0.25.0")),
            "@proliferate/claude-agent-acp@0.25.0"
        );
        assert_eq!(
            apply_npm_version_override("@proliferate/claude-agent-acp", Some("0.25.0")),
            "@proliferate/claude-agent-acp@0.25.0"
        );
        assert_eq!(
            apply_npm_version_override("amp-acp@1.0.0", Some("1.2.3")),
            "amp-acp@1.2.3"
        );
        assert_eq!(
            apply_npm_version_override("amp-acp", Some("1.2.3")),
            "amp-acp@1.2.3"
        );
        assert_eq!(
            apply_npm_version_override(
                "git+https://github.com/proliferate-ai/claude-agent-acp.git#48cc672",
                Some("main")
            ),
            "git+https://github.com/proliferate-ai/claude-agent-acp.git#main"
        );
    }

    #[test]
    fn detects_versions_from_pinned_package_specs() {
        assert_eq!(
            npm_package_version("@proliferate/claude-agent-acp@0.24.2"),
            Some("0.24.2".into())
        );
        assert_eq!(npm_package_version("@proliferate/claude-agent-acp"), None);
        assert_eq!(npm_package_version("amp-acp@1.2.3"), Some("1.2.3".into()));
        assert_eq!(npm_package_version("amp-acp"), None);
        assert_eq!(
            npm_package_version(
                "git+https://github.com/proliferate-ai/claude-agent-acp.git#48cc672"
            ),
            Some("48cc672".into())
        );
    }

    #[test]
    fn managed_npm_package_without_subdir_still_installs_directly() {
        let package_root = TempDirGuard::new("npm-direct-package").expect("temp dir");
        write_test_npm_package(
            package_root.path(),
            "direct-test-agent",
            "direct-test-agent",
        );
        let managed_dir = TempDirGuard::new("npm-direct-managed").expect("managed dir");
        let launcher_path = managed_dir.path().join("direct-test-agent-launcher");

        let result = install_managed_npm_package(
            &format!("file:{}", package_root.path().display()),
            None,
            None,
            Path::new("node_modules/.bin/direct-test-agent"),
            managed_dir.path(),
            &launcher_path,
            None,
            true,
            &[],
            "managed_npm",
        )
        .expect("direct install should succeed");

        assert!(result.is_some());
        assert!(launcher_path.exists());
        assert!(managed_dir
            .path()
            .join("node_modules/.bin/direct-test-agent")
            .exists());
    }

    #[test]
    fn managed_npm_package_with_subdir_rejects_registry_specs() {
        let managed_dir = TempDirGuard::new("npm-invalid-managed").expect("managed dir");
        let launcher_path = managed_dir.path().join("invalid-launcher");
        let error = install_managed_npm_package(
            "@proliferate/claude-agent-acp",
            Some(Path::new("npm")),
            None,
            Path::new("node_modules/.bin/claude-agent-acp"),
            managed_dir.path(),
            &launcher_path,
            None,
            true,
            &[],
            "managed_npm",
        )
        .expect_err("registry package with subdir should be rejected");

        assert!(
            matches!(error, InstallError::InvalidInstallSpec(message) if message.contains("package_subdir is only supported"))
        );
    }

    #[test]
    fn managed_npm_package_with_subdir_installs_from_local_git_repo() {
        let repo_root = TempDirGuard::new("npm-git-source").expect("repo dir");
        let package_root = repo_root.path().join("npm");
        write_test_npm_package(&package_root, "git-test-agent", "git-test-agent");
        run_command_capture(
            "git",
            Command::new("git")
                .arg("init")
                .arg("--quiet")
                .arg(repo_root.path()),
        )
        .expect("git init");
        run_command_capture(
            "git",
            Command::new("git").arg("-C").arg(repo_root.path()).args([
                "config",
                "user.email",
                "test@example.com",
            ]),
        )
        .expect("git email");
        run_command_capture(
            "git",
            Command::new("git").arg("-C").arg(repo_root.path()).args([
                "config",
                "user.name",
                "Test User",
            ]),
        )
        .expect("git name");
        run_command_capture(
            "git",
            Command::new("git")
                .arg("-C")
                .arg(repo_root.path())
                .arg("add")
                .arg("."),
        )
        .expect("git add");
        run_command_capture(
            "git",
            Command::new("git")
                .arg("-C")
                .arg(repo_root.path())
                .args(["commit", "--quiet", "-m", "initial"]),
        )
        .expect("git commit");
        let rev_parse = run_command_capture(
            "git",
            Command::new("git")
                .arg("-C")
                .arg(repo_root.path())
                .args(["rev-parse", "HEAD"]),
        )
        .expect("git rev-parse");
        let revision = String::from_utf8_lossy(&rev_parse.stdout)
            .trim()
            .to_string();
        let repo_url = Url::from_directory_path(repo_root.path())
            .expect("file url")
            .to_string();

        let managed_dir = TempDirGuard::new("npm-git-managed").expect("managed dir");
        let launcher_path = managed_dir.path().join("git-test-agent-launcher");
        let result = install_managed_npm_package(
            &format!("git+{repo_url}#{revision}"),
            Some(Path::new("npm")),
            None,
            Path::new("node_modules/.bin/git-test-agent"),
            managed_dir.path(),
            &launcher_path,
            None,
            true,
            &[],
            "managed_npm",
        )
        .expect("git subdir install should succeed");

        assert!(result.is_some());
        assert!(launcher_path.exists());
        assert!(managed_dir
            .path()
            .join("node_modules/.bin/git-test-agent")
            .exists());
    }

    #[test]
    fn managed_npm_package_can_build_agent_binary_from_source() {
        let repo_root = TempDirGuard::new("source-build-agent").expect("repo dir");
        fs::create_dir_all(repo_root.path().join("src")).expect("create src dir");
        fs::write(
            repo_root.path().join("Cargo.toml"),
            r#"[package]
name = "source-build-agent"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "source-build-agent"
path = "src/main.rs"
"#,
        )
        .expect("write Cargo.toml");
        fs::write(
            repo_root.path().join("src/main.rs"),
            "fn main() { println!(\"ok\"); }\n",
        )
        .expect("write main.rs");

        let managed_dir = TempDirGuard::new("source-build-managed").expect("managed dir");
        let launcher_path = managed_dir.path().join("source-build-agent-launcher");
        let result = install_managed_npm_package(
            &format!("file:{}", repo_root.path().display()),
            None,
            Some("source-build-agent"),
            Path::new("source-build-agent"),
            managed_dir.path(),
            &launcher_path,
            None,
            true,
            &[],
            "managed_npm",
        )
        .expect("source build install should succeed");

        assert!(result.is_some());
        assert!(launcher_path.exists());
        assert!(managed_dir.path().join("source-build-agent").exists());
    }

    #[test]
    fn run_command_capture_includes_exit_status_with_stderr() {
        let error = run_command_capture(
            "sh",
            Command::new("sh")
                .arg("-c")
                .arg("echo compiling >&2; exit 9"),
        )
        .expect_err("command should fail");

        assert!(
            matches!(error, InstallError::CommandFailed { message, .. } if message.contains("exit status 9") && message.contains("compiling"))
        );
    }

    fn write_test_npm_package(package_root: &Path, package_name: &str, bin_name: &str) {
        fs::create_dir_all(package_root.join("bin")).expect("create bin dir");
        fs::write(
            package_root.join("package.json"),
            format!(
                "{{\n  \"name\": \"{package_name}\",\n  \"version\": \"0.0.1\",\n  \"bin\": {{ \"{bin_name}\": \"bin/{bin_name}.js\" }},\n  \"files\": [\"bin\"]\n}}\n"
            ),
        )
        .expect("write package.json");
        fs::write(
            package_root.join("bin").join(format!("{bin_name}.js")),
            "#!/usr/bin/env node\nconsole.log('ok');\n",
        )
        .expect("write bin");
    }
}
