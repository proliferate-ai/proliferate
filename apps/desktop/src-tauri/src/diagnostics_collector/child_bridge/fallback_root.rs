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
    path::Path,
};

use proliferate_diagnostics_client::bridge::wire::FallbackUnavailableClassification;

pub(crate) const FALLBACK_LEAF_DIR: &str = "diagnostics-fallback";

const OPEN_DIR_FLAGS: libc::c_int = libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

pub(crate) enum FallbackRootOutcome {
    Available(OwnedFd),
    Unavailable(FallbackUnavailableClassification),
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

fn resolve_inner(base: &Path, components: &[&str]) -> Result<OwnedFd, RootError> {
    let mut current = open_directory_path(base)?;
    validate_owned_directory(&current, None)?;
    for component in components {
        current = open_directory_at(&current, component)?;
        validate_owned_directory(&current, None)?;
    }
    open_or_create_leaf(&current)
}

fn open_directory_path(path: &Path) -> Result<OwnedFd, RootError> {
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| RootError::Io(io::Error::from(io::ErrorKind::InvalidInput)))?;
    // SAFETY: `path` is a valid NUL-terminated string for the open call.
    let descriptor = unsafe { libc::open(path.as_ptr(), OPEN_DIR_FLAGS) };
    if descriptor < 0 {
        return Err(RootError::last_os_error());
    }
    // SAFETY: the raw descriptor was just returned by `open` and is unowned.
    Ok(unsafe { OwnedFd::from_raw_fd(descriptor) })
}

fn open_directory_at(parent: &OwnedFd, name: &str) -> Result<OwnedFd, RootError> {
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
