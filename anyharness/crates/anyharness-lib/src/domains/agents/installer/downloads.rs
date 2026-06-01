use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::InstallError;

const CURL_CONNECT_TIMEOUT: &str = "10";
const CURL_MAX_TIME_METADATA: &str = "30";
const CURL_MAX_TIME_DOWNLOAD: &str = "900";

pub(super) fn curl_fetch_text(url: &str) -> Result<String, InstallError> {
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

pub(super) fn download_and_extract_tarball(
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
