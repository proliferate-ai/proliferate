use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};

use super::*;

#[cfg(unix)]
struct DeterministicReconcileHooks {
    before_deadline: Instant,
    deadline: Instant,
    reads: usize,
    expire_after_reads: Option<usize>,
}

#[cfg(unix)]
impl platform::ReconcileHooks for DeterministicReconcileHooks {
    fn now(&mut self) -> Instant {
        if self
            .expire_after_reads
            .is_some_and(|limit| self.reads >= limit)
        {
            self.deadline
        } else {
            self.before_deadline
        }
    }

    fn read(&mut self, file: &mut fs::File, destination: &mut [u8]) -> std::io::Result<usize> {
        self.reads += 1;
        std::io::Read::read(file, destination)
    }
}

fn temp_root() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "proliferate-support-artifact-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&root).expect("create artifact fixture root");
    root
}

fn canonical_job() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn reference(stored: &StoredSupportArtifact) -> SupportArtifactReference {
    SupportArtifactReference {
        client_job_id: stored.client_job_id.clone(),
        artifact_id: stored.artifact_id.clone(),
        snapshot_id: stored.snapshot_id.clone(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256.clone(),
    }
}

fn unbacked_reference(client_job_id: String) -> SupportArtifactReference {
    SupportArtifactReference {
        artifact_id: SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id"),
        client_job_id,
        snapshot_id: canonical_job(),
        size_bytes: 0,
        sha256: digest(b""),
    }
}

#[test]
fn artifact_id_is_deterministic_job_bound_and_path_opaque() {
    let job = "11111111-1111-4111-8111-111111111111";
    let first = SupportArtifactStore::artifact_id(job).expect("artifact id");
    let second = SupportArtifactStore::artifact_id(job).expect("same artifact id");
    assert_eq!(first, second);
    assert!(first.starts_with(ARTIFACT_PREFIX));
    assert_eq!(first.len(), ARTIFACT_PREFIX.len() + 64);
    assert!(!first.contains('/'));
    assert!(SupportArtifactStore::artifact_id("../job").is_err());
    assert_ne!(
        first,
        SupportArtifactStore::artifact_id("22222222-2222-4222-8222-222222222222")
            .expect("other job")
    );
}

#[test]
fn persisted_reference_rejects_job_binding_and_identity_drift_before_io() {
    let app = temp_root();
    let store = SupportArtifactStore::for_test(&app, &app.join("attachments"));
    let first_job = canonical_job();
    let second_job = canonical_job();
    let artifact_id = SupportArtifactStore::artifact_id(&first_job).expect("first artifact");
    let mut different_job = unbacked_reference(second_job);
    different_job.artifact_id = artifact_id;
    assert!(matches!(
        store.reconcile(
            &[different_job],
            &[],
            Instant::now() + Duration::from_secs(1)
        ),
        Err(ArtifactStoreError::InvalidInput)
    ));
    let mut wrong_domain = unbacked_reference(first_job.clone());
    let mut hasher = Sha256::new();
    hasher.update(b"wrong-domain\0");
    hasher.update(first_job.as_bytes());
    wrong_domain.artifact_id = format!("{ARTIFACT_PREFIX}{:x}", hasher.finalize());
    assert!(matches!(
        store.verify(&wrong_domain),
        Err(ArtifactStoreError::InvalidInput)
    ));
    let mut malformed_snapshot = unbacked_reference(first_job);
    malformed_snapshot.snapshot_id.clear();
    assert!(matches!(
        store.read_verified(&malformed_snapshot),
        Err(ArtifactStoreError::InvalidInput)
    ));
    malformed_snapshot.snapshot_id = "s".repeat(129);
    assert!(matches!(
        store.read_verified(&malformed_snapshot),
        Err(ArtifactStoreError::InvalidInput)
    ));
    let malformed_job = SupportArtifactReference {
        client_job_id: "NOT-A-CANONICAL-UUID".into(),
        artifact_id: format!("{ARTIFACT_PREFIX}{}", "0".repeat(64)),
        snapshot_id: canonical_job(),
        size_bytes: 0,
        sha256: digest(b""),
    };
    assert!(matches!(
        store.reconcile(
            &[malformed_job],
            &[],
            Instant::now() + Duration::from_secs(1)
        ),
        Err(ArtifactStoreError::InvalidInput)
    ));
    assert!(
        !store.root().exists(),
        "invalid references perform no inventory"
    );
    fs::remove_dir_all(app).ok();
}

#[test]
fn conflicting_duplicate_reference_is_rejected_losslessly() {
    let app = temp_root();
    let store = SupportArtifactStore::for_test(&app, &app.join("attachments"));
    let first = unbacked_reference(canonical_job());
    let mut conflict = first.clone();
    conflict.snapshot_id = "different-content-identity".into();
    assert!(matches!(
        store.reconcile(
            &[first, conflict],
            &[],
            Instant::now() + Duration::from_secs(1)
        ),
        Err(ArtifactStoreError::InvalidInput)
    ));
    assert!(!store.root().exists());
    fs::remove_dir_all(app).ok();
}

#[test]
fn reconciliation_rejects_reference_caps_and_attachment_escape_before_inventory() {
    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    let artifacts = (0..=MAX_ARTIFACT_REFERENCES)
        .map(|_| unbacked_reference(canonical_job()))
        .collect::<Vec<_>>();
    assert!(matches!(
        store.reconcile(&artifacts, &[], Instant::now() + Duration::from_secs(1)),
        Err(ArtifactStoreError::InvalidInput)
    ));
    let attachment_paths = (0..=MAX_ATTACHMENT_REFERENCES)
        .map(|index| {
            attachments
                .join(format!("client-{index}/file"))
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert!(matches!(
        store.reconcile(
            &[],
            &attachment_paths,
            Instant::now() + Duration::from_secs(1)
        ),
        Err(ArtifactStoreError::InvalidInput)
    ));
    let escaped = app.join("outside/file").to_string_lossy().into_owned();
    assert!(matches!(
        store.reconcile(&[], &[escaped], Instant::now() + Duration::from_secs(1)),
        Err(ArtifactStoreError::InvalidInput)
    ));
    assert!(!store.root().exists());
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn stage_waits_for_reconciliation_then_reopens_exact_bytes() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    let job = canonical_job();
    let preparation = canonical_job();
    assert!(matches!(
        store.stage(&job, &canonical_job(), &preparation, b"diagnostics"),
        Err(ArtifactStoreError::NotReady)
    ));
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("open admission after empty hydration");
    let snapshot = "random-content-identity";
    let stored = store
        .stage(&job, snapshot, &preparation, b"diagnostics")
        .expect("stage artifact");
    assert_eq!(stored.snapshot_id, snapshot);
    let root_metadata = fs::symlink_metadata(store.root()).expect("root metadata");
    assert_eq!(root_metadata.mode() & 0o777, 0o700);
    let metadata = fs::symlink_metadata(store.root().join(format!("{}.json", stored.artifact_id)))
        .expect("artifact metadata");
    assert_eq!(metadata.mode() & 0o777, 0o600);
    assert_eq!(metadata.nlink(), 1);
    assert_eq!(
        store.read_verified(&reference(&stored)).expect("read"),
        b"diagnostics"
    );
    let persisted = reference(&stored);
    let reconciled = store
        .reconcile(
            &[persisted.clone(), persisted.clone()],
            &[],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("deduplicate identical references");
    assert_eq!(reconciled.len(), 1);
    assert_eq!(reconciled[0].reference, persisted);
    let mut wrong_size = reference(&stored);
    wrong_size.size_bytes += 1;
    assert!(matches!(
        store.verify(&wrong_size),
        Err(ArtifactStoreError::Mismatch)
    ));
    let mut wrong_sha = reference(&stored);
    wrong_sha.sha256 = "0".repeat(64);
    assert!(matches!(
        store.read_verified(&wrong_sha),
        Err(ArtifactStoreError::Mismatch)
    ));
    assert!(matches!(
        store.stage(&job, &canonical_job(), &canonical_job(), b"replacement"),
        Err(ArtifactStoreError::StageFailed)
    ));
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn reconciliation_preserves_verified_and_removes_safe_unreferenced_bytes() {
    use std::os::unix::fs::PermissionsExt;

    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("initial reconciliation");
    let kept = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"kept",
        )
        .expect("kept artifact");
    let stale = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"stale",
        )
        .expect("stale artifact");
    let partial = store.root().join(format!(
        "{}.{}.json.partial",
        SupportArtifactStore::artifact_id(&canonical_job()).expect("partial id"),
        canonical_job()
    ));
    fs::write(&partial, b"partial").expect("partial fixture");
    std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o600))
        .expect("partial mode");
    let unsafe_final = store.root().join(format!(
        "{}.json",
        SupportArtifactStore::artifact_id(&canonical_job()).expect("unsafe id")
    ));
    fs::write(&unsafe_final, b"unsafe mode").expect("unsafe final fixture");
    std::fs::set_permissions(&unsafe_final, std::fs::Permissions::from_mode(0o644))
        .expect("unsafe final mode");
    let kept_reference = reference(&kept);
    let states = store
        .reconcile(
            std::slice::from_ref(&kept_reference),
            &[],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("reconcile artifacts");
    assert_eq!(states[0].state, ReconciledArtifactState::Verified);
    assert_eq!(states[0].reference, kept_reference);
    assert!(store.read_verified(&kept_reference).is_ok());
    assert!(matches!(
        store.verify(&reference(&stale)),
        Err(ArtifactStoreError::Missing)
    ));
    assert!(!partial.exists());
    assert!(
        unsafe_final.exists(),
        "unsafe unreferenced bytes are preserved"
    );
    store.delete(&kept.artifact_id).expect("delete artifact");
    store.delete(&kept.artifact_id).expect("idempotent delete");
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn verification_rejects_symlink_and_hardlink_leaves() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let app = temp_root();
    let store = SupportArtifactStore::for_test(&app, &app.join("attachments"));
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("reconcile");
    let client_job_id = canonical_job();
    let artifact_id = SupportArtifactStore::artifact_id(&client_job_id).expect("artifact id");
    let reference = SupportArtifactReference {
        client_job_id,
        artifact_id: artifact_id.clone(),
        snapshot_id: canonical_job(),
        size_bytes: 7,
        sha256: digest(b"outside"),
    };
    let outside = app.join("outside.json");
    fs::write(&outside, b"outside").expect("outside fixture");
    fs::set_permissions(&outside, fs::Permissions::from_mode(0o600)).expect("outside mode");
    let leaf = store.root().join(format!("{artifact_id}.json"));
    symlink(&outside, &leaf).expect("symlink fixture");
    assert!(matches!(
        store.verify(&reference),
        Err(ArtifactStoreError::UnsafeMetadata)
    ));
    fs::remove_file(&leaf).expect("remove symlink");
    fs::hard_link(&outside, &leaf).expect("hardlink fixture");
    assert!(matches!(
        store.verify(&reference),
        Err(ArtifactStoreError::UnsafeMetadata)
    ));
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn reconciliation_reports_missing_and_preserves_referenced_mismatch() {
    let app = temp_root();
    let store = SupportArtifactStore::for_test(&app, &app.join("attachments"));
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("initial reconciliation");
    let stored = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"original",
        )
        .expect("stage artifact");
    let mismatched = reference(&stored);
    let mismatch_path = store.root().join(format!("{}.json", stored.artifact_id));
    fs::write(&mismatch_path, b"changed").expect("corrupt fixture");
    let missing_job = canonical_job();
    let missing = SupportArtifactReference {
        artifact_id: SupportArtifactStore::artifact_id(&missing_job).expect("missing id"),
        client_job_id: missing_job,
        snapshot_id: canonical_job(),
        size_bytes: 0,
        sha256: digest(b""),
    };
    let states = store
        .reconcile(
            &[mismatched, missing],
            &[],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("reconcile states");
    assert_eq!(states[0].state, ReconciledArtifactState::Mismatch);
    assert_eq!(states[1].state, ReconciledArtifactState::Missing);
    assert!(
        mismatch_path.exists(),
        "referenced mismatches are preserved"
    );
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn reconciliation_removes_only_unreferenced_staged_attachments() {
    use std::os::unix::fs::symlink;

    let app = temp_root();
    let attachments = app.join("attachments");
    let client = attachments.join("client-1");
    fs::create_dir_all(&client).expect("attachment directory");
    let kept = client.join("kept.txt");
    let stale = client.join("stale.txt");
    let unsafe_link = client.join("unsafe-link.txt");
    fs::write(&kept, b"kept").expect("kept attachment");
    fs::write(&stale, b"stale").expect("stale attachment");
    symlink(&kept, &unsafe_link).expect("unsafe attachment link");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    store
        .reconcile(
            &[],
            &[kept.to_string_lossy().into_owned()],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("reconcile attachments");
    assert!(kept.exists());
    assert!(!stale.exists());
    assert!(unsafe_link.exists(), "unsafe attachment is preserved");
    store
        .reconcile(
            &[],
            &[kept.to_string_lossy().into_owned()],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("idempotent reconciliation");
    assert!(kept.exists());
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn expired_reconciliation_keeps_preparation_admission_closed() {
    let app = temp_root();
    let store = SupportArtifactStore::for_test(&app, &app.join("attachments"));
    assert!(matches!(
        store.reconcile(&[], &[], Instant::now()),
        Err(ArtifactStoreError::Deadline)
    ));
    assert!(matches!(
        store.stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"diagnostics",
        ),
        Err(ArtifactStoreError::NotReady)
    ));
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn deadline_expiry_mid_hash_prevents_all_sweeps_and_success_reopens_admission() {
    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("initial reconciliation");
    let retained = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            &vec![b'x'; 3 * 65_536],
        )
        .expect("retained artifact");
    let stale = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"stale",
        )
        .expect("stale artifact");
    let stale_path = store.root().join(format!("{}.json", stale.artifact_id));
    let attachment_dir = attachments.join("client");
    fs::create_dir_all(&attachment_dir).expect("attachment directory");
    let stale_attachment = attachment_dir.join("stale.txt");
    fs::write(&stale_attachment, b"stale").expect("stale attachment");
    let before_deadline = Instant::now();
    let deadline = before_deadline + Duration::from_secs(1);
    let mut expiring = DeterministicReconcileHooks {
        before_deadline,
        deadline,
        reads: 0,
        expire_after_reads: Some(2),
    };
    assert!(matches!(
        store.reconcile_with_hooks(&[reference(&retained)], &[], deadline, &mut expiring),
        Err(ArtifactStoreError::Deadline)
    ));
    assert!(stale_path.exists(), "artifact sweep must not begin");
    assert!(stale_attachment.exists(), "attachment sweep must not begin");
    assert!(matches!(
        store.stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"blocked"
        ),
        Err(ArtifactStoreError::NotReady)
    ));

    let before_deadline = Instant::now();
    let deadline = before_deadline + Duration::from_secs(1);
    let mut within_deadline = DeterministicReconcileHooks {
        before_deadline,
        deadline,
        reads: 0,
        expire_after_reads: None,
    };
    let states = store
        .reconcile_with_hooks(&[reference(&retained)], &[], deadline, &mut within_deadline)
        .expect("bounded hash succeeds");
    assert_eq!(states[0].state, ReconciledArtifactState::Verified);
    assert!(!stale_path.exists());
    assert!(!stale_attachment.exists());
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn archive_contains_one_byte_identical_diagnostics_entry() {
    use std::io::Read;

    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("reconcile");
    let stored = store
        .stage(
            &canonical_job(),
            &canonical_job(),
            &canonical_job(),
            b"exact-json",
        )
        .expect("stage");
    let archive = app.join("copy.zip");
    store
        .save_archive(&reference(&stored), &archive)
        .expect("archive");
    let mut zip =
        zip::ZipArchive::new(fs::File::open(&archive).expect("open archive")).expect("read zip");
    assert_eq!(zip.len(), 1);
    let mut entry = zip.by_index(0).expect("diagnostics entry");
    assert_eq!(entry.name(), "diagnostics.json");
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).expect("read entry");
    assert_eq!(bytes, b"exact-json");
    assert!(matches!(
        store.save_archive(&reference(&stored), &archive),
        Err(ArtifactStoreError::AlreadyExists)
    ));
    let partial_prefix = ".copy.zip.";
    assert!(!fs::read_dir(&app)
        .expect("archive parent")
        .filter_map(Result::ok)
        .any(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with(partial_prefix) && name.ends_with(".partial")
        }));
    fs::remove_dir_all(app).ok();
}
