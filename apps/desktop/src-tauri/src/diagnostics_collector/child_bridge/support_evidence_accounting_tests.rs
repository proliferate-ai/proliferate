use std::{
    fs::{self, File, OpenOptions},
    io,
    os::{
        fd::OwnedFd,
        unix::fs::{OpenOptionsExt, PermissionsExt},
    },
    path::Path,
};

use super::*;

struct CountingReader {
    successful_bytes: u64,
    calls: usize,
    fail_second_call: bool,
}

struct ReplaceOnRead {
    path: std::path::PathBuf,
    replaced: bool,
}

impl EvidenceReadHook for ReplaceOnRead {
    fn read_at(
        &mut self,
        descriptor: &OwnedFd,
        offset: u64,
        destination: &mut [u8],
    ) -> io::Result<usize> {
        if !self.replaced {
            self.replaced = true;
            let old_path = self.path.with_extension("opened-inode");
            fs::rename(&self.path, old_path)?;
            fs::write(&self.path, b"new\n")?;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))?;
        }
        let mut system = SystemEvidenceReadHook;
        system.read_at(descriptor, offset, destination)
    }
}

impl EvidenceReadHook for CountingReader {
    fn read_at(
        &mut self,
        _descriptor: &OwnedFd,
        _offset: u64,
        destination: &mut [u8],
    ) -> io::Result<usize> {
        self.calls += 1;
        if self.fail_second_call && self.calls == 2 {
            return Err(io::Error::other("injected read failure"));
        }
        let length = if self.fail_second_call && self.calls == 1 {
            2
        } else {
            destination.len()
        };
        destination[..length].fill(b'\n');
        self.successful_bytes += length as u64;
        Ok(length)
    }
}

fn fixture_root() -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "proliferate-support-accounting-{}",
        uuid::Uuid::new_v4()
    ));
    private_dir(&root);
    root
}

fn private_dir(path: &Path) {
    fs::create_dir_all(path).expect("fixture directory");
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).expect("directory mode");
}

fn sparse_file(path: &Path, length: u64) {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .expect("fixture file")
        .set_len(length)
        .expect("sparse length");
}

fn source_bytes(capture: &FiniteEvidenceCapture, source: EvidenceSource) -> u64 {
    capture
        .sources
        .iter()
        .find(|candidate| candidate.source == source)
        .expect("source result")
        .read_bytes
}

#[test]
fn rotations_and_logical_families_debit_every_successful_read() {
    let root = fixture_root();
    let desktop = root.join("desktop");
    let runtime = root.join("runtime");
    let app = root.join("app");
    private_dir(&desktop);
    private_dir(&runtime.join("logs/diagnostics-fallback"));
    private_dir(&desktop.join("diagnostics-fallback"));
    private_dir(&app);

    sparse_file(
        &desktop.join("desktop-native.log"),
        COMPONENT_FILES_READ_BYTES,
    );
    sparse_file(
        &desktop.join("renderer-diagnostics.log"),
        COMPONENT_FILES_READ_BYTES,
    );
    sparse_file(
        &runtime.join("logs/diagnostics-fallback/anyharness.jsonl"),
        COMPONENT_FILES_READ_BYTES / 2,
    );
    sparse_file(
        &runtime.join("logs/diagnostics-fallback/anyharness.jsonl.1"),
        COMPONENT_FILES_READ_BYTES,
    );
    sparse_file(
        &desktop.join("diagnostics-fallback/desktop-worker.jsonl"),
        COMPONENT_FILES_READ_BYTES / 2,
    );
    sparse_file(
        &desktop.join("diagnostics-fallback/desktop-worker.jsonl.1"),
        COMPONENT_FILES_READ_BYTES,
    );

    let mut reader = CountingReader {
        successful_bytes: 0,
        calls: 0,
        fail_second_call: false,
    };
    let capture = collect_finite_evidence_with(
        &FiniteEvidenceRoots::new(&desktop, Some(&runtime), &app, &[]),
        &mut reader,
    );
    let desktop_family = source_bytes(&capture, EvidenceSource::DesktopNativeFallback)
        + source_bytes(&capture, EvidenceSource::RendererLegacy);
    let anyharness_family = source_bytes(&capture, EvidenceSource::AnyharnessFallback)
        + source_bytes(&capture, EvidenceSource::AnyharnessLegacy);
    let worker_family = source_bytes(&capture, EvidenceSource::DesktopWorkerFallback)
        + source_bytes(&capture, EvidenceSource::WorkerLegacyV2)
        + source_bytes(&capture, EvidenceSource::WorkerLegacyV1);
    assert_eq!(
        source_bytes(&capture, EvidenceSource::DesktopNativeFallback),
        DESKTOP_ACTIVE_READ_BYTES
    );
    assert!(desktop_family <= COMPONENT_FILES_READ_BYTES);
    assert!(anyharness_family <= COMPONENT_FILES_READ_BYTES);
    assert!(worker_family <= COMPONENT_FILES_READ_BYTES);
    assert!(capture.total_read_bytes <= ALL_FILES_READ_BYTES);
    assert_eq!(capture.total_read_bytes, reader.successful_bytes);
    fs::remove_dir_all(root).ok();
}

#[test]
fn partial_error_bytes_are_debited_before_the_next_rotation() {
    let root = fixture_root();
    let active_path = root.join("active");
    let older_path = root.join("older");
    sparse_file(&active_path, 6);
    sparse_file(&older_path, 8);
    let active: OwnedFd = File::open(active_path).expect("active descriptor").into();
    let older: OwnedFd = File::open(older_path).expect("older descriptor").into();
    let snapshots = vec![
        SegmentSnapshot {
            segment: 1,
            state: EvidenceSegmentState::Available,
            descriptor: Some(older),
            length: 8,
        },
        SegmentSnapshot {
            segment: 0,
            state: EvidenceSegmentState::Available,
            descriptor: Some(active),
            length: 6,
        },
    ];
    let mut result = EvidenceSourceRead::omitted(EvidenceSource::RendererLegacy);
    let mut reader = CountingReader {
        successful_bytes: 0,
        calls: 0,
        fail_second_call: true,
    };
    select_and_parse(
        &mut result,
        snapshots,
        EvidenceParser::Legacy,
        10,
        &mut reader,
    );
    assert_eq!(result.read_bytes, 10);
    assert_eq!(reader.successful_bytes, 10);
    assert_eq!(
        result
            .segments
            .iter()
            .find(|segment| segment.segment == 0)
            .expect("active segment")
            .read_bytes,
        2
    );
    assert_eq!(
        result
            .segments
            .iter()
            .find(|segment| segment.segment == 1)
            .expect("older segment")
            .read_bytes,
        8
    );
    fs::remove_dir_all(root).ok();
}

#[test]
fn pathname_replacement_after_snapshot_cannot_replace_opened_evidence() {
    let root = fixture_root();
    let log = root.join("desktop-native.log");
    fs::write(&log, b"old\n").expect("old inode");
    fs::set_permissions(&log, fs::Permissions::from_mode(0o600)).expect("file mode");
    let mut reader = ReplaceOnRead {
        path: log,
        replaced: false,
    };
    let capture = collect_finite_evidence_with(
        &FiniteEvidenceRoots::new(&root, None, &root, &[]),
        &mut reader,
    );
    let desktop = capture
        .sources
        .iter()
        .find(|source| source.source == EvidenceSource::DesktopNativeFallback)
        .expect("desktop source");
    assert!(matches!(
        &desktop.lines[0].value,
        super::super::EvidenceValue::DesktopOpaque { value, .. } if value == "old"
    ));
    assert_eq!(desktop.read_bytes, 4);
    assert_eq!(desktop.included_bytes, 4);
    assert_eq!(desktop.lines[0].included_bytes, 4);
    fs::remove_dir_all(root).ok();
}
