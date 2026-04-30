use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::agents::installer::is_valid_executable;

use super::types::{AgentSeedManifest, SeedError};
use super::MANIFEST_SCHEMA_VERSION;

pub(super) fn verify_archive_checksum(
    archive_path: &Path,
    checksum_path: &Path,
) -> Result<(), SeedError> {
    let expected = fs::read_to_string(checksum_path)?
        .split_whitespace()
        .next()
        .map(str::to_string)
        .ok_or(SeedError::InvalidChecksum)?;
    let actual = checksum_file(archive_path)?;
    if !expected.eq_ignore_ascii_case(&actual) {
        return Err(SeedError::InvalidChecksum);
    }
    Ok(())
}

pub(super) fn read_manifest_from_archive(
    archive_path: &Path,
) -> Result<AgentSeedManifest, SeedError> {
    let file = File::open(archive_path)?;
    let decoder = zstd::stream::read::Decoder::new(file)?;
    let mut archive = tar::Archive::new(decoder);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        if is_archive_root_path(&path) {
            continue;
        }
        if validate_relative_path(&path)? == Path::new("manifest.json") {
            let mut raw = String::new();
            entry.read_to_string(&mut raw)?;
            return Ok(serde_json::from_str(&raw)?);
        }
    }
    Err(SeedError::InvalidManifest("manifest.json missing".into()))
}

pub(super) fn validate_manifest(
    manifest: &AgentSeedManifest,
    target: &str,
) -> Result<(), SeedError> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(SeedError::InvalidManifest(format!(
            "unsupported schema version {}",
            manifest.schema_version
        )));
    }
    if manifest.target != target {
        return Err(SeedError::UnsupportedTarget);
    }
    let mut seen = HashSet::new();
    for artifact in &manifest.artifacts {
        validate_relative_path(&artifact.path)?;
        if !seen.insert(artifact.path.clone()) {
            return Err(SeedError::InvalidManifest(format!(
                "duplicate artifact {}",
                artifact.path
            )));
        }
        if artifact.kind.trim().is_empty()
            || artifact.role.trim().is_empty()
            || artifact.sha256.trim().is_empty()
        {
            return Err(SeedError::InvalidManifest(format!(
                "incomplete artifact {}",
                artifact.path
            )));
        }
    }
    Ok(())
}

pub(super) fn extract_archive_securely(
    archive_path: &Path,
    staging: &Path,
) -> Result<(), SeedError> {
    let file = File::open(archive_path)?;
    let decoder = zstd::stream::read::Decoder::new(file)?;
    let mut archive = tar::Archive::new(decoder);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.to_path_buf();
        if is_archive_root_path(&entry_path) {
            continue;
        }
        let rel_path = validate_relative_path(&entry_path)?;
        validate_tar_entry(&entry, &rel_path)?;
        let dest = staging.join(rel_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        entry.unpack(&dest)?;
    }
    Ok(())
}

fn is_archive_root_path(path: &Path) -> bool {
    path.as_os_str().is_empty() || path == Path::new(".")
}

fn validate_tar_entry<R: Read>(entry: &tar::Entry<'_, R>, path: &Path) -> Result<(), SeedError> {
    let entry_type = entry.header().entry_type();
    if entry_type.is_file() || entry_type.is_dir() {
        return Ok(());
    }

    if entry_type.is_symlink() || entry_type.is_hard_link() {
        let link = entry.link_name().map_err(SeedError::Io)?.ok_or_else(|| {
            SeedError::InvalidArchive(format!("missing link target for {path:?}"))
        })?;
        validate_archive_link_target(path, &link)?;
        return Ok(());
    }

    Err(SeedError::InvalidArchive(format!(
        "unsupported archive entry {:?} at {}",
        entry_type,
        path.display()
    )))
}

pub(super) fn validate_relative_path(path: impl AsRef<Path>) -> Result<PathBuf, SeedError> {
    let path = path.as_ref();
    if path.as_os_str().is_empty() {
        return Err(SeedError::InvalidArchive("empty archive path".into()));
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(SeedError::InvalidArchive(format!(
                    "unsafe archive path {}",
                    path.display()
                )));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(SeedError::InvalidArchive("empty archive path".into()));
    }
    Ok(clean)
}

pub(super) fn validate_archive_link_target(path: &Path, target: &Path) -> Result<(), SeedError> {
    if target.as_os_str().is_empty() || target.is_absolute() {
        return Err(SeedError::InvalidArchive(format!(
            "unsafe archive link target {} for {}",
            target.display(),
            path.display()
        )));
    }

    let base = path.parent().unwrap_or_else(|| Path::new(""));
    let combined = base.join(target);
    let mut clean = PathBuf::new();
    for component in combined.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !clean.pop() {
                    return Err(SeedError::InvalidArchive(format!(
                        "archive link target escapes root: {} -> {}",
                        path.display(),
                        target.display()
                    )));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(SeedError::InvalidArchive(format!(
                    "unsafe archive link target {} for {}",
                    target.display(),
                    path.display()
                )));
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return Err(SeedError::InvalidArchive(format!(
            "archive link target resolves to root: {} -> {}",
            path.display(),
            target.display()
        )));
    }
    Ok(())
}

pub(super) fn verify_seed_executables(
    runtime_home: &Path,
    manifest: &AgentSeedManifest,
) -> Result<(), SeedError> {
    for artifact in manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.executable)
    {
        let rel = validate_relative_path(&artifact.path)?;
        let path = runtime_home.join(rel);
        if !is_valid_executable(&path) {
            return Err(SeedError::VerificationFailed(format!(
                "{} is not executable",
                artifact.path
            )));
        }
    }
    Ok(())
}

pub(super) fn checksum_path(path: &Path) -> Result<String, std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(path)?;
        let mut hasher = Sha256::new();
        hasher.update(b"symlink:");
        hasher.update(target.to_string_lossy().as_bytes());
        return Ok(to_hex(&hasher.finalize()));
    }
    checksum_file(path)
}

fn checksum_file(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(to_hex(&hasher.finalize()))
}

fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}
