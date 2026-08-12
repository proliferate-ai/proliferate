use std::ffi::CString;
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};

use proliferate_diagnostics_protocol::v1::types::ProducerRecordV1;

use crate::{bridge::activation::FallbackDirectoryHandle, DiagnosticsComponent};

use super::wire::FallbackRecordV1;
use super::{
    FallbackError, FallbackReason, FallbackStatus, FALLBACK_SEGMENT_BYTES, FALLBACK_TOTAL_BYTES,
};

const ANYHARNESS_SEGMENTS: [&str; 4] = [
    "anyharness.jsonl",
    "anyharness.jsonl.1",
    "anyharness.jsonl.2",
    "anyharness.jsonl.3",
];
const WORKER_SEGMENTS: [&str; 4] = [
    "desktop-worker.jsonl",
    "desktop-worker.jsonl.1",
    "desktop-worker.jsonl.2",
    "desktop-worker.jsonl.3",
];

#[derive(Clone, Copy)]
struct FamilyNames {
    lock: &'static str,
    segments: [&'static str; 4],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    device: libc::dev_t,
    inode: libc::ino_t,
}

#[derive(Clone, Copy)]
struct SafeFileStat {
    identity: FileIdentity,
    bytes: u32,
}

struct OpenSegment {
    file: File,
    stat: SafeFileStat,
}

pub(super) struct PlatformFallbackWriter {
    component: DiagnosticsComponent,
    names: FamilyNames,
    directory: File,
    lock_file: File,
    lock_identity: FileIdentity,
    active_file: File,
    active_identity: FileIdentity,
    active_bytes: u32,
    retained_bytes: u32,
    active: bool,
}

impl PlatformFallbackWriter {
    pub(super) fn from_directory(
        component: DiagnosticsComponent,
        handle: FallbackDirectoryHandle,
    ) -> Result<Self, FallbackError> {
        let directory = File::from(handle.descriptor);
        set_cloexec(&directory).map_err(|_| FallbackError::UnsafeDirectory)?;
        validate_directory(&directory)?;
        let names = family_names(component);

        let lock = open_or_create(&directory, names.lock, false)?;
        acquire_lifetime_lock(&lock.file)?;
        ensure_path_identity(&directory, names.lock, lock.stat.identity)?;

        let mut retained_bytes = 0_u32;
        for name in names.segments.iter().skip(1) {
            if let Some(segment) = open_existing(&directory, name, false)? {
                retained_bytes = retained_bytes
                    .checked_add(segment.stat.bytes)
                    .filter(|bytes| *bytes <= FALLBACK_TOTAL_BYTES)
                    .ok_or(FallbackError::UnsafeEntry)?;
            }
        }
        let active = open_or_create(&directory, names.segments[0], true)?;
        retained_bytes = retained_bytes
            .checked_add(active.stat.bytes)
            .filter(|bytes| *bytes <= FALLBACK_TOTAL_BYTES)
            .ok_or(FallbackError::UnsafeEntry)?;

        Ok(Self {
            component,
            names,
            directory,
            lock_file: lock.file,
            lock_identity: lock.stat.identity,
            active_file: active.file,
            active_identity: active.stat.identity,
            active_bytes: active.stat.bytes,
            retained_bytes,
            active: true,
        })
    }

    pub(super) fn write(
        &mut self,
        reason: FallbackReason,
        record: &ProducerRecordV1,
    ) -> Result<u32, FallbackError> {
        let line = FallbackRecordV1::encode(self.component, reason, record)?;
        self.write_encoded(&line)
    }

    fn write_encoded(&mut self, line: &[u8]) -> Result<u32, FallbackError> {
        if !self.active {
            return Err(FallbackError::WriteFailed);
        }
        let line_bytes = u32::try_from(line.len()).map_err(|_| FallbackError::RecordTooLarge)?;
        if line_bytes > FALLBACK_SEGMENT_BYTES {
            return Err(FallbackError::RecordTooLarge);
        }

        let result = self.write_line(&line, line_bytes);
        if matches!(
            result,
            Err(FallbackError::UnsafeDirectory
                | FallbackError::UnsafeEntry
                | FallbackError::WriteFailed)
        ) {
            self.active = false;
        }
        result.map(|_| line_bytes)
    }

    #[cfg(test)]
    pub(super) fn write_encoded_for_test(&mut self, line: &[u8]) -> Result<u32, FallbackError> {
        self.write_encoded(line)
    }

    pub(super) fn current_status(&self) -> FallbackStatus {
        FallbackStatus {
            active: self.active,
            bytes: self.retained_bytes.min(FALLBACK_TOTAL_BYTES),
        }
    }

    fn write_line(&mut self, line: &[u8], line_bytes: u32) -> Result<(), FallbackError> {
        self.validate_live_authority()?;
        if self
            .active_bytes
            .checked_add(line_bytes)
            .map_or(true, |bytes| bytes > FALLBACK_SEGMENT_BYTES)
        {
            self.rotate()?;
            self.validate_live_authority()?;
        }

        let starting_bytes = self.active_bytes;
        let written = unsafe {
            libc::write(
                self.active_file.as_raw_fd(),
                line.as_ptr().cast(),
                line.len(),
            )
        };
        if written < 0 {
            return Err(FallbackError::WriteFailed);
        }
        let written = usize::try_from(written).map_err(|_| FallbackError::WriteFailed)?;
        if written != line.len() {
            self.rollback_partial(starting_bytes, written as u32)?;
            return Err(FallbackError::WriteFailed);
        }

        let expected = starting_bytes
            .checked_add(line_bytes)
            .ok_or(FallbackError::WriteFailed)?;
        let stat = validate_file(&self.active_file)?;
        ensure_path_identity(
            &self.directory,
            self.names.segments[0],
            self.active_identity,
        )?;
        if stat.identity != self.active_identity || stat.bytes != expected {
            return Err(FallbackError::UnsafeEntry);
        }
        self.active_bytes = expected;
        self.retained_bytes = self
            .retained_bytes
            .checked_add(line_bytes)
            .filter(|bytes| *bytes <= FALLBACK_TOTAL_BYTES)
            .ok_or(FallbackError::WriteFailed)?;
        Ok(())
    }

    fn validate_live_authority(&self) -> Result<(), FallbackError> {
        validate_directory(&self.directory)?;
        let lock = validate_file(&self.lock_file)?;
        if lock.identity != self.lock_identity {
            return Err(FallbackError::UnsafeEntry);
        }
        ensure_path_identity(&self.directory, self.names.lock, self.lock_identity)?;
        let active = validate_file(&self.active_file)?;
        if active.identity != self.active_identity || active.bytes != self.active_bytes {
            return Err(FallbackError::UnsafeEntry);
        }
        ensure_path_identity(
            &self.directory,
            self.names.segments[0],
            self.active_identity,
        )
    }

    fn rotate(&mut self) -> Result<(), FallbackError> {
        self.validate_live_authority()?;
        let rotated = [
            open_or_create(&self.directory, self.names.segments[1], false)?,
            open_or_create(&self.directory, self.names.segments[2], false)?,
            open_or_create(&self.directory, self.names.segments[3], true)?,
        ];
        let mut identities = [
            self.active_identity,
            rotated[0].stat.identity,
            rotated[1].stat.identity,
            rotated[2].stat.identity,
        ];
        let swaps = [(2_usize, 3_usize), (1, 2), (0, 1)];
        let mut completed = 0;
        for (left, right) in swaps {
            if let Err(error) = swap_verified(
                &self.directory,
                self.names.segments[left],
                self.names.segments[right],
                identities[left],
                identities[right],
                true,
            ) {
                rollback_swaps(
                    &self.directory,
                    &self.names,
                    &mut identities,
                    &swaps,
                    completed,
                );
                return Err(error);
            }
            identities.swap(left, right);
            completed += 1;
        }

        let [_, _, oldest] = rotated;
        before_rotation_mutation(self.names.segments[0], self.names.segments[0]);
        ensure_path_identity(
            &self.directory,
            self.names.segments[0],
            oldest.stat.identity,
        )?;
        if unsafe { libc::ftruncate(oldest.file.as_raw_fd(), 0) } != 0 {
            return Err(FallbackError::WriteFailed);
        }
        let active = validate_file(&oldest.file)?;
        ensure_path_identity(&self.directory, self.names.segments[0], active.identity)?;
        if active.bytes != 0 {
            return Err(FallbackError::WriteFailed);
        }
        self.active_file = oldest.file;
        self.active_identity = active.identity;
        self.active_bytes = 0;
        self.retained_bytes = self.retained_bytes.saturating_sub(oldest.stat.bytes);
        Ok(())
    }

    fn rollback_partial(&self, starting_bytes: u32, written: u32) -> Result<(), FallbackError> {
        let stat = validate_file(&self.active_file)?;
        ensure_path_identity(
            &self.directory,
            self.names.segments[0],
            self.active_identity,
        )?;
        if stat.identity != self.active_identity
            || stat.bytes != starting_bytes.saturating_add(written)
        {
            return Err(FallbackError::UnsafeEntry);
        }
        let result =
            unsafe { libc::ftruncate(self.active_file.as_raw_fd(), starting_bytes as libc::off_t) };
        if result != 0 {
            return Err(FallbackError::WriteFailed);
        }
        let restored = validate_file(&self.active_file)?;
        if restored.identity != self.active_identity || restored.bytes != starting_bytes {
            return Err(FallbackError::WriteFailed);
        }
        Ok(())
    }
}

fn family_names(component: DiagnosticsComponent) -> FamilyNames {
    match component {
        DiagnosticsComponent::AnyHarness => FamilyNames {
            lock: "anyharness.lock",
            segments: ANYHARNESS_SEGMENTS,
        },
        DiagnosticsComponent::DesktopWorker => FamilyNames {
            lock: "desktop-worker.lock",
            segments: WORKER_SEGMENTS,
        },
    }
}

fn validate_directory(directory: &File) -> Result<(), FallbackError> {
    let stat = raw_fstat(directory.as_raw_fd()).map_err(|_| FallbackError::UnsafeDirectory)?;
    let descriptor_flags = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETFD) };
    if descriptor_flags < 0
        || descriptor_flags & libc::FD_CLOEXEC == 0
        || file_kind(stat.st_mode) != libc::S_IFDIR
        || stat.st_uid != effective_uid()
        || permission_bits(stat.st_mode) != 0o700
    {
        return Err(FallbackError::UnsafeDirectory);
    }
    Ok(())
}

fn open_or_create(
    directory: &File,
    name: &str,
    append: bool,
) -> Result<OpenSegment, FallbackError> {
    if let Some(existing) = open_existing(directory, name, append)? {
        return Ok(existing);
    }
    match create_new(directory, name, append) {
        Ok(created) => Ok(created),
        Err(FallbackError::UnsafeEntry) => {
            open_existing(directory, name, append)?.ok_or(FallbackError::UnsafeEntry)
        }
        Err(error) => Err(error),
    }
}

fn open_existing(
    directory: &File,
    name: &str,
    append: bool,
) -> Result<Option<OpenSegment>, FallbackError> {
    let mut flags = libc::O_RDWR | libc::O_CLOEXEC | libc::O_NOFOLLOW;
    if append {
        flags |= libc::O_APPEND;
    }
    let raw = unsafe { libc::openat(directory.as_raw_fd(), c_name(name).as_ptr(), flags) };
    if raw < 0 {
        return if last_errno() == libc::ENOENT {
            Ok(None)
        } else {
            Err(FallbackError::UnsafeEntry)
        };
    }
    let file = unsafe { File::from_raw_fd(raw) };
    let stat = validate_file(&file)?;
    ensure_path_identity(directory, name, stat.identity)?;
    Ok(Some(OpenSegment { file, stat }))
}

fn create_new(directory: &File, name: &str, append: bool) -> Result<OpenSegment, FallbackError> {
    let mut flags =
        libc::O_RDWR | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_CREAT | libc::O_EXCL;
    if append {
        flags |= libc::O_APPEND;
    }
    let raw = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            c_name(name).as_ptr(),
            flags,
            0o600 as libc::c_int,
        )
    };
    if raw < 0 {
        return if last_errno() == libc::EEXIST {
            Err(FallbackError::UnsafeEntry)
        } else {
            Err(FallbackError::WriteFailed)
        };
    }
    let file = unsafe { File::from_raw_fd(raw) };
    if unsafe { libc::fchmod(file.as_raw_fd(), 0o600 as libc::mode_t) } != 0 {
        return Err(FallbackError::WriteFailed);
    }
    let stat = validate_file(&file)?;
    ensure_path_identity(directory, name, stat.identity)?;
    Ok(OpenSegment { file, stat })
}

fn validate_file(file: &File) -> Result<SafeFileStat, FallbackError> {
    let stat = raw_fstat(file.as_raw_fd()).map_err(|_| FallbackError::UnsafeEntry)?;
    let descriptor_flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    if descriptor_flags < 0
        || descriptor_flags & libc::FD_CLOEXEC == 0
        || file_kind(stat.st_mode) != libc::S_IFREG
        || stat.st_uid != effective_uid()
        || stat.st_nlink != 1
        || permission_bits(stat.st_mode) != 0o600
        || stat.st_size < 0
        || stat.st_size > FALLBACK_SEGMENT_BYTES as libc::off_t
    {
        return Err(FallbackError::UnsafeEntry);
    }
    Ok(SafeFileStat {
        identity: FileIdentity {
            device: stat.st_dev,
            inode: stat.st_ino,
        },
        bytes: stat.st_size as u32,
    })
}

fn acquire_lifetime_lock(file: &File) -> Result<(), FallbackError> {
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        return Ok(());
    }
    let errno = last_errno();
    if errno == libc::EWOULDBLOCK || errno == libc::EAGAIN {
        Err(FallbackError::LockContended)
    } else {
        Err(FallbackError::WriteFailed)
    }
}

fn ensure_path_identity(
    directory: &File,
    name: &str,
    expected: FileIdentity,
) -> Result<(), FallbackError> {
    let stat = raw_fstatat(directory.as_raw_fd(), name)?;
    if file_kind(stat.st_mode) != libc::S_IFREG
        || stat.st_uid != effective_uid()
        || stat.st_nlink != 1
        || permission_bits(stat.st_mode) != 0o600
        || (FileIdentity {
            device: stat.st_dev,
            inode: stat.st_ino,
        }) != expected
    {
        return Err(FallbackError::UnsafeEntry);
    }
    Ok(())
}

fn rollback_swaps(
    directory: &File,
    names: &FamilyNames,
    identities: &mut [FileIdentity; 4],
    swaps: &[(usize, usize); 3],
    completed: usize,
) {
    for &(left, right) in swaps[..completed].iter().rev() {
        if swap_verified(
            directory,
            names.segments[left],
            names.segments[right],
            identities[left],
            identities[right],
            false,
        )
        .is_err()
        {
            break;
        }
        identities.swap(left, right);
    }
}

fn swap_verified(
    directory: &File,
    left: &'static str,
    right: &'static str,
    left_identity: FileIdentity,
    right_identity: FileIdentity,
    invoke_hook: bool,
) -> Result<(), FallbackError> {
    ensure_path_identity(directory, left, left_identity)?;
    ensure_path_identity(directory, right, right_identity)?;
    if invoke_hook {
        before_rotation_mutation(left, right);
    }
    atomic_swap(directory, left, right)?;
    let left_ok = ensure_path_identity(directory, left, right_identity).is_ok();
    let right_ok = ensure_path_identity(directory, right, left_identity).is_ok();
    if left_ok && right_ok {
        return Ok(());
    }
    if left_ok || right_ok {
        let _ = atomic_swap(directory, left, right);
    }
    Err(FallbackError::UnsafeEntry)
}

fn atomic_swap(directory: &File, left: &str, right: &str) -> Result<(), FallbackError> {
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            directory.as_raw_fd(),
            c_name(left).as_ptr(),
            directory.as_raw_fd(),
            c_name(right).as_ptr(),
            libc::RENAME_SWAP,
        )
    };
    #[cfg(not(target_os = "macos"))]
    let result = {
        let _ = (directory, left, right);
        -1
    };
    if result == 0 {
        Ok(())
    } else {
        Err(FallbackError::UnsafeEntry)
    }
}

fn before_rotation_mutation(source: &'static str, destination: &'static str) {
    #[cfg(test)]
    super::tests::run_rotation_hook(source, destination);
    #[cfg(not(test))]
    let _ = (source, destination);
}

fn raw_fstat(fd: RawFd) -> io::Result<libc::stat> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { stat.assume_init() })
}

fn set_cloexec(file: &File) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GETFD) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if flags & libc::FD_CLOEXEC != 0 {
        return Ok(());
    }
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn raw_fstatat(directory: RawFd, name: &str) -> Result<libc::stat, FallbackError> {
    raw_fstatat_optional(directory, name)?.ok_or(FallbackError::UnsafeEntry)
}

fn raw_fstatat_optional(directory: RawFd, name: &str) -> Result<Option<libc::stat>, FallbackError> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    let result = unsafe {
        libc::fstatat(
            directory,
            c_name(name).as_ptr(),
            stat.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        return Ok(Some(unsafe { stat.assume_init() }));
    }
    if last_errno() == libc::ENOENT {
        Ok(None)
    } else {
        Err(FallbackError::UnsafeEntry)
    }
}

fn c_name(name: &str) -> CString {
    CString::new(name).expect("fallback names are fixed and contain no NUL")
}

fn file_kind(mode: libc::mode_t) -> libc::mode_t {
    mode & libc::S_IFMT
}

fn permission_bits(mode: libc::mode_t) -> libc::mode_t {
    mode & 0o7777
}

fn effective_uid() -> libc::uid_t {
    unsafe { libc::geteuid() }
}

fn last_errno() -> i32 {
    io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or_default()
}
