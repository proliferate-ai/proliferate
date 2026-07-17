use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::progress::{InstallProgressPhase, InstallProgressReporter};
use super::InstallError;
use crate::domains::agents::model::ArtifactRole;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(900);
const DOWNLOAD_BUFFER_BYTES: usize = 256 * 1024;

#[derive(Debug)]
pub(super) struct ArchiveTreeActivation {
    dest_dir: PathBuf,
    backup_dir: PathBuf,
    marker_path: PathBuf,
    launcher_path: Option<PathBuf>,
    launcher_backup_path: Option<PathBuf>,
    launcher_activated: bool,
    committed: bool,
}

impl ArchiveTreeActivation {
    pub(super) fn activate_launcher(&mut self, staged_launcher: &Path) -> Result<(), InstallError> {
        let Some(launcher_path) = self.launcher_path.as_ref() else {
            return Err(InstallError::InvalidInstallSpec(
                "archive activation has no launcher path".into(),
            ));
        };
        let launcher_backup = self.launcher_backup_path.as_ref().ok_or_else(|| {
            InstallError::InvalidInstallSpec("archive activation has no launcher backup".into())
        })?;
        let _ = std::fs::remove_file(launcher_backup);
        if launcher_path.exists() {
            std::fs::rename(launcher_path, launcher_backup)?;
        }
        if let Err(error) = std::fs::rename(staged_launcher, launcher_path) {
            if launcher_backup.exists() {
                let _ = std::fs::rename(launcher_backup, launcher_path);
            }
            return Err(InstallError::Io(error));
        }
        self.launcher_activated = true;
        Ok(())
    }

    /// Keep the newly activated tree. Backup cleanup is deliberately best-effort:
    /// an inability to remove the old tree must not roll back a working install.
    pub(super) fn commit(mut self) -> Result<(), InstallError> {
        let marker = std::fs::File::create(&self.marker_path)?;
        marker.sync_all()?;
        self.committed = true;
        let _ = std::fs::remove_dir_all(&self.backup_dir);
        if let Some(launcher_backup) = &self.launcher_backup_path {
            let _ = std::fs::remove_file(launcher_backup);
        }
        if !self.backup_dir.exists()
            && self
                .launcher_backup_path
                .as_ref()
                .is_none_or(|path| !path.exists())
        {
            let _ = std::fs::remove_file(&self.marker_path);
        }
        Ok(())
    }
}

impl Drop for ArchiveTreeActivation {
    fn drop(&mut self) {
        if self.committed {
            return;
        }

        if self.launcher_activated {
            if let Some(launcher_path) = &self.launcher_path {
                let _ = std::fs::remove_file(launcher_path);
                if let Some(launcher_backup) = &self.launcher_backup_path {
                    if launcher_backup.exists() {
                        let _ = std::fs::rename(launcher_backup, launcher_path);
                    }
                }
            }
        }
        let _ = std::fs::remove_dir_all(&self.dest_dir);
        if self.backup_dir.exists() {
            let _ = std::fs::rename(&self.backup_dir, &self.dest_dir);
        }
    }
}

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
    let backup_dir = parent.join(format!(".{name}.previous"));
    let marker_path = parent.join(format!(".{name}.activation-committed"));
    let launcher_backup_path = launcher_path.map(|path| {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("launcher");
        path.with_file_name(format!(".{name}.previous"))
    });
    let _ = std::fs::remove_dir_all(&staging_dir);
    if marker_path.exists() {
        let _ = std::fs::remove_dir_all(&backup_dir);
        if let Some(launcher_backup) = &launcher_backup_path {
            let _ = std::fs::remove_file(launcher_backup);
        }
        if !backup_dir.exists()
            && launcher_backup_path
                .as_ref()
                .is_none_or(|path| !path.exists())
        {
            let _ = std::fs::remove_file(&marker_path);
        }
    } else {
        if backup_dir.exists() {
            let _ = std::fs::remove_dir_all(dest_dir);
            std::fs::rename(&backup_dir, dest_dir)?;
        }
        if let (Some(launcher), Some(launcher_backup)) =
            (launcher_path, launcher_backup_path.as_ref())
        {
            if launcher_backup.exists() {
                let _ = std::fs::remove_file(launcher);
                std::fs::rename(launcher_backup, launcher)?;
            }
        }
    }
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
    if dest_dir.exists() {
        std::fs::rename(dest_dir, &backup_dir)?;
    }
    if let Err(error) = std::fs::rename(&staging_dir, dest_dir) {
        if backup_dir.exists() {
            let _ = std::fs::rename(&backup_dir, dest_dir);
        }
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(InstallError::Io(error));
    }
    Ok(ArchiveTreeActivation {
        dest_dir: dest_dir.to_path_buf(),
        backup_dir,
        marker_path,
        launcher_path: launcher_path.map(Path::to_path_buf),
        launcher_backup_path,
        launcher_activated: false,
        committed: false,
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::domains::agents::installer::progress::InstallProgressUpdate;

    #[test]
    fn http_download_reports_monotonic_exact_bytes() {
        let payload = vec![b'x'; DOWNLOAD_BUFFER_BYTES * 2 + 17];
        let digest = format!("{:x}", Sha256::digest(&payload));
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("test server address");
        let response_payload = payload.clone();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).expect("read request");
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response_payload.len()
            )
            .expect("write headers");
            for chunk in response_payload.chunks(64 * 1024) {
                stream.write_all(chunk).expect("write payload chunk");
            }
        });

        let updates = Arc::new(Mutex::new(Vec::<InstallProgressUpdate>::new()));
        let captured = updates.clone();
        let reporter = InstallProgressReporter::new(move |update| {
            captured.lock().expect("progress lock").push(update);
        });
        let destination = std::env::temp_dir().join(format!(
            "anyharness-progress-download-{}",
            uuid::Uuid::new_v4()
        ));

        download_binary_verified(
            &format!("http://{address}/artifact"),
            &destination,
            &digest,
            None,
            Some(&reporter),
            &ArtifactRole::NativeCli,
        )
        .expect("download succeeds");
        server.join().expect("test server exits");

        let updates = updates.lock().expect("progress lock");
        let downloading: Vec<_> = updates
            .iter()
            .filter(|update| update.phase == InstallProgressPhase::Downloading)
            .collect();
        assert!(downloading.len() >= 2);
        assert!(downloading
            .windows(2)
            .all(|pair| { pair[0].downloaded_bytes <= pair[1].downloaded_bytes }));
        assert_eq!(
            downloading.last().map(|update| update.downloaded_bytes),
            Some(payload.len() as u64)
        );
        assert!(downloading
            .iter()
            .all(|update| update.download_size_bytes == Some(payload.len() as u64)));
        assert!(updates
            .iter()
            .any(|update| update.phase == InstallProgressPhase::Verifying));

        let _ = std::fs::remove_file(destination);
    }

    #[test]
    fn archive_tree_checksum_failure_preserves_live_tree() {
        let scratch = std::env::temp_dir().join(format!(
            "anyharness-progress-archive-{}",
            uuid::Uuid::new_v4()
        ));
        let live = scratch.join("registry_binary");
        std::fs::create_dir_all(&live).expect("live tree");
        std::fs::write(live.join("agent"), b"previous working adapter").expect("live adapter");
        let archive = scratch.join("replacement.tar.gz");
        std::fs::write(&archive, b"not the expected archive").expect("replacement bytes");

        let error = download_and_extract_archive_tree_verified(
            &format!("file://{}", archive.display()),
            &live,
            &"0".repeat(64),
            None,
            None,
            &ArtifactRole::AgentProcess,
            None,
        )
        .expect_err("checksum mismatch");

        assert!(matches!(error, InstallError::ChecksumMismatch { .. }));
        assert_eq!(
            std::fs::read(live.join("agent")).expect("preserved live adapter"),
            b"previous working adapter"
        );
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[test]
    fn archive_tree_recovers_interrupted_tree_and_launcher_activation() {
        let scratch = std::env::temp_dir().join(format!(
            "anyharness-progress-archive-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        let live = scratch.join("registry_binary");
        let backup = scratch.join(".registry_binary.previous");
        let launcher = scratch.join("cursor-launcher");
        let launcher_backup = scratch.join(".cursor-launcher.previous");
        std::fs::create_dir_all(&live).expect("live tree");
        std::fs::write(live.join("agent"), b"previous working adapter").expect("live adapter");
        std::fs::write(&launcher, b"previous working launcher").expect("live launcher");

        // Simulate a process dying after both replacements were activated but
        // before the durable commit marker was written.
        std::fs::rename(&live, &backup).expect("backup tree");
        std::fs::create_dir_all(&live).expect("replacement tree");
        std::fs::write(live.join("agent"), b"uncommitted adapter").expect("new adapter");
        std::fs::rename(&launcher, &launcher_backup).expect("backup launcher");
        std::fs::write(&launcher, b"uncommitted launcher").expect("new launcher");

        let archive = scratch.join("replacement.tar.gz");
        std::fs::write(&archive, b"not the expected archive").expect("replacement bytes");
        let error = download_and_extract_archive_tree_verified(
            &format!("file://{}", archive.display()),
            &live,
            &"0".repeat(64),
            None,
            None,
            &ArtifactRole::AgentProcess,
            Some(&launcher),
        )
        .expect_err("replacement checksum still fails after recovery");

        assert!(matches!(error, InstallError::ChecksumMismatch { .. }));
        assert_eq!(
            std::fs::read(live.join("agent")).expect("restored adapter"),
            b"previous working adapter"
        );
        assert_eq!(
            std::fs::read(&launcher).expect("restored launcher"),
            b"previous working launcher"
        );
        let _ = std::fs::remove_dir_all(scratch);
    }
}
