use std::path::Path;

use super::*;

#[test]
fn finite_inventory_excludes_writer_authority_and_unbounded_names() {
    let fallback_names = FALLBACK_SEGMENTS
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>();
    assert_eq!(
        fallback_names,
        ["{leaf}.3", "{leaf}.2", "{leaf}.1", "{leaf}"]
    );
    assert!(!fallback_names.iter().any(|name| name.contains("lock")));
    assert_eq!(
        LEGACY_SEGMENTS.last(),
        Some(&("{leaf}", 0)),
        "legacy presentation ends at the active file"
    );
}

#[test]
fn unsupported_inventory_is_fixed_omission_without_file_access() {
    let roots = FiniteEvidenceRoots::new(
        Path::new("/does/not/matter"),
        None,
        Path::new("/does/not/matter"),
        &["target".to_owned()],
    );
    #[cfg(not(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )))]
    {
        let capture = collect_finite_evidence(&roots);
        assert_eq!(capture.total_read_bytes, 0);
        assert_eq!(capture.sources.len(), 7);
        assert!(capture
            .sources
            .iter()
            .all(|source| source.state == EvidenceSourceState::Omitted));
    }
    let _ = roots;
}

#[cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]
mod supported {
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
    };

    use super::*;
    use proliferate_diagnostics_client::{FallbackReason, FallbackRecordV1};
    use proliferate_diagnostics_protocol::v1::{
        limits::CURRENT_SCHEMA_VERSION,
        types::{
            ComponentV1, DetailedDiagnosticV1, DetailedKindV1, PrivacyClassificationV1,
            ProducerRecordV1, RecordClassV1, RedactionClassificationV1, SeverityV1, SourceV1,
        },
    };

    fn fixture_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "proliferate-support-evidence-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).expect("create fixture");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).expect("root mode");
        // Canonicalized, as in `fallback_root_tests::temp_base`. `temp_dir()` is
        // `$TMPDIR` = `/var/folders/...` on macOS and `/var` is a symlink to
        // `private/var`, so the hardened anchor walk refuses the very first
        // component (`O_DIRECTORY | O_NOFOLLOW` gives ENOTDIR, which maps to
        // `UnsafeMetadata`) and every source below reads as rejected rather than
        // as the state the test is asserting.
        fs::canonicalize(root).expect("canonical fixture root")
    }

    fn source<'a>(
        capture: &'a FiniteEvidenceCapture,
        kind: EvidenceSource,
    ) -> &'a EvidenceSourceRead {
        capture
            .sources
            .iter()
            .find(|source| source.source == kind)
            .expect("source exists")
    }

    fn record(component: ComponentV1, source: SourceV1) -> ProducerRecordV1 {
        let name = match component {
            ComponentV1::Anyharness => "anyharness.transport.status",
            ComponentV1::DesktopWorker => "desktop_worker.transport.status",
            _ => "desktop_tauri.transport.status",
        };
        ProducerRecordV1 {
            schema_version: CURRENT_SCHEMA_VERSION,
            source_timestamp: "2026-08-11T12:00:00.000Z".into(),
            producer_sequence: 1,
            producer_boot_id: "producer-boot".into(),
            component,
            source,
            release: "test-release".into(),
            environment: "test".into(),
            operation_id: "operation".into(),
            parent_operation_id: None,
            trace_id: None,
            workspace_id: None,
            session_id: None,
            turn_id: None,
            item_id: None,
            request_id: None,
            target_id: None,
            prompt_id: None,
            workflow_id: None,
            name: name.into(),
            severity: SeverityV1::Warn,
            arguments: Vec::new(),
            error_classification: None,
            record_class: RecordClassV1::Detailed,
            privacy: PrivacyClassificationV1::Operational,
            redaction: RedactionClassificationV1::Structural,
            detailed: Some(DetailedDiagnosticV1 {
                kind: DetailedKindV1::Log,
                message: Some("status".into()),
                stream: None,
                dropped_count: None,
                milestone: None,
            }),
            lifecycle: None,
        }
    }

    #[test]
    fn reader_restores_complete_line_order_and_counts_incomplete_final_bytes() {
        let root = fixture_root();
        let log = root.join("desktop-native.log");
        fs::write(&log, b"older\nnewer\nincomplete").expect("write evidence");
        fs::set_permissions(&log, fs::Permissions::from_mode(0o600)).expect("file mode");
        let roots = FiniteEvidenceRoots::new(&root, None, &root, &[]);
        let capture = collect_finite_evidence(&roots);
        let desktop = source(&capture, EvidenceSource::DesktopNativeFallback);
        assert_eq!(desktop.state, EvidenceSourceState::Included);
        assert_eq!(desktop.incomplete_final_bytes, b"incomplete".len() as u64);
        let values = desktop
            .lines
            .iter()
            .map(|line| match &line.value {
                EvidenceValue::DesktopOpaque { value, .. } => value.as_str(),
                _ => panic!("plain mixed line must stay opaque"),
            })
            .collect::<Vec<_>>();
        assert_eq!(values, ["older", "newer"]);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reader_rejects_symlink_and_hardlink_metadata_without_following() {
        let root = fixture_root();
        let outside = root.join("outside");
        fs::write(&outside, b"secret\n").expect("outside file");
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).expect("outside mode");
        symlink(&outside, root.join("desktop-native.log")).expect("symlink leaf");
        let roots = FiniteEvidenceRoots::new(&root, None, &root, &[]);
        let capture = collect_finite_evidence(&roots);
        assert_eq!(
            source(&capture, EvidenceSource::DesktopNativeFallback).state,
            EvidenceSourceState::UnsafeMetadata
        );
        fs::remove_file(root.join("desktop-native.log")).expect("remove symlink");
        fs::hard_link(&outside, root.join("desktop-native.log")).expect("hardlink leaf");
        let capture = collect_finite_evidence(&roots);
        assert_eq!(
            source(&capture, EvidenceSource::DesktopNativeFallback).state,
            EvidenceSourceState::UnsafeMetadata
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn wrapped_invalid_line_is_omitted_instead_of_downgraded_to_opaque() {
        let root = fixture_root();
        let fallback = root.join("diagnostics-fallback");
        fs::create_dir(&fallback).expect("fallback directory");
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o700)).expect("fallback mode");
        let log = fallback.join("desktop-worker.jsonl");
        fs::write(&log, b"{\"not\":\"a-wrapper\"}\n").expect("invalid wrapper fixture");
        fs::set_permissions(&log, fs::Permissions::from_mode(0o600)).expect("file mode");
        let capture = collect_finite_evidence(&FiniteEvidenceRoots::new(&root, None, &root, &[]));
        let worker = source(&capture, EvidenceSource::DesktopWorkerFallback);
        assert_eq!(worker.state, EvidenceSourceState::Invalid);
        assert_eq!(worker.invalid_lines, 1);
        assert!(worker.lines.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn strict_wrapper_rejects_wrong_shape_component_and_version() {
        let root = fixture_root();
        let fallback = root.join("diagnostics-fallback");
        fs::create_dir(&fallback).expect("fallback directory");
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o700)).expect("fallback mode");
        let wrong_component = FallbackRecordV1 {
            fallback_schema: 1,
            reason: FallbackReason::CollectorUnavailable,
            record: record(ComponentV1::Anyharness, SourceV1::Anyharness),
        };
        let mut wrong_version = serde_json::to_value(FallbackRecordV1 {
            fallback_schema: 1,
            reason: FallbackReason::CollectorUnavailable,
            record: record(ComponentV1::DesktopWorker, SourceV1::Worker),
        })
        .expect("wrapper value");
        wrong_version["fallback_schema"] = serde_json::Value::from(2);
        let lines = [
            serde_json::json!({"not": "a-wrapper"}),
            serde_json::to_value(wrong_component).expect("component wrapper"),
            wrong_version,
        ]
        .into_iter()
        .map(|value| serde_json::to_string(&value).expect("line"))
        .collect::<Vec<_>>()
        .join("\n")
            + "\n";
        let log = fallback.join("desktop-worker.jsonl");
        fs::write(&log, lines).expect("invalid wrapper fixture");
        fs::set_permissions(&log, fs::Permissions::from_mode(0o600)).expect("file mode");
        let capture = collect_finite_evidence(&FiniteEvidenceRoots::new(&root, None, &root, &[]));
        let worker = source(&capture, EvidenceSource::DesktopWorkerFallback);
        assert_eq!(worker.state, EvidenceSourceState::Invalid);
        assert_eq!(worker.invalid_lines, 3);
        assert!(worker.lines.is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn active_fallback_rejects_wrong_parent_and_file_modes() {
        let root = fixture_root();
        let fallback = root.join("diagnostics-fallback");
        fs::create_dir(&fallback).expect("fallback directory");
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o750))
            .expect("wrong parent mode");
        let log = fallback.join("desktop-worker.jsonl");
        fs::write(&log, b"line\n").expect("fallback fixture");
        fs::set_permissions(&log, fs::Permissions::from_mode(0o600)).expect("file mode");
        let roots = FiniteEvidenceRoots::new(&root, None, &root, &[]);
        let capture = collect_finite_evidence(&roots);
        assert_eq!(
            source(&capture, EvidenceSource::DesktopWorkerFallback).state,
            EvidenceSourceState::UnsafeMetadata
        );
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o700))
            .expect("safe parent mode");
        fs::set_permissions(&log, fs::Permissions::from_mode(0o640)).expect("wrong file mode");
        let capture = collect_finite_evidence(&roots);
        assert_eq!(
            source(&capture, EvidenceSource::DesktopWorkerFallback).state,
            EvidenceSourceState::UnsafeMetadata
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn legacy_lines_restore_rotation_order_and_count_invalid_utf8() {
        let root = fixture_root();
        let older = root.join("renderer-diagnostics.log.1");
        let active = root.join("renderer-diagnostics.log");
        fs::write(&older, b"older\n").expect("older rotation");
        fs::write(&active, [b'n', 0xff, b'\n']).expect("active rotation");
        fs::set_permissions(&older, fs::Permissions::from_mode(0o600)).expect("older mode");
        fs::set_permissions(&active, fs::Permissions::from_mode(0o600)).expect("active mode");
        let capture = collect_finite_evidence(&FiniteEvidenceRoots::new(&root, None, &root, &[]));
        let renderer = source(&capture, EvidenceSource::RendererLegacy);
        assert_eq!(renderer.invalid_utf8_bytes, 1);
        assert_eq!(renderer.lines.len(), 2);
        assert_eq!(renderer.lines[0].segment, 1);
        assert_eq!(renderer.lines[1].segment, 0);
        assert!(matches!(
            &renderer.lines[1].value,
            EvidenceValue::Legacy {
                invalid_utf8_bytes: 1,
                ..
            }
        ));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn worker_legacy_rejects_group_writable_namespace_parent() {
        let root = fixture_root();
        let path =
            crate::commands::cloud_worker::spawn::worker_legacy_log_paths(&root, "target").v2;
        let target = path.parent().expect("target directory");
        fs::create_dir_all(target).expect("worker hierarchy");
        let namespace = target.parent().expect("namespace directory");
        fs::set_permissions(namespace, fs::Permissions::from_mode(0o720))
            .expect("unsafe namespace mode");
        fs::set_permissions(target, fs::Permissions::from_mode(0o700)).expect("target mode");
        fs::write(&path, b"worker\n").expect("worker log");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("worker log mode");
        let capture = collect_finite_evidence(&FiniteEvidenceRoots::new(
            &root,
            None,
            &root,
            &["target".to_owned()],
        ));
        assert_eq!(
            source(&capture, EvidenceSource::WorkerLegacyV2).state,
            EvidenceSourceState::UnsafeMetadata
        );
        fs::remove_dir_all(root).ok();
    }
}
