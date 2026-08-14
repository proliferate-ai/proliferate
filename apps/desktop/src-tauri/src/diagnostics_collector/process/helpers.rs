use std::io::{self, Read};
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream as StdUnixStream;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use proliferate_diagnostics_protocol::v1::types::{ConnectionDescriptorV1, TokenReferenceKindV1};
use proliferate_diagnostics_protocol::v1::validation::parse_connection_descriptor_value;
use tokio::io::{AsyncRead, AsyncReadExt, BufReader};
use tokio::task::JoinHandle;

use crate::agent_seed_env::current_target_triple;

use super::{
    CollectorLaunchError, CollectorLaunchErrorKind, MAX_DESCRIPTOR_BYTES, MAX_STDERR_RECORD_BYTES,
    PLACEHOLDER_MARKER,
};
use crate::diagnostics_collector::client::SecretCapability;
use crate::diagnostics_collector::fallback::FallbackDiagnosticsWriter;

pub(super) fn validate_label(value: &str) -> Result<(), CollectorLaunchError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() || byte == b' ')
    {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::BinaryInvalid,
            "collector launch label is invalid",
        ));
    }
    Ok(())
}

pub(super) fn supported_target(target: &str) -> bool {
    matches!(target, "aarch64-apple-darwin" | "x86_64-apple-darwin")
}

pub(super) fn resolve_binary() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(path) = std::env::var_os("PROLIFERATE_DIAGNOSTICS_COLLECTOR_BIN")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
        {
            return Some(path);
        }
    }
    let target = current_target_triple();
    let executable_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    [
        executable_dir.join(format!("proliferate-diagnostics-collector-{target}")),
        executable_dir.join("proliferate-diagnostics-collector"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("proliferate-diagnostics-collector-{target}")),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

pub(super) fn validate_binary(path: &Path) -> Result<(), CollectorLaunchError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| {
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::BinaryMissing,
            "collector binary metadata is unavailable",
        )
    })?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::BinaryInvalid,
            "collector binary is not an executable regular file",
        ));
    }
    let mut prefix = [0_u8; 512];
    let read = std::fs::File::open(path)
        .and_then(|mut file| file.read(&mut prefix))
        .map_err(|_| {
            CollectorLaunchError::new(
                CollectorLaunchErrorKind::BinaryInvalid,
                "collector binary could not be inspected",
            )
        })?;
    if prefix[..read]
        .windows(PLACEHOLDER_MARKER.len())
        .any(|window| window.eq_ignore_ascii_case(PLACEHOLDER_MARKER))
    {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::BinaryInvalid,
            "collector placeholder is not runnable",
        ));
    }
    let expected_cpu = match current_target_triple() {
        "aarch64-apple-darwin" => [0x0c, 0x00, 0x00, 0x01],
        "x86_64-apple-darwin" => [0x07, 0x00, 0x00, 0x01],
        _ => {
            return Err(CollectorLaunchError::new(
                CollectorLaunchErrorKind::UnsupportedTarget,
                "collector target is unsupported",
            ));
        }
    };
    if read < 8 || prefix[..4] != [0xcf, 0xfa, 0xed, 0xfe] || prefix[4..8] != expected_cpu {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::BinaryInvalid,
            "collector executable architecture is invalid",
        ));
    }
    Ok(())
}

pub(super) fn generate_capability() -> Result<SecretCapability, CollectorLaunchError> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| {
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::SpawnFailed,
            "operating-system randomness is unavailable",
        )
    })?;
    let encoded = URL_SAFE_NO_PAD.encode(bytes);
    bytes.fill(0);
    SecretCapability::new(encoded).map_err(|_| {
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::SpawnFailed,
            "capability construction failed",
        )
    })
}

pub(super) fn protected_pair() -> Result<(StdUnixStream, StdUnixStream), CollectorLaunchError> {
    let pair = StdUnixStream::pair().map_err(|_| {
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::SpawnFailed,
            "protected channel creation failed",
        )
    })?;
    set_cloexec(pair.0.as_raw_fd())
        .and_then(|_| set_cloexec(pair.1.as_raw_fd()))
        .map_err(|_| {
            CollectorLaunchError::new(
                CollectorLaunchErrorKind::SpawnFailed,
                "protected channel flags failed",
            )
        })?;
    Ok(pair)
}

fn set_cloexec(fd: RawFd) -> io::Result<()> {
    // SAFETY: fcntl observes and changes only the supplied owned descriptor.
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags < 0 || libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) < 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

pub(super) unsafe fn clear_cloexec_raw(fd: RawFd) -> io::Result<()> {
    // SAFETY: caller guarantees this executes in pre_exec for the intended child descriptor.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub(super) async fn read_descriptor(
    mut stdout: impl AsyncRead + Unpin,
    capability_fd: RawFd,
) -> Result<ConnectionDescriptorV1, CollectorLaunchError> {
    let mut bytes = Vec::with_capacity(512);
    let mut next = [0_u8; 1];
    while bytes.len() <= MAX_DESCRIPTOR_BYTES {
        let read = stdout.read(&mut next).await.map_err(|_| {
            CollectorLaunchError::new(
                CollectorLaunchErrorKind::EndpointUnavailable,
                "collector descriptor read failed",
            )
        })?;
        if read == 0 {
            break;
        }
        bytes.push(next[0]);
        if next[0] == b'\n' {
            break;
        }
    }
    if bytes.is_empty() || bytes.len() > MAX_DESCRIPTOR_BYTES || bytes.last() != Some(&b'\n') {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::EndpointUnavailable,
            "collector descriptor was missing or over limit",
        ));
    }
    bytes.pop();
    if bytes.last() == Some(&b'\r') {
        bytes.pop();
    }
    let value = serde_json::from_slice(&bytes).map_err(|_| {
        CollectorLaunchError::new(
            CollectorLaunchErrorKind::EndpointUnavailable,
            "collector descriptor was malformed",
        )
    })?;
    let descriptor = parse_connection_descriptor_value(&value).map_err(|reason| {
        let kind = if reason
            == proliferate_diagnostics_protocol::v1::types::RejectionReasonV1::UnsupportedMajor
        {
            CollectorLaunchErrorKind::SchemaIncompatible
        } else {
            CollectorLaunchErrorKind::EndpointUnavailable
        };
        CollectorLaunchError::new(kind, "collector descriptor was incompatible")
    })?;
    if descriptor.token_reference.kind != TokenReferenceKindV1::InheritedFileDescriptor
        || descriptor.token_reference.reference != capability_fd.to_string()
    {
        return Err(CollectorLaunchError::new(
            CollectorLaunchErrorKind::EndpointUnavailable,
            "collector descriptor referenced the wrong launch channel",
        ));
    }
    Ok(descriptor)
}

pub(super) fn drain_stderr(
    stderr: impl AsyncRead + Unpin + Send + 'static,
    fallback: FallbackDiagnosticsWriter,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buffer = vec![0_u8; 1024];
        let mut pending = Vec::with_capacity(1024);
        loop {
            let read = match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(read) => read,
                Err(_) => {
                    fallback.note_drop(1);
                    break;
                }
            };
            for byte in &buffer[..read] {
                if *byte == b'\n' || pending.len() == MAX_STDERR_RECORD_BYTES {
                    write_stderr_fallback(&fallback, &pending);
                    pending.clear();
                } else if byte.is_ascii_graphic() || *byte == b' ' || *byte == b'\t' {
                    pending.push(*byte);
                } else {
                    pending.push(b'?');
                }
            }
        }
        if !pending.is_empty() {
            write_stderr_fallback(&fallback, &pending);
        }
    })
}

fn write_stderr_fallback(fallback: &FallbackDiagnosticsWriter, bytes: &[u8]) {
    let message = String::from_utf8_lossy(bytes);
    let record = serde_json::json!({
        "source": "tauri",
        "component": "diagnostics_collector",
        "kind": "stderr",
        "message": message,
    });
    let _ = fallback.record(&record.to_string());
}
