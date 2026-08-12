#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Deterministic security proofs for fallback-root resolution over real
//! temporary directories; no spawned process and no Cargo re-entry.

use std::{
    fs,
    mem::zeroed,
    os::fd::{AsRawFd, OwnedFd},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
};

use proliferate_diagnostics_client::bridge::wire::FallbackUnavailableClassification;

use super::{resolve_fallback_root, FallbackRootOutcome, FALLBACK_LEAF_DIR};

fn temp_base() -> PathBuf {
    let base = std::env::temp_dir().join(format!(
        "proliferate-fallback-root-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&base).expect("create temp base");
    fs::canonicalize(base).expect("canonical test base")
}

fn expect_available(outcome: FallbackRootOutcome) -> OwnedFd {
    match outcome {
        FallbackRootOutcome::Available(descriptor) => descriptor,
        FallbackRootOutcome::Unavailable(classification) => {
            panic!("expected available root, got {classification:?}")
        }
    }
}

fn expect_unavailable(outcome: FallbackRootOutcome, expected: FallbackUnavailableClassification) {
    match outcome {
        FallbackRootOutcome::Available(_) => panic!("expected unavailable root"),
        FallbackRootOutcome::Unavailable(classification) => {
            assert_eq!(classification, expected)
        }
    }
}

fn descriptor_stat(descriptor: &OwnedFd) -> libc::stat {
    // SAFETY: zeroed stat is a valid output buffer for fstat on an owned fd.
    let mut stat: libc::stat = unsafe { zeroed() };
    // SAFETY: `descriptor` is an owned open descriptor.
    assert_eq!(unsafe { libc::fstat(descriptor.as_raw_fd(), &mut stat) }, 0);
    stat
}

fn leaf_mode(path: &Path) -> u32 {
    fs::metadata(path).expect("leaf metadata").mode() & 0o777
}

#[test]
fn creates_leaf_with_exact_mode_and_returns_its_descriptor() {
    let base = temp_base();
    let descriptor = expect_available(resolve_fallback_root(&base, &[]));
    let leaf = base.join(FALLBACK_LEAF_DIR);
    assert_eq!(leaf_mode(&leaf), 0o700);
    let stat = descriptor_stat(&descriptor);
    assert_eq!(stat.st_mode & libc::S_IFMT, libc::S_IFDIR);
    assert_eq!(
        u64::from(stat.st_ino),
        fs::metadata(&leaf).expect("leaf").ino()
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn traverses_fixed_parent_components_before_the_leaf() {
    let base = temp_base();
    fs::create_dir(base.join("logs")).expect("create logs");
    let descriptor = expect_available(resolve_fallback_root(&base, &["logs"]));
    let leaf = base.join("logs").join(FALLBACK_LEAF_DIR);
    assert_eq!(leaf_mode(&leaf), 0o700);
    let stat = descriptor_stat(&descriptor);
    assert_eq!(
        u64::from(stat.st_ino),
        fs::metadata(&leaf).expect("leaf").ino()
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn reuses_a_pre_existing_conforming_leaf() {
    let base = temp_base();
    let leaf = base.join(FALLBACK_LEAF_DIR);
    fs::create_dir(&leaf).expect("create leaf");
    fs::set_permissions(&leaf, fs::Permissions::from_mode(0o700)).expect("set mode");
    expect_available(resolve_fallback_root(&base, &[]));
    assert_eq!(leaf_mode(&leaf), 0o700);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn wrong_mode_pre_existing_leaf_is_rejected_without_a_rewrite() {
    let base = temp_base();
    let leaf = base.join(FALLBACK_LEAF_DIR);
    fs::create_dir(&leaf).expect("create leaf");
    fs::set_permissions(&leaf, fs::Permissions::from_mode(0o755)).expect("set mode");
    expect_unavailable(
        resolve_fallback_root(&base, &[]),
        FallbackUnavailableClassification::SecurityRejected,
    );
    // The pre-existing directory's mode must never be rewritten.
    assert_eq!(leaf_mode(&leaf), 0o755);
    fs::remove_dir_all(&base).ok();
}

#[test]
fn missing_base_is_directory_unavailable() {
    // macOS exposes the temporary directory through `/var`, which is itself a
    // symlink to `/private/var`. Canonicalize the existing trusted ancestor so
    // this fixture exercises a missing base component rather than the separate
    // symlink-ancestor rejection path.
    let base = fs::canonicalize(std::env::temp_dir())
        .expect("canonical temporary directory")
        .join(format!("proliferate-missing-{}", uuid::Uuid::new_v4()));
    expect_unavailable(
        resolve_fallback_root(&base, &[]),
        FallbackUnavailableClassification::DirectoryUnavailable,
    );
}

#[test]
fn missing_parent_component_is_directory_unavailable() {
    let base = temp_base();
    // Only the terminal leaf may be created; a missing `logs` parent is an
    // availability outcome.
    expect_unavailable(
        resolve_fallback_root(&base, &["logs"]),
        FallbackUnavailableClassification::DirectoryUnavailable,
    );
    assert!(!base.join("logs").exists());
    fs::remove_dir_all(&base).ok();
}

#[test]
fn symlinked_leaf_is_security_rejected() {
    let base = temp_base();
    let target = base.join("elsewhere");
    fs::create_dir(&target).expect("create target");
    std::os::unix::fs::symlink(&target, base.join(FALLBACK_LEAF_DIR)).expect("symlink leaf");
    expect_unavailable(
        resolve_fallback_root(&base, &[]),
        FallbackUnavailableClassification::SecurityRejected,
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn symlinked_parent_component_is_security_rejected() {
    let base = temp_base();
    let target = base.join("elsewhere");
    fs::create_dir(&target).expect("create target");
    std::os::unix::fs::symlink(&target, base.join("logs")).expect("symlink parent");
    expect_unavailable(
        resolve_fallback_root(&base, &["logs"]),
        FallbackUnavailableClassification::SecurityRejected,
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn symlinked_ancestor_of_the_base_is_security_rejected() {
    let root = temp_base();
    let real = root.join("real");
    let via_link = root.join("via-link");
    fs::create_dir(&real).expect("create real ancestor");
    fs::create_dir(real.join("base")).expect("create base");
    std::os::unix::fs::symlink(&real, &via_link).expect("symlink ancestor");
    expect_unavailable(
        resolve_fallback_root(&via_link.join("base"), &[]),
        FallbackUnavailableClassification::SecurityRejected,
    );
    fs::remove_dir_all(&root).ok();
}

#[test]
fn regular_file_leaf_is_security_rejected() {
    let base = temp_base();
    fs::write(base.join(FALLBACK_LEAF_DIR), b"not a directory").expect("write file");
    expect_unavailable(
        resolve_fallback_root(&base, &[]),
        FallbackUnavailableClassification::SecurityRejected,
    );
    fs::remove_dir_all(&base).ok();
}

#[test]
fn foreign_owned_base_is_security_rejected() {
    // SAFETY: geteuid has no preconditions.
    if unsafe { libc::geteuid() } == 0 {
        // Root owns everything; the ownership rejection cannot be observed.
        return;
    }
    expect_unavailable(
        resolve_fallback_root(Path::new("/"), &[]),
        FallbackUnavailableClassification::SecurityRejected,
    );
}
