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
    let created = match fs::symlink_metadata(path) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => match fs::create_dir(path) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
            Err(_) => return Err(ArtifactStoreError::Io),
        },
        Err(_) => return Err(ArtifactStoreError::Io),
    };
    let descriptor = open_root_descriptor(path)?;
    if created {
        // SAFETY: the descriptor was opened without following a symlink and
        // still refers to the directory this call won the right to create.
        if unsafe { libc::fchmod(descriptor.as_raw_fd(), 0o700) } != 0 {
            return Err(ArtifactStoreError::Io);
        }
    }
    validate_directory(&descriptor, true)?;
    Ok(descriptor)
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
    let mode = u32::from(stat.st_mode) & 0o777;
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
    let mode = u32::from(stat.st_mode) & 0o777;
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
