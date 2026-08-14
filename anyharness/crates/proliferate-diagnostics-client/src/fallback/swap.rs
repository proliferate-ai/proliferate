//! Atomic exchange of two directory entries, the one primitive component
//! fallback rotation needs and the one POSIX never standardised.
//!
//! Rotation walks the segment family by exchanging adjacent names, so the
//! exchange has to be atomic: a half-applied swap would leave two names on one
//! inode, which the caller's identity checks reject as an unsafe entry and
//! which permanently retires the writer.

use std::ffi::CStr;
use std::os::fd::RawFd;

/// Exchanges `left` and `right` inside `directory`, reporting whether the
/// kernel applied the exchange.
pub(super) fn exchange(directory: RawFd, left: &CStr, right: &CStr) -> bool {
    #[cfg(target_os = "macos")]
    let result = i64::from(unsafe {
        libc::renameatx_np(
            directory,
            left.as_ptr(),
            directory,
            right.as_ptr(),
            libc::RENAME_SWAP,
        )
    });

    // Linux spells the same operation `renameat2(RENAME_EXCHANGE)`. It goes
    // through `syscall(2)` rather than the libc wrapper so the binary carries no
    // glibc 2.28 floor and builds unchanged against musl.
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            directory as libc::c_long,
            left.as_ptr(),
            directory as libc::c_long,
            right.as_ptr(),
            libc::RENAME_EXCHANGE as libc::c_long,
        )
    } as i64;

    // No other Unix exposes an atomic exchange. Rotation fails closed there
    // rather than emulating the swap with plain renames, which would expose the
    // torn state the identity checks exist to catch.
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let result = {
        let _ = (directory, left, right);
        -1_i64
    };

    result == 0
}
