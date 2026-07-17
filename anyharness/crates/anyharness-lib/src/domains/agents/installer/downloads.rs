use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use sha2::{Digest, Sha256};

#[path = "downloads/activation.rs"]
mod activation;

use super::progress::{InstallProgressPhase, InstallProgressReporter};
use super::InstallError;
use crate::domains::agents::model::ArtifactRole;
use activation::ArchiveTreeActivation;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(900);
const DOWNLOAD_BUFFER_BYTES: usize = 256 * 1024;

fn download_binary(
    url: &str,
    dest: &Path,
    expected_size: Option<u64>,
    reporter: Option<&InstallProgressReporter>,
    role: &ArtifactRole,
) -> Result<(), InstallError> {
    let result = download_binary_inner(url, dest, expected_size, reporter, role);
    if result.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    result
}

fn download_binary_inner(
    url: &str,
    dest: &Path,
    expected_size: Option<u64>,
    reporter: Option<&InstallProgressReporter>,
    role: &ArtifactRole,
) -> Result<(), InstallError> {
    let mut source: Box<dyn Read>;
    let observed_size: Option<u64>;

    if url.starts_with("file:") {
        let source_path = url::Url::parse(url)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .ok_or_else(|| InstallError::FetchFailed {
                url: url.into(),
                message: "invalid file URL".into(),
            })?;
        let file =
            std::fs::File::open(&source_path).map_err(|error| InstallError::FetchFailed {
                url: url.into(),
                message: error.to_string(),
            })?;
        observed_size = file.metadata().ok().map(|metadata| metadata.len());
        source = Box::new(file);
    } else {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT)
            .build()
            .map_err(|error| InstallError::FetchFailed {
                url: url.into(),
                message: error.to_string(),
            })?;
        let response = client
            .get(url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| InstallError::FetchFailed {
                url: url.into(),
                message: error.to_string(),
            })?;
        observed_size = response.content_length();
        source = Box::new(response);
    }

    let total = expected_size.or(observed_size);
    reporter.map(|reporter| reporter.report(role, InstallProgressPhase::Downloading, 0, total));

    let mut destination = std::fs::File::create(dest)?;
    let mut downloaded = 0u64;
    let mut buffer = vec![0u8; DOWNLOAD_BUFFER_BYTES];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| InstallError::FetchFailed {
                url: url.into(),
                message: error.to_string(),
            })?;
        if read == 0 {
            break;
        }
        destination.write_all(&buffer[..read])?;
        downloaded = downloaded.saturating_add(read as u64);
        reporter.map(|reporter| {
            reporter.report(role, InstallProgressPhase::Downloading, downloaded, total)
        });
    }
    destination.flush()?;

    if let Some(expected) = expected_size {
        if downloaded != expected {
            return Err(InstallError::FetchFailed {
                url: url.into(),
                message: format!("expected {expected} bytes, downloaded {downloaded}"),
            });
        }
    }
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

/// Lowercase-hex sha256 of a file, streamed.
fn sha256_hex(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Verify a downloaded file against an expected sha256. On mismatch the file is
/// removed and a `ChecksumMismatch` error is returned — this is the trust
/// anchor for fenced, catalog-pinned installs.
fn verify_sha256(url: &str, path: &Path, expected: &str) -> Result<(), InstallError> {
    let actual = sha256_hex(path)?;
    if !actual.eq_ignore_ascii_case(expected) {
        let _ = std::fs::remove_file(path);
        return Err(InstallError::ChecksumMismatch {
            url: url.to_string(),
            expected: expected.to_string(),
            actual,
        });
    }
    Ok(())
}

/// Download a single binary and verify its sha256 before it is used.
pub(super) fn download_binary_verified(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    expected_size: Option<u64>,
    reporter: Option<&InstallProgressReporter>,
    role: &ArtifactRole,
) -> Result<(), InstallError> {
    download_binary(url, dest, expected_size, reporter, role)?;
    let downloaded = std::fs::metadata(dest)?.len();
    reporter.map(|reporter| {
        reporter.report(
            role,
            InstallProgressPhase::Verifying,
            downloaded,
            expected_size.or(Some(downloaded)),
        )
    });
    verify_sha256(url, dest, expected_sha256)
}

/// Download an archive (`.tar.gz`/`.tgz` or `.zip`) to a temp file, verify its
/// sha256, then extract and place `expected_binary` at `target_path`.
pub(super) fn download_and_extract_archive_verified(
    url: &str,
    expected_binary: &str,
    managed_dir: &Path,
    target_path: &Path,
    expected_sha256: &str,
    expected_size: Option<u64>,
    reporter: Option<&InstallProgressReporter>,
    role: &ArtifactRole,
) -> Result<(), InstallError> {
    let staging_dir = managed_dir.join("_staging");
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)?;
    let archive_path = staging_dir.join("_archive.download");

    if let Err(e) = download_binary_verified(
        url,
        &archive_path,
        expected_sha256,
        expected_size,
        reporter,
        role,
    ) {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(e);
    }

    let downloaded = std::fs::metadata(&archive_path)?.len();
    reporter.map(|reporter| {
        reporter.report(
            role,
            InstallProgressPhase::Extracting,
            downloaded,
            expected_size.or(Some(downloaded)),
        )
    });

    let is_zip = url.ends_with(".zip");
    let extract = if is_zip {
        Command::new("unzip")
            .arg("-q")
            .arg(&archive_path)
            .arg("-d")
            .arg(&staging_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    } else {
        Command::new("tar")
            .arg("xzf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&staging_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    };
    let output = extract.map_err(|e| InstallError::FetchFailed {
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

/// Download an archive, verify its sha256, and extract the WHOLE tree into
/// `dest_dir`, preserving every file. Use this for multi-file adapter bundles
/// (e.g. cursor) whose entry binary execs its sibling files — extracting only
/// the entry binary would break them. Download and extraction happen in a
/// sibling staging directory; the previous live tree is retained until the
/// staged tree has passed checksum verification and extraction.
pub(super) fn download_and_extract_archive_tree_verified(
    url: &str,
    dest_dir: &Path,
    expected_sha256: &str,
    expected_size: Option<u64>,
    reporter: Option<&InstallProgressReporter>,
    role: &ArtifactRole,
    launcher_path: Option<&Path>,
) -> Result<ArchiveTreeActivation, InstallError> {
    let parent = dest_dir.parent().ok_or_else(|| {
        InstallError::InvalidInstallSpec("archive destination has no parent".into())
    })?;
    let name = dest_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("archive-tree");
    let staging_dir = parent.join(format!(".{name}.staging"));
    std::fs::create_dir_all(parent)?;
    ArchiveTreeActivation::recover(dest_dir, launcher_path)?;
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)?;
    let archive_path = staging_dir.join("_archive.download");

    if let Err(e) = download_binary_verified(
        url,
        &archive_path,
        expected_sha256,
        expected_size,
        reporter,
        role,
    ) {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(e);
    }

    let downloaded = std::fs::metadata(&archive_path)?.len();
    reporter.map(|reporter| {
        reporter.report(
            role,
            InstallProgressPhase::Extracting,
            downloaded,
            expected_size.or(Some(downloaded)),
        )
    });

    let is_zip = url.ends_with(".zip");
    let extract = if is_zip {
        Command::new("unzip")
            .arg("-q")
            .arg(&archive_path)
            .arg("-d")
            .arg(&staging_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    } else {
        Command::new("tar")
            .arg("xzf")
            .arg(&archive_path)
            .arg("-C")
            .arg(&staging_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    };
    let output = extract.map_err(|e| InstallError::FetchFailed {
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
    // Keep the extracted tree; drop only the downloaded archive, then swap it
    // into place with a recoverable previous-tree rename.
    let _ = std::fs::remove_file(&archive_path);
    ArchiveTreeActivation::activate_tree(dest_dir, &staging_dir, launcher_path)
}

#[cfg(test)]
#[path = "downloads_tests.rs"]
mod tests;
