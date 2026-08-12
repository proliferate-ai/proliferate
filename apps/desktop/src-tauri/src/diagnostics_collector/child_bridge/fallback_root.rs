#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

//! Secure resolution of one fixed per-component diagnostics fallback root.
//!
//! Tauri traverses the helper-owned parent components descriptor-relatively
//! without following symlinks and requires each to be a real effective-UID
//! owned directory whose mode it never rewrites. It creates or opens only the
//! terminal `diagnostics-fallback` leaf, requires that leaf to be a real
//! effective-UID-owned directory with exact mode `0700`, revalidates it after
//! creation, and returns the `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC` leaf
//! descriptor for transfer. Missing authority is an availability outcome,
//! never a product launch failure.

use std::{
    ffi::CString,
    io,
    mem::zeroed,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    os::unix::ffi::OsStrExt,
    path::{Component, Path},
};

use proliferate_diagnostics_client::bridge::wire::FallbackUnavailableClassification;

pub(crate) const FALLBACK_LEAF_DIR: &str = "diagnostics-fallback";

const OPEN_DIR_FLAGS: libc::c_int = libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

pub(crate) enum FallbackRootOutcome {
    Available(OwnedFd),
    Unavailable(FallbackUnavailableClassification),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadOnlyRootPolicy {
    ActiveFallback,
    HistoricalCompatibility,
}

pub(crate) enum ReadOnlyRootOutcome {
    Available(OwnedFd),
    Missing,
    Unreadable,
    UnsafeMetadata,
}

enum RootError {
    Io(io::Error),
    Security,
}

impl RootError {
    fn last_os_error() -> Self {
        Self::Io(io::Error::last_os_error())
    }

    fn is_not_found(&self) -> bool {
        matches!(self, Self::Io(error) if error.kind() == io::ErrorKind::NotFound)
    }

    fn classification(&self) -> FallbackUnavailableClassification {
        match self {
            Self::Security => FallbackUnavailableClassification::SecurityRejected,
            Self::Io(error) => match error.raw_os_error() {
                Some(libc::ELOOP) | Some(libc::ENOTDIR) => {
                    FallbackUnavailableClassification::SecurityRejected
                }
                _ => FallbackUnavailableClassification::DirectoryUnavailable,
            },
        }
    }
}

/// Resolves `base/<components...>/diagnostics-fallback`. `base` comes only
/// from the deterministic `app_config` helper for the component; the child
/// accepts no path, so a failure here degrades to fallback-unavailable.
pub(crate) fn resolve_fallback_root(base: &Path, components: &[&str]) -> FallbackRootOutcome {
    match resolve_inner(base, components) {
        Ok(descriptor) => FallbackRootOutcome::Available(descriptor),
        Err(error) => FallbackRootOutcome::Unavailable(error.classification()),
    }
}

/// Opens a pre-existing evidence directory without creating or repairing any
/// component. The deterministic base and finite components come from native
/// owners, never from a renderer path or record value.
pub(crate) fn open_read_only_root(
    base: &Path,
    components: &[&str],
    policy: ReadOnlyRootPolicy,
) -> ReadOnlyRootOutcome {
    match open_read_only_root_inner(base, components, policy) {
        Ok(descriptor) => ReadOnlyRootOutcome::Available(descriptor),
        Err(error) if error.is_not_found() => ReadOnlyRootOutcome::Missing,
        Err(RootError::Security) => ReadOnlyRootOutcome::UnsafeMetadata,
        Err(RootError::Io(error))
            if matches!(
                error.raw_os_error(),
                Some(libc::ELOOP) | Some(libc::ENOTDIR)
            ) =>
        {
            ReadOnlyRootOutcome::UnsafeMetadata
        }
        Err(RootError::Io(_)) => ReadOnlyRootOutcome::Unreadable,
    }
}

fn open_read_only_root_inner(
    base: &Path,
    components: &[&str],
    policy: ReadOnlyRootPolicy,
) -> Result<OwnedFd, RootError> {
    let mut current = open_anchor(base)?;
    validate_read_only_directory(
        &current,
        if components.is_empty() {
            policy
        } else {
            ReadOnlyRootPolicy::HistoricalCompatibility
        },
    )?;
    for (index, component) in components.iter().enumerate() {
        current = open_directory_at(&current, component)?;
        let component_policy = if index + 1 == components.len() {
            policy
        } else {
            ReadOnlyRootPolicy::HistoricalCompatibility
        };
        validate_read_only_directory(&current, component_policy)?;
    }
    Ok(current)
}

fn validate_read_only_directory(
    descriptor: &OwnedFd,
    policy: ReadOnlyRootPolicy,
) -> Result<(), RootError> {
    // SAFETY: zeroed stat is a valid output buffer for fstat.
    let mut stat: libc::stat = unsafe { zeroed() };
    // SAFETY: `descriptor` is an owned open descriptor.
    if unsafe { libc::fstat(descriptor.as_raw_fd(), &mut stat) } != 0 {
        return Err(RootError::last_os_error());
    }
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    let mode = u32::from(stat.st_mode) & 0o777;
    if stat.st_mode & libc::S_IFMT != libc::S_IFDIR || stat.st_uid != euid {
        return Err(RootError::Security);
    }
    match policy {
        ReadOnlyRootPolicy::ActiveFallback if mode != 0o700 => Err(RootError::Security),
        ReadOnlyRootPolicy::HistoricalCompatibility if mode & 0o022 != 0 => {
            Err(RootError::Security)
        }
        _ => Ok(()),
    }
}

fn resolve_inner(base: &Path, components: &[&str]) -> Result<OwnedFd, RootError> {
    let mut current = open_anchor(base)?;
    for component in components {
        current = open_directory_at(&current, component)?;
        validate_owned_directory(&current, None)?;
    }
    open_or_create_leaf(&current)
}

/// Opens every base-path component descriptor-relatively. `O_NOFOLLOW` thus
/// protects ancestors as well as the final base directory; an attacker
/// cannot replace an intermediate component with a symlink and escape the
/// deterministic helper-owned hierarchy.
fn open_anchor(path: &Path) -> Result<OwnedFd, RootError> {
    let mut parts = path.components();
    let anchor = match parts.next() {
        Some(Component::RootDir) => "/",
        _ => return Err(RootError::Security),
    };
    let anchor = CString::new(anchor).expect("static root has no NUL");
    // SAFETY: `anchor` is one static NUL-terminated root path.
    let descriptor = unsafe { libc::open(anchor.as_ptr(), OPEN_DIR_FLAGS) };
    if descriptor < 0 {
        return Err(RootError::last_os_error());
    }
    // SAFETY: the raw descriptor was just returned by `open` and is unowned.
    let mut current = unsafe { OwnedFd::from_raw_fd(descriptor) };
    for component in parts {
        let Component::Normal(name) = component else {
            return Err(RootError::Security);
        };
        current = open_directory_at_bytes(&current, name.as_bytes())?;
    }
    // System ancestors may be root-owned. Only the deterministic helper base
    // and its declared child components must belong to this effective UID.
    validate_owned_directory(&current, None)?;
    Ok(current)
}

fn open_directory_at(parent: &OwnedFd, name: &str) -> Result<OwnedFd, RootError> {
    open_directory_at_bytes(parent, name.as_bytes())
}

fn open_directory_at_bytes(parent: &OwnedFd, name: &[u8]) -> Result<OwnedFd, RootError> {
    if name.is_empty() || name == b"." || name == b".." || name.contains(&b'/') {
        return Err(RootError::Security);
    }
    let name = CString::new(name)
        .map_err(|_| RootError::Io(io::Error::from(io::ErrorKind::InvalidInput)))?;
    // SAFETY: `parent` is an owned directory descriptor and `name` is a valid
    // NUL-terminated single component.
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), OPEN_DIR_FLAGS) };
    if descriptor < 0 {
        return Err(RootError::last_os_error());
    }
    // SAFETY: the raw descriptor was just returned by `openat` and is unowned.
    Ok(unsafe { OwnedFd::from_raw_fd(descriptor) })
}

fn validate_owned_directory(
    descriptor: &OwnedFd,
    required_mode: Option<u32>,
) -> Result<(), RootError> {
    // SAFETY: zeroed stat is a valid output buffer for fstat.
    let mut stat: libc::stat = unsafe { zeroed() };
    // SAFETY: `descriptor` is an owned open descriptor.
    if unsafe { libc::fstat(descriptor.as_raw_fd(), &mut stat) } != 0 {
        return Err(RootError::last_os_error());
    }
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    if stat.st_mode & libc::S_IFMT != libc::S_IFDIR || stat.st_uid != euid {
        return Err(RootError::Security);
    }
    if let Some(mode) = required_mode {
        if u32::from(stat.st_mode) & 0o777 != mode {
            return Err(RootError::Security);
        }
    }
    Ok(())
}

fn open_or_create_leaf(parent: &OwnedFd) -> Result<OwnedFd, RootError> {
    match open_directory_at(parent, FALLBACK_LEAF_DIR) {
        Ok(leaf) => {
            // A pre-existing leaf is accepted only exactly as required; its
            // mode is never rewritten.
            validate_owned_directory(&leaf, Some(0o700))?;
            Ok(leaf)
        }
        Err(error) if error.is_not_found() => create_and_revalidate_leaf(parent),
        Err(error) => Err(error),
    }
}

fn create_and_revalidate_leaf(parent: &OwnedFd) -> Result<OwnedFd, RootError> {
    let name = CString::new(FALLBACK_LEAF_DIR)
        .map_err(|_| RootError::Io(io::Error::from(io::ErrorKind::InvalidInput)))?;
    // SAFETY: `parent` is an owned directory descriptor and `name` is valid.
    let created = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) } == 0;
    if !created {
        let error = io::Error::last_os_error();
        // An EEXIST race reopens strictly through the existing-leaf path.
        if error.raw_os_error() != Some(libc::EEXIST) {
            return Err(RootError::Io(error));
        }
    }
    let leaf = open_directory_at(parent, FALLBACK_LEAF_DIR)?;
    if created {
        // The umask may have masked owner bits off the directory this process
        // just created; pin the exact required mode before revalidation.
        // SAFETY: `leaf` is an owned descriptor for the directory just made.
        unsafe { libc::fchmod(leaf.as_raw_fd(), 0o700) };
    }
    validate_owned_directory(&leaf, Some(0o700))?;
    Ok(leaf)
}

#[cfg(test)]
#[path = "fallback_root_tests.rs"]
mod tests;
