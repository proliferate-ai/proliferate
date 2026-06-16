use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};

use super::InstallError;

const CURL_CONNECT_TIMEOUT: &str = "10";
const CURL_MAX_TIME_DOWNLOAD: &str = "900";

pub(super) fn curl_download_binary(url: &str, dest: &Path) -> Result<(), InstallError> {
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
pub(super) fn curl_download_binary_verified(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
) -> Result<(), InstallError> {
    curl_download_binary(url, dest)?;
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
) -> Result<(), InstallError> {
    let staging_dir = managed_dir.join("_staging");
    let _ = std::fs::remove_dir_all(&staging_dir);
    std::fs::create_dir_all(&staging_dir)?;
    let archive_path = staging_dir.join("_archive.download");

    if let Err(e) = curl_download_binary(url, &archive_path)
        .and_then(|()| verify_sha256(url, &archive_path, expected_sha256))
    {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(e);
    }

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
