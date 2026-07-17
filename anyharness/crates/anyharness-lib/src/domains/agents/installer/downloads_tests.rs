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

#[test]
fn stale_committed_marker_cannot_commit_a_later_interrupted_activation() {
    let scratch = std::env::temp_dir().join(format!(
        "anyharness-progress-stale-marker-{}",
        uuid::Uuid::new_v4()
    ));
    let live = scratch.join("registry_binary");
    let backup = scratch.join(".registry_binary.previous");
    let marker = scratch.join(".registry_binary.activation-committed");
    let journal = scratch.join(".registry_binary.activation-journal");
    let launcher = scratch.join("cursor-launcher");
    let launcher_backup = scratch.join(".cursor-launcher.previous");
    std::fs::create_dir_all(&live).expect("live tree");
    std::fs::create_dir_all(&backup).expect("stale tree backup");
    std::fs::write(live.join("agent"), b"current committed adapter").expect("live adapter");
    std::fs::write(backup.join("agent"), b"obsolete adapter").expect("stale adapter");
    std::fs::write(&launcher, b"current committed launcher").expect("live launcher");
    std::fs::write(&launcher_backup, b"obsolete launcher").expect("stale launcher");
    std::fs::write(&marker, b"").expect("legacy stale marker");

    // A stale marker from an earlier committed generation must be removed
    // before a later generation is allowed to start.
    super::activation::ArchiveTreeActivation::recover(&live, Some(&launcher))
        .expect("clean stale committed generation");
    assert!(!marker.exists());
    assert!(!backup.exists());
    assert!(!launcher_backup.exists());

    let staging = scratch.join(".registry_binary.staging");
    let staged_launcher = scratch.join(".cursor-launcher.next");
    std::fs::create_dir_all(&staging).expect("new staged tree");
    std::fs::write(staging.join("agent"), b"later uncommitted adapter").expect("new adapter");
    std::fs::write(&staged_launcher, b"later uncommitted launcher").expect("new launcher");
    let mut activation =
        super::activation::ArchiveTreeActivation::activate_tree(&live, &staging, Some(&launcher))
            .expect("start later transaction");
    activation
        .activate_launcher(&staged_launcher)
        .expect("activate later launcher");
    assert!(journal.exists());
    assert!(!marker.exists());

    // Simulate process death before commit: bypass Drop, then let the next
    // install recover from the transaction-specific prepared journal.
    std::mem::forget(activation);
    super::activation::ArchiveTreeActivation::recover(&live, Some(&launcher))
        .expect("roll back later interrupted transaction");

    assert_eq!(
        std::fs::read(live.join("agent")).expect("restored committed adapter"),
        b"current committed adapter"
    );
    assert_eq!(
        std::fs::read(&launcher).expect("restored committed launcher"),
        b"current committed launcher"
    );
    assert!(!journal.exists());
    assert!(!marker.exists());
    let _ = std::fs::remove_dir_all(scratch);
}

#[test]
fn mismatched_commit_marker_fails_closed_without_deleting_backup() {
    let scratch = std::env::temp_dir().join(format!(
        "anyharness-progress-marker-mismatch-{}",
        uuid::Uuid::new_v4()
    ));
    let live = scratch.join("registry_binary");
    let staging = scratch.join(".registry_binary.staging");
    let backup = scratch.join(".registry_binary.previous");
    let marker = scratch.join(".registry_binary.activation-committed");
    std::fs::create_dir_all(&live).expect("live tree");
    std::fs::create_dir_all(&staging).expect("staged tree");
    std::fs::write(live.join("agent"), b"previous adapter").expect("live adapter");
    std::fs::write(staging.join("agent"), b"uncommitted adapter").expect("staged adapter");

    let activation = super::activation::ArchiveTreeActivation::activate_tree(&live, &staging, None)
        .expect("start transaction");
    std::mem::forget(activation);
    std::fs::write(&marker, b"different-transaction\n").expect("mismatched marker");

    let error = super::activation::ArchiveTreeActivation::recover(&live, None)
        .expect_err("mismatched generation must fail closed");
    assert!(
        matches!(error, InstallError::Io(inner) if inner.kind() == std::io::ErrorKind::InvalidData)
    );
    assert!(backup.exists(), "rollback backup must remain available");
    assert_eq!(
        std::fs::read(live.join("agent")).expect("uncommitted tree remains untouched"),
        b"uncommitted adapter"
    );
    let _ = std::fs::remove_dir_all(scratch);
}
