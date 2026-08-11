#![cfg(all(
    target_os = "macos",
    any(target_arch = "aarch64", target_arch = "x86_64")
))]

use std::{
    io,
    os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd},
    os::unix::net::UnixStream,
};

use proliferate_diagnostics_client::bridge::wire::{
    CHILD_BRIDGE_RESERVED_FD, CHILD_SHUTDOWN_RESERVED_FD,
};
use tokio::process::{Child, Command};

const FIRST_TEMPORARY_FD: RawFd = CHILD_SHUTDOWN_RESERVED_FD + 1;

/// Descriptor authority prepared only after the direct child executable has
/// been resolved. Passing the command by value makes the protected spawn
/// one-shot: a caller that elects the frozen unprotected fallback must build a
/// fresh command without this pre-exec hook.
pub(crate) struct PreparedChildDiagnosticsLaunch {
    parent_bridge: OwnedFd,
    child_bridge: OwnedFd,
    child_shutdown: OwnedFd,
    parent_shutdown_writer: OwnedFd,
}

/// The directly spawned producer plus the two parent-owned channels that must
/// remain identity-stable for its lifetime.
pub(crate) struct ProtectedChildDiagnosticsLaunch {
    pub(crate) child: Child,
    pub(crate) bridge: UnixStream,
    pub(crate) shutdown_writer: OwnedFd,
}

impl PreparedChildDiagnosticsLaunch {
    pub(crate) fn create() -> io::Result<Self> {
        let [parent_bridge, child_bridge] = create_socket_pair()?;
        let [child_shutdown, parent_shutdown_writer] = create_shutdown_pipe()?;
        Ok(Self {
            parent_bridge,
            child_bridge,
            child_shutdown,
            parent_shutdown_writer,
        })
    }

    /// Installs the descriptor remap and performs exactly one protected spawn.
    /// On any setup or spawn error, this value and the consumed command drop
    /// every parent-side and child-side descriptor before returning.
    pub(crate) fn spawn(self, mut command: Command) -> io::Result<ProtectedChildDiagnosticsLaunch> {
        let bridge_source = self.child_bridge.as_raw_fd();
        let shutdown_source = self.child_shutdown.as_raw_fd();
        let unused_parent_bridge = self.parent_bridge.as_raw_fd();
        let unused_parent_shutdown = self.parent_shutdown_writer.as_raw_fd();

        // SAFETY: the closure performs only the checked raw dup2/fcntl/close
        // operations in `remap_child_descriptors`. It allocates, formats,
        // locks, and logs nothing after fork and before exec.
        unsafe {
            command.pre_exec(move || {
                remap_child_descriptors(
                    bridge_source,
                    shutdown_source,
                    unused_parent_bridge,
                    unused_parent_shutdown,
                )
            });
        }

        let child = command.spawn()?;
        let Self {
            parent_bridge,
            child_bridge,
            child_shutdown,
            parent_shutdown_writer,
        } = self;
        drop(child_bridge);
        drop(child_shutdown);

        // SAFETY: ownership moves exactly once from `OwnedFd` into the stream.
        let bridge = unsafe { UnixStream::from_raw_fd(parent_bridge.into_raw_fd()) };
        Ok(ProtectedChildDiagnosticsLaunch {
            child,
            bridge,
            shutdown_writer: parent_shutdown_writer,
        })
    }

    #[cfg(test)]
    pub(super) fn raw_descriptors(&self) -> PreparedDescriptorSnapshot {
        PreparedDescriptorSnapshot {
            parent_bridge: self.parent_bridge.as_raw_fd(),
            child_bridge: self.child_bridge.as_raw_fd(),
            child_shutdown: self.child_shutdown.as_raw_fd(),
            parent_shutdown_writer: self.parent_shutdown_writer.as_raw_fd(),
        }
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) struct PreparedDescriptorSnapshot {
    pub(super) parent_bridge: RawFd,
    pub(super) child_bridge: RawFd,
    pub(super) child_shutdown: RawFd,
    pub(super) parent_shutdown_writer: RawFd,
}

fn create_socket_pair() -> io::Result<[OwnedFd; 2]> {
    let mut descriptors = [-1; 2];
    // SAFETY: `descriptors` is a valid two-element output buffer.
    if unsafe {
        libc::socketpair(
            libc::AF_UNIX,
            libc::SOCK_STREAM,
            0,
            descriptors.as_mut_ptr(),
        )
    } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let first = RawDescriptor::new(descriptors[0]);
    let second = RawDescriptor::new(descriptors[1]);
    set_cloexec(first.raw())?;
    set_cloexec(second.raw())?;
    Ok([first.into_owned(), second.into_owned()])
}

fn create_shutdown_pipe() -> io::Result<[OwnedFd; 2]> {
    let mut descriptors = [-1; 2];
    // SAFETY: `descriptors` is a valid two-element output buffer.
    if unsafe { libc::pipe(descriptors.as_mut_ptr()) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let reader = RawDescriptor::new(descriptors[0]);
    let writer = RawDescriptor::new(descriptors[1]);
    set_cloexec(reader.raw())?;
    set_cloexec(writer.raw())?;
    Ok([reader.into_owned(), writer.into_owned()])
}

fn set_cloexec(descriptor: RawFd) -> io::Result<()> {
    // SAFETY: the caller retains ownership while these flags are updated.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0
        // SAFETY: `descriptor` is still owned and `flags` came from F_GETFD.
        || unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Remaps the two child endpoints after fork. Every branch closes original,
/// temporary, unused-parent, and partially installed target copies before it
/// returns. The caller must invoke this only from `pre_exec` in the intended
/// direct child.
unsafe fn remap_child_descriptors(
    bridge_source: RawFd,
    shutdown_source: RawFd,
    unused_parent_bridge: RawFd,
    unused_parent_shutdown: RawFd,
) -> io::Result<()> {
    let mut bridge_work = bridge_source;
    let mut shutdown_work = shutdown_source;

    if bridge_source < 0 || shutdown_source < 0 || bridge_source == shutdown_source {
        close_failure_descriptors([
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
            -1,
            -1,
        ]);
        return Err(io::Error::from_raw_os_error(libc::EINVAL));
    }

    if bridge_work == CHILD_SHUTDOWN_RESERVED_FD {
        bridge_work = match duplicate_cloexec(bridge_work) {
            Ok(descriptor) => descriptor,
            Err(error) => {
                close_failure_descriptors([
                    bridge_source,
                    shutdown_source,
                    unused_parent_bridge,
                    unused_parent_shutdown,
                    bridge_work,
                    shutdown_work,
                ]);
                return Err(error);
            }
        };
    }
    if shutdown_work == CHILD_BRIDGE_RESERVED_FD {
        shutdown_work = match duplicate_cloexec(shutdown_work) {
            Ok(descriptor) => descriptor,
            Err(error) => {
                close_failure_descriptors([
                    bridge_source,
                    shutdown_source,
                    unused_parent_bridge,
                    unused_parent_shutdown,
                    bridge_work,
                    shutdown_work,
                ]);
                return Err(error);
            }
        };
    }

    if bridge_work != CHILD_BRIDGE_RESERVED_FD
        // SAFETY: both integers identify descriptors owned by this child.
        && unsafe { libc::dup2(bridge_work, CHILD_BRIDGE_RESERVED_FD) } < 0
    {
        return remap_failure([
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
            bridge_work,
            shutdown_work,
        ]);
    }
    if shutdown_work != CHILD_SHUTDOWN_RESERVED_FD
        // SAFETY: cross-target sources were relocated before this mapping.
        && unsafe { libc::dup2(shutdown_work, CHILD_SHUTDOWN_RESERVED_FD) } < 0
    {
        return remap_failure([
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
            bridge_work,
            shutdown_work,
        ]);
    }
    if let Err(error) = clear_cloexec(CHILD_BRIDGE_RESERVED_FD) {
        close_failure_descriptors([
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
            bridge_work,
            shutdown_work,
        ]);
        return Err(error);
    }
    if let Err(error) = clear_cloexec(CHILD_SHUTDOWN_RESERVED_FD) {
        close_failure_descriptors([
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
            bridge_work,
            shutdown_work,
        ]);
        return Err(error);
    }

    close_success_descriptors([
        bridge_source,
        shutdown_source,
        unused_parent_bridge,
        unused_parent_shutdown,
        bridge_work,
        shutdown_work,
    ]);
    Ok(())
}

fn duplicate_cloexec(source: RawFd) -> io::Result<RawFd> {
    // SAFETY: F_DUPFD_CLOEXEC atomically creates a private temporary copy.
    let duplicate = unsafe { libc::fcntl(source, libc::F_DUPFD_CLOEXEC, FIRST_TEMPORARY_FD) };
    if duplicate < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(duplicate)
    }
}

fn clear_cloexec(descriptor: RawFd) -> io::Result<()> {
    // SAFETY: used only for the two installed reserved targets in pre_exec.
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0
        // SAFETY: `descriptor` was installed above and remains open.
        || unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } < 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn remap_failure(descriptors: [RawFd; 6]) -> io::Result<()> {
    let error = io::Error::last_os_error();
    close_failure_descriptors(descriptors);
    Err(error)
}

fn close_success_descriptors(descriptors: [RawFd; 6]) {
    close_unique(descriptors, false);
}

fn close_failure_descriptors(descriptors: [RawFd; 6]) {
    close_unique(
        [
            descriptors[0],
            descriptors[1],
            descriptors[2],
            descriptors[3],
            descriptors[4],
            descriptors[5],
            CHILD_BRIDGE_RESERVED_FD,
            CHILD_SHUTDOWN_RESERVED_FD,
        ],
        true,
    );
}

fn close_unique<const N: usize>(descriptors: [RawFd; N], close_reserved: bool) {
    for (index, descriptor) in descriptors.into_iter().enumerate() {
        if descriptor < 0
            || (!close_reserved
                && matches!(
                    descriptor,
                    CHILD_BRIDGE_RESERVED_FD | CHILD_SHUTDOWN_RESERVED_FD
                ))
            || descriptors[..index].contains(&descriptor)
        {
            continue;
        }
        // SAFETY: every listed descriptor is a child-owned original,
        // temporary, unused copy, or partially installed target.
        unsafe {
            libc::close(descriptor);
        }
    }
}

struct RawDescriptor(RawFd);

impl RawDescriptor {
    fn new(descriptor: RawFd) -> Self {
        Self(descriptor)
    }

    fn raw(&self) -> RawFd {
        self.0
    }

    fn into_owned(mut self) -> OwnedFd {
        let descriptor = self.0;
        self.0 = -1;
        // SAFETY: this guard held the sole ownership and has been disarmed.
        unsafe { OwnedFd::from_raw_fd(descriptor) }
    }
}

impl Drop for RawDescriptor {
    fn drop(&mut self) {
        if self.0 >= 0 {
            // SAFETY: the guard owns this descriptor until disarmed.
            unsafe {
                libc::close(self.0);
            }
        }
    }
}

#[cfg(test)]
pub(super) unsafe fn remap_child_descriptors_for_test(
    bridge_source: RawFd,
    shutdown_source: RawFd,
    unused_parent_bridge: RawFd,
    unused_parent_shutdown: RawFd,
) -> io::Result<()> {
    // SAFETY: test callers execute only in a fork child with owned fixtures.
    unsafe {
        remap_child_descriptors(
            bridge_source,
            shutdown_source,
            unused_parent_bridge,
            unused_parent_shutdown,
        )
    }
}

#[cfg(test)]
#[path = "launch_tests.rs"]
mod tests;
