use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use super::*;

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
        artifact_id: stored.artifact_id.clone(),
        size_bytes: stored.size_bytes,
        sha256: stored.sha256.clone(),
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
        store.stage(&job, &preparation, b"diagnostics"),
        Err(ArtifactStoreError::NotReady)
    ));
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("open admission after empty hydration");
    let stored = store
        .stage(&job, &preparation, b"diagnostics")
        .expect("stage artifact");
    let metadata = fs::symlink_metadata(store.root().join(format!("{}.json", stored.artifact_id)))
        .expect("artifact metadata");
    assert_eq!(metadata.mode() & 0o777, 0o600);
    assert_eq!(metadata.nlink(), 1);
    assert_eq!(
        store.read_verified(&reference(&stored)).expect("read"),
        b"diagnostics"
    );
    assert!(matches!(
        store.stage(&job, &canonical_job(), b"replacement"),
        Err(ArtifactStoreError::AlreadyExists)
    ));
    fs::remove_dir_all(app).ok();
}

#[cfg(unix)]
#[test]
fn reconciliation_preserves_verified_and_removes_safe_unreferenced_bytes() {
    let app = temp_root();
    let attachments = app.join("attachments");
    let store = SupportArtifactStore::for_test(&app, &attachments);
    store
        .reconcile(&[], &[], Instant::now() + Duration::from_secs(1))
        .expect("initial reconciliation");
    let kept = store
        .stage(&canonical_job(), &canonical_job(), b"kept")
        .expect("kept artifact");
    let stale = store
        .stage(&canonical_job(), &canonical_job(), b"stale")
        .expect("stale artifact");
    let kept_reference = reference(&kept);
    let states = store
        .reconcile(
            std::slice::from_ref(&kept_reference),
            &[],
            Instant::now() + Duration::from_secs(1),
        )
        .expect("reconcile artifacts");
    assert_eq!(states[0].state, ReconciledArtifactState::Verified);
    assert!(store.read_verified(&kept_reference).is_ok());
    assert!(matches!(
        store.verify(&reference(&stale)),
        Err(ArtifactStoreError::Missing)
    ));
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
    let artifact_id = SupportArtifactStore::artifact_id(&canonical_job()).expect("artifact id");
    let reference = SupportArtifactReference {
        artifact_id: artifact_id.clone(),
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
        .stage(&canonical_job(), &canonical_job(), b"original")
        .expect("stage artifact");
    let mismatched = reference(&stored);
    let mismatch_path = store.root().join(format!("{}.json", stored.artifact_id));
    fs::write(&mismatch_path, b"changed").expect("corrupt fixture");
    let missing = SupportArtifactReference {
        artifact_id: SupportArtifactStore::artifact_id(&canonical_job()).expect("missing id"),
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
    let app = temp_root();
    let attachments = app.join("attachments");
    let client = attachments.join("client-1");
    fs::create_dir_all(&client).expect("attachment directory");
    let kept = client.join("kept.txt");
    let stale = client.join("stale.txt");
    fs::write(&kept, b"kept").expect("kept attachment");
    fs::write(&stale, b"stale").expect("stale attachment");
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
        store.stage(&canonical_job(), &canonical_job(), b"diagnostics"),
        Err(ArtifactStoreError::NotReady)
    ));
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
        .stage(&canonical_job(), &canonical_job(), b"exact-json")
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
    fs::remove_dir_all(app).ok();
}
