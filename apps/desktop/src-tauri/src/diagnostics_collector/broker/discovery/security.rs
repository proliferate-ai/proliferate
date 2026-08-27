use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use super::{DiscoveryError, MAX_DARWIN_SOCKET_PATH_BYTES};

pub(super) fn effective_uid() -> u32 {
    // SAFETY: geteuid has no preconditions.
    unsafe { libc::geteuid() }
}

pub(crate) fn peer_uid_is_owner(uid: u32) -> bool {
    uid == effective_uid()
}

pub(crate) fn peer_matches_locator(uid: u32, pid: Option<i32>, expected_pid: u32) -> bool {
    peer_uid_is_owner(uid) && pid.and_then(|value| u32::try_from(value).ok()) == Some(expected_pid)
}

pub(super) fn owner_file_metadata_is_safe(
    regular_file: bool,
    uid: u32,
    mode: u32,
    exact_mode: Option<u32>,
) -> bool {
    regular_file
        && peer_uid_is_owner(uid)
        && exact_mode.is_none_or(|expected| mode == expected)
        && (exact_mode.is_some() || mode & 0o022 == 0)
}

pub(super) fn validate_socket_path(path: &Path) -> Result<(), DiscoveryError> {
    (path.is_absolute() && path.as_os_str().as_bytes().len() <= MAX_DARWIN_SOCKET_PATH_BYTES)
        .then_some(())
        .ok_or(DiscoveryError::InvalidNamespace)
}
