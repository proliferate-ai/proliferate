use std::{
    ffi::{CStr, CString},
    fs,
    mem::zeroed,
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd},
        unix::ffi::OsStrExt,
    },
    path::Path,
};

use super::super::ArtifactStoreError;

pub(super) const OPEN_DIR_FLAGS: libc::c_int =
    libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
const OPEN_READ_FLAGS: libc::c_int = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

pub(super) fn ensure_root(path: &Path) -> Result<OwnedFd, ArtifactStoreError> {
    match create_private_directory(path) {
        Ok(()) | Err(ArtifactStoreError::AlreadyExists) => {}
        Err(error) => return Err(error),
    }
    let descriptor = open_root_descriptor(path)?;
    restrict_root_mode(&descriptor)?;
    validate_directory(&descriptor, true)?;
    Ok(descriptor)
}

/// Create the root already private.
///
/// The mode belongs in the `mkdir` call, not in a `fchmod` after it. Creating
/// at `0o777` and tightening afterwards leaves the staging root group- and
/// world-writable for the whole gap between the two calls, which is long
/// enough for another local process to open a descriptor it keeps. The umask
/// only ever clears bits, so `0o700` here is an upper bound and the directory
/// is never born more permissive than that.
fn create_private_directory(path: &Path) -> Result<(), ArtifactStoreError> {
    let path =
        CString::new(path.as_os_str().as_bytes()).map_err(|_| ArtifactStoreError::InvalidInput)?;
    // SAFETY: path is NUL-terminated.
    if unsafe { libc::mkdir(path.as_ptr(), 0o700) } == 0 {
        return Ok(());
    }
    Err(map_create_error(std::io::Error::last_os_error()))
}

/// Bring a root this user owns to exactly `0o700`.
///
/// Two roots reach here needing repair: one an older build left at the umask's
/// mode, and one whose creation raced a restrictive umask into something
/// tighter than `0o700`. Both are rejected by the exact-mode check that
/// follows, and without a repair that rejection is permanent -- the store
/// would refuse to stage on that machine forever, with no way for a user to
/// discover why. Tightening is only ever a reduction in exposure, and every
/// file inside is re-validated on its own metadata when it is read.
///
/// A root that is not a directory, or not owned by this user, is left exactly
/// as it is for `validate_directory` to refuse. Repairing someone else's
/// directory is not this code's business, and would fail anyway.
fn restrict_root_mode(descriptor: &OwnedFd) -> Result<(), ArtifactStoreError> {
    let stat = descriptor_stat(descriptor)?;
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    if stat.st_mode & libc::S_IFMT != libc::S_IFDIR || stat.st_uid != euid {
        return Ok(());
    }
    // mode_t-typed arithmetic: st_mode is u16 on macOS and u32 on Linux, so a
    // literal-typed mask works on both without a platform-dependent conversion.
    if stat.st_mode & 0o777 == 0o700 {
        return Ok(());
    }
    // SAFETY: the descriptor is open, owned, and was opened without following
    // a symlink, so it still refers to the directory that was just stat'd.
    if unsafe { libc::fchmod(descriptor.as_raw_fd(), 0o700) } != 0 {
        return Err(ArtifactStoreError::Io);
    }
    Ok(())
}

pub(super) fn open_existing_root(path: &Path) -> Result<Option<OwnedFd>, ArtifactStoreError> {
    match fs::symlink_metadata(path) {
        Ok(_) => open_root(path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(ArtifactStoreError::Io),
    }
}

fn open_root(path: &Path) -> Result<OwnedFd, ArtifactStoreError> {
    let descriptor = open_root_descriptor(path)?;
    validate_directory(&descriptor, true)?;
    Ok(descriptor)
}

fn open_root_descriptor(path: &Path) -> Result<OwnedFd, ArtifactStoreError> {
    let path =
        CString::new(path.as_os_str().as_bytes()).map_err(|_| ArtifactStoreError::InvalidInput)?;
    // SAFETY: path is NUL-terminated and flags reject a symlink leaf.
    let raw = unsafe { libc::open(path.as_ptr(), OPEN_DIR_FLAGS) };
    if raw < 0 {
        return Err(ArtifactStoreError::UnsafeMetadata);
    }
    // SAFETY: raw is newly owned.
    Ok(unsafe { OwnedFd::from_raw_fd(raw) })
}

pub(super) fn open_existing_compat_directory(
    path: &Path,
) -> Result<Option<OwnedFd>, ArtifactStoreError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ArtifactStoreError::Io),
        Ok(_) => {}
    }
    let path =
        CString::new(path.as_os_str().as_bytes()).map_err(|_| ArtifactStoreError::InvalidInput)?;
    // SAFETY: path is NUL-terminated and flags reject a symlink leaf.
    let raw = unsafe { libc::open(path.as_ptr(), OPEN_DIR_FLAGS) };
    if raw < 0 {
        return Err(ArtifactStoreError::UnsafeMetadata);
    }
    // SAFETY: raw is newly owned.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    validate_directory(&descriptor, false)?;
    Ok(Some(descriptor))
}

pub(super) fn open_compat_directory_at(
    parent: &OwnedFd,
    name: &[u8],
) -> Result<OwnedFd, ArtifactStoreError> {
    let name = cstring_component(name)?;
    // SAFETY: parent is an open directory and name is one component.
    let raw = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), OPEN_DIR_FLAGS) };
    if raw < 0 {
        return Err(ArtifactStoreError::UnsafeMetadata);
    }
    // SAFETY: raw is newly owned.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    validate_directory(&descriptor, false)?;
    Ok(descriptor)
}

fn validate_directory(descriptor: &OwnedFd, exact: bool) -> Result<(), ArtifactStoreError> {
    let stat = descriptor_stat(descriptor)?;
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    // mode_t-typed mask; see restrict_root_mode.
    let mode = stat.st_mode & 0o777;
    if stat.st_mode & libc::S_IFMT != libc::S_IFDIR
        || stat.st_uid != euid
        || (exact && mode != 0o700)
        || (!exact && mode & 0o022 != 0)
    {
        return Err(ArtifactStoreError::UnsafeMetadata);
    }
    Ok(())
}

pub(super) fn create_private_file_at(
    parent: &OwnedFd,
    name: &str,
) -> Result<OwnedFd, ArtifactStoreError> {
    let name = CString::new(name).map_err(|_| ArtifactStoreError::InvalidInput)?;
    // SAFETY: parent is open and name is one fixed leaf.
    let raw = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600,
        )
    };
    if raw < 0 {
        return Err(map_create_error(std::io::Error::last_os_error()));
    }
    // SAFETY: raw is newly owned.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    // SAFETY: descriptor is open and owned.
    if unsafe { libc::fchmod(descriptor.as_raw_fd(), 0o600) } != 0 {
        // SAFETY: parent/name still identify only the create-new leaf.
        unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) };
        return Err(ArtifactStoreError::Io);
    }
    Ok(descriptor)
}

pub(super) fn open_safe_file_at(
    parent: &OwnedFd,
    name: &str,
) -> Result<(OwnedFd, u64), ArtifactStoreError> {
    let name = CString::new(name).map_err(|_| ArtifactStoreError::InvalidInput)?;
    // SAFETY: parent is an open directory and name is one component.
    let raw = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), OPEN_READ_FLAGS) };
    if raw < 0 {
        return Err(map_open_error(std::io::Error::last_os_error()));
    }
    // SAFETY: raw is newly owned.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    let size = validate_private_file(&descriptor)?;
    Ok((descriptor, size))
}

pub(super) fn safe_file_metadata_at(
    parent: &OwnedFd,
    name: &str,
) -> Result<u64, ArtifactStoreError> {
    let name = CString::new(name).map_err(|_| ArtifactStoreError::InvalidInput)?;
    safe_file_metadata_cstr(parent, &name, true)
}

pub(super) fn safe_compat_file_metadata_cstr(
    parent: &OwnedFd,
    name: &CStr,
) -> Result<u64, ArtifactStoreError> {
    safe_file_metadata_cstr(parent, name, false)
}

fn safe_file_metadata_cstr(
    parent: &OwnedFd,
    name: &CStr,
    exact_mode: bool,
) -> Result<u64, ArtifactStoreError> {
    // SAFETY: zeroed stat is valid output and parent/name are valid.
    let mut stat: libc::stat = unsafe { zeroed() };
    if unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            &mut stat,
            libc::AT_SYMLINK_NOFOLLOW,
        )
    } != 0
    {
        return Err(map_open_error(std::io::Error::last_os_error()));
    }
    validate_file_stat(&stat, exact_mode)
}

fn validate_private_file(descriptor: &OwnedFd) -> Result<u64, ArtifactStoreError> {
    validate_file_stat(&descriptor_stat(descriptor)?, true)
}

fn validate_file_stat(stat: &libc::stat, exact_mode: bool) -> Result<u64, ArtifactStoreError> {
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    // mode_t-typed mask; see restrict_root_mode.
    let mode = stat.st_mode & 0o777;
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG
        || stat.st_uid != euid
        || stat.st_nlink != 1
        || (exact_mode && mode != 0o600)
        || (!exact_mode && mode & 0o022 != 0)
        || stat.st_size < 0
    {
        return Err(ArtifactStoreError::UnsafeMetadata);
    }
    Ok(stat.st_size as u64)
}

fn descriptor_stat(descriptor: &OwnedFd) -> Result<libc::stat, ArtifactStoreError> {
    // SAFETY: zeroed stat is a valid output buffer.
    let mut stat: libc::stat = unsafe { zeroed() };
    // SAFETY: descriptor is open and owned.
    if unsafe { libc::fstat(descriptor.as_raw_fd(), &mut stat) } != 0 {
        return Err(ArtifactStoreError::Io);
    }
    Ok(stat)
}

pub(super) fn for_each_entry(
    directory: &OwnedFd,
    mut visit: impl FnMut(&[u8]) -> Result<(), ArtifactStoreError>,
) -> Result<(), ArtifactStoreError> {
    // SAFETY: dup returns a new descriptor for fdopendir ownership.
    let duplicate = unsafe { libc::dup(directory.as_raw_fd()) };
    if duplicate < 0 {
        return Err(ArtifactStoreError::Io);
    }
    // SAFETY: duplicate is an owned open directory descriptor.
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        // SAFETY: fdopendir did not take ownership on failure.
        unsafe { libc::close(duplicate) };
        return Err(ArtifactStoreError::Io);
    }
    loop {
        // SAFETY: stream remains valid until closed below.
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            break;
        }
        // SAFETY: d_name is NUL-terminated for this entry.
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name != b"." && name != b".." {
            if let Err(error) = visit(name) {
                // SAFETY: stream is valid and owns duplicate.
                unsafe { libc::closedir(stream) };
                return Err(error);
            }
        }
    }
    // SAFETY: stream is valid and owns duplicate.
    if unsafe { libc::closedir(stream) } != 0 {
        return Err(ArtifactStoreError::Io);
    }
    Ok(())
}

pub(super) fn rename_noreplace_at(
    directory: &OwnedFd,
    from: &str,
    to: &str,
) -> Result<(), ArtifactStoreError> {
    let from = CString::new(from).map_err(|_| ArtifactStoreError::InvalidInput)?;
    let to = CString::new(to).map_err(|_| ArtifactStoreError::InvalidInput)?;
    #[cfg(target_os = "macos")]
    // SAFETY: directory/name pairs are valid; RENAME_EXCL prevents replacement.
    let result = unsafe {
        libc::renameatx_np(
            directory.as_raw_fd(),
            from.as_ptr(),
            directory.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    // SAFETY: directory/name pairs are valid; RENAME_NOREPLACE prevents replacement.
    let result = unsafe {
        libc::renameat2(
            directory.as_raw_fd(),
            from.as_ptr(),
            directory.as_raw_fd(),
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    // SAFETY: linkat refuses an existing target, then unlinkat removes the partial.
    let result = unsafe {
        let linked = libc::linkat(
            directory.as_raw_fd(),
            from.as_ptr(),
            directory.as_raw_fd(),
            to.as_ptr(),
            0,
        );
        if linked == 0 {
            if libc::unlinkat(directory.as_raw_fd(), from.as_ptr(), 0) == 0 {
                0
            } else {
                let _ = libc::unlinkat(directory.as_raw_fd(), to.as_ptr(), 0);
                -1
            }
        } else {
            linked
        }
    };
    if result == 0 {
        Ok(())
    } else {
        Err(map_create_error(std::io::Error::last_os_error()))
    }
}

pub(super) fn rename_path_noreplace(from: &Path, to: &Path) -> Result<(), ArtifactStoreError> {
    let from =
        CString::new(from.as_os_str().as_bytes()).map_err(|_| ArtifactStoreError::InvalidInput)?;
    let to =
        CString::new(to.as_os_str().as_bytes()).map_err(|_| ArtifactStoreError::InvalidInput)?;
    #[cfg(target_os = "macos")]
    // SAFETY: paths are NUL-terminated and RENAME_EXCL prevents replacement.
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    #[cfg(target_os = "linux")]
    // SAFETY: paths are NUL-terminated and RENAME_NOREPLACE prevents replacement.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    // SAFETY: both paths are NUL-terminated. link refuses an existing target;
    // rollback removes that link if the source unlink cannot complete.
    let result = unsafe {
        let linked = libc::link(from.as_ptr(), to.as_ptr());
        if linked == 0 {
            if libc::unlink(from.as_ptr()) == 0 {
                0
            } else {
                let _ = libc::unlink(to.as_ptr());
                -1
            }
        } else {
            linked
        }
    };
    if result == 0 {
        Ok(())
    } else {
        Err(map_create_error(std::io::Error::last_os_error()))
    }
}

pub(super) fn unlink_file_at(parent: &OwnedFd, name: &str) -> Result<(), ArtifactStoreError> {
    let name = CString::new(name).map_err(|_| ArtifactStoreError::InvalidInput)?;
    unlink_cstr(parent, &name)
}

pub(super) fn unlink_cstr(parent: &OwnedFd, name: &CStr) -> Result<(), ArtifactStoreError> {
    // SAFETY: parent is an open directory and name is one component.
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), 0) } == 0 {
        Ok(())
    } else {
        Err(map_open_error(std::io::Error::last_os_error()))
    }
}

pub(super) fn remove_directory_if_empty(
    parent: &OwnedFd,
    name: &[u8],
) -> Result<(), ArtifactStoreError> {
    let name = cstring_component(name)?;
    // SAFETY: parent is an open directory and name is one component.
    if unsafe { libc::unlinkat(parent.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if matches!(
        error.raw_os_error(),
        Some(libc::ENOTEMPTY) | Some(libc::EEXIST)
    ) {
        Ok(())
    } else {
        Err(map_open_error(error))
    }
}

pub(super) fn cstring_component(value: &[u8]) -> Result<CString, ArtifactStoreError> {
    if value.is_empty() || value == b"." || value == b".." || value.contains(&b'/') {
        return Err(ArtifactStoreError::InvalidInput);
    }
    CString::new(value).map_err(|_| ArtifactStoreError::InvalidInput)
}

pub(super) fn sync_directory(directory: &OwnedFd) -> Result<(), ArtifactStoreError> {
    // SAFETY: fsync accepts an open directory on supported Unix targets.
    if unsafe { libc::fsync(directory.as_raw_fd()) } == 0 {
        Ok(())
    } else {
        Err(ArtifactStoreError::Io)
    }
}

pub(super) fn map_create_error(error: std::io::Error) -> ArtifactStoreError {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        ArtifactStoreError::AlreadyExists
    } else {
        ArtifactStoreError::Io
    }
}

fn map_open_error(error: std::io::Error) -> ArtifactStoreError {
    match error.kind() {
        std::io::ErrorKind::NotFound => ArtifactStoreError::Missing,
        _ if matches!(
            error.raw_os_error(),
            Some(libc::ELOOP) | Some(libc::ENOTDIR)
        ) =>
        {
            ArtifactStoreError::UnsafeMetadata
        }
        _ => ArtifactStoreError::Io,
    }
}

pub(super) struct PartialCleanup<'a> {
    directory: &'a OwnedFd,
    name: String,
    armed: bool,
}

impl<'a> PartialCleanup<'a> {
    pub(super) fn new(directory: &'a OwnedFd, name: String) -> Self {
        Self {
            directory,
            name,
            armed: true,
        }
    }

    pub(super) fn track(&mut self, name: String) {
        self.name = name;
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PartialCleanup<'_> {
    fn drop(&mut self) {
        if self.armed {
            let _ = unlink_file_at(self.directory, &self.name);
            let _ = sync_directory(self.directory);
        }
    }
}

pub(super) struct PathCleanup {
    path: std::path::PathBuf,
    armed: bool,
}

impl PathCleanup {
    pub(super) fn new(path: std::path::PathBuf) -> Self {
        Self { path, armed: true }
    }

    pub(super) fn track(&mut self, path: std::path::PathBuf) {
        self.path = path;
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PathCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn fixture_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "proliferate-support-artifact-root-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&root).expect("create fixture parent");
        root
    }

    fn mode_of(path: &Path) -> u32 {
        fs::symlink_metadata(path)
            .expect("fixture metadata")
            .permissions()
            .mode()
            & 0o777
    }

    /// The create step on its own, because that is where the window was.
    ///
    /// Tightening after the fact cannot be observed from outside the process,
    /// so asserting only on `ensure_root`'s finished state would pass just as
    /// happily over a root that spent its first moments world-writable. This
    /// asserts the directory is already private the instant it exists.
    #[test]
    fn a_created_root_is_private_from_the_moment_it_exists() {
        let parent = fixture_root();
        let root = parent.join("artifacts");

        create_private_directory(&root).expect("create the root");

        assert_eq!(
            mode_of(&root) & 0o077,
            0,
            "the creating call itself must grant nothing to group or other",
        );
        fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn creating_a_root_that_already_exists_is_reported_not_silently_retried() {
        let parent = fixture_root();
        let root = parent.join("artifacts");
        create_private_directory(&root).expect("create the root");

        assert!(matches!(
            create_private_directory(&root),
            Err(ArtifactStoreError::AlreadyExists)
        ));
        fs::remove_dir_all(parent).ok();
    }

    /// A loose root is repaired, not condemned.
    ///
    /// An older build left this directory at the umask's mode. The exact-mode
    /// check refuses it, so without the repair the store could never stage
    /// another artifact on that machine.
    #[test]
    fn an_existing_loose_root_is_tightened_rather_than_wedged() {
        let parent = fixture_root();
        let root = parent.join("artifacts");
        fs::create_dir(&root).expect("pre-existing root");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).expect("loosen the root");

        ensure_root(&root).expect("an owned root must be repaired, not refused");

        assert_eq!(mode_of(&root), 0o700);
        fs::remove_dir_all(parent).ok();
    }

    /// A root created under a restrictive umask is the same case from the
    /// other side: `mkdir` asks for `0o700` and the umask may hand back less.
    #[test]
    fn an_existing_over_tight_root_is_normalised_to_exactly_private() {
        let parent = fixture_root();
        let root = parent.join("artifacts");
        fs::create_dir(&root).expect("pre-existing root");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o500)).expect("tighten the root");

        ensure_root(&root).expect("an owned root must be repaired, not refused");

        assert_eq!(mode_of(&root), 0o700);
        fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn a_root_that_is_a_symlink_is_refused_rather_than_followed() {
        let parent = fixture_root();
        let target = parent.join("elsewhere");
        fs::create_dir(&target).expect("symlink target");
        let root = parent.join("artifacts");
        std::os::unix::fs::symlink(&target, &root).expect("symlink the root into place");
        let target_mode_before = mode_of(&target);

        assert!(matches!(
            ensure_root(&root),
            Err(ArtifactStoreError::UnsafeMetadata)
        ));
        // The repair must not have reached through the link into a directory
        // the caller never named.
        assert_eq!(mode_of(&target), target_mode_before);
        fs::remove_dir_all(parent).ok();
    }

    #[test]
    fn ensure_root_leaves_an_already_private_root_alone() {
        let parent = fixture_root();
        let root = parent.join("artifacts");

        let first = ensure_root(&root).expect("create");
        drop(first);
        let second = ensure_root(&root).expect("reopen");
        drop(second);

        assert_eq!(mode_of(&root), 0o700);
        fs::remove_dir_all(parent).ok();
    }
}
