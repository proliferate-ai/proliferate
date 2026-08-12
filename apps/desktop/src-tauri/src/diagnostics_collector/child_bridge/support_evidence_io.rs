use std::{
    ffi::CString,
    io,
    mem::zeroed,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
};

use proliferate_diagnostics_client::{parse_fallback_record_line, DiagnosticsComponent};
use proliferate_diagnostics_protocol::v1::{
    types::{ComponentV1, SourceV1},
    validation::parse_producer_record_value,
};

use super::{EvidenceParser, EvidenceValue};

const OPEN_FILE_FLAGS: libc::c_int = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;

pub(super) fn parse_line(parser: EvidenceParser, line: &[u8]) -> Option<(EvidenceValue, u64)> {
    match parser {
        EvidenceParser::DesktopMixed => {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(line) {
                if let Ok(record) = parse_producer_record_value(&value) {
                    if matches!(
                        (record.component, record.source),
                        (ComponentV1::DesktopRenderer, SourceV1::Renderer)
                            | (ComponentV1::DesktopTauri, SourceV1::Tauri)
                    ) {
                        return Some((EvidenceValue::DesktopRecord(record), 0));
                    }
                }
            }
            let (value, invalid) = lossy_line(line);
            Some((
                EvidenceValue::DesktopOpaque {
                    value,
                    invalid_utf8_bytes: invalid,
                },
                invalid,
            ))
        }
        EvidenceParser::AnyharnessWrapped => {
            parse_fallback_record_line(DiagnosticsComponent::AnyHarness, line)
                .map(|record| (EvidenceValue::Wrapped(record), 0))
        }
        EvidenceParser::DesktopWorkerWrapped => {
            parse_fallback_record_line(DiagnosticsComponent::DesktopWorker, line)
                .map(|record| (EvidenceValue::Wrapped(record), 0))
        }
        EvidenceParser::Legacy => {
            let (value, invalid) = lossy_line(line);
            Some((
                EvidenceValue::Legacy {
                    value,
                    invalid_utf8_bytes: invalid,
                },
                invalid,
            ))
        }
    }
}

fn lossy_line(line: &[u8]) -> (String, u64) {
    let invalid = match std::str::from_utf8(line) {
        Ok(value) => return (value.to_owned(), 0),
        Err(_) => count_invalid_utf8_bytes(line),
    };
    (String::from_utf8_lossy(line).into_owned(), invalid)
}

fn count_invalid_utf8_bytes(mut bytes: &[u8]) -> u64 {
    let mut invalid = 0_u64;
    while let Err(error) = std::str::from_utf8(bytes) {
        let offset = error.valid_up_to();
        let error_bytes = error.error_len().unwrap_or(bytes.len() - offset);
        invalid += error_bytes as u64;
        bytes = &bytes[offset + error_bytes..];
    }
    invalid
}

pub(super) struct TailRead {
    pub(super) read_bytes: u64,
    pub(super) incomplete_leading_bytes: u64,
    pub(super) incomplete_final_bytes: u64,
    pub(super) lines: Vec<(u64, Vec<u8>)>,
}

pub(super) fn read_snapshotted_tail(
    descriptor: &OwnedFd,
    snapshot_length: u64,
    read_limit: u64,
) -> io::Result<TailRead> {
    if snapshot_length == 0 || read_limit == 0 {
        return Ok(TailRead {
            read_bytes: 0,
            incomplete_leading_bytes: 0,
            incomplete_final_bytes: 0,
            lines: Vec::new(),
        });
    }
    let start = snapshot_length.saturating_sub(read_limit);
    let length = usize::try_from(snapshot_length - start).unwrap_or(usize::MAX);
    let mut bytes = vec![0_u8; length];
    let mut offset = 0;
    while offset < bytes.len() {
        // SAFETY: descriptor stays on the snapshotted inode and every offset
        // remains inside the captured length.
        let read = unsafe {
            libc::pread(
                descriptor.as_raw_fd(),
                bytes[offset..].as_mut_ptr().cast(),
                bytes.len() - offset,
                i64::try_from(start).unwrap_or(i64::MAX) + offset as i64,
            )
        };
        if read < 0 {
            return Err(io::Error::last_os_error());
        }
        if read == 0 {
            break;
        }
        offset += read as usize;
    }
    if offset != bytes.len() {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "evidence file shrank after its length snapshot",
        ));
    }
    bytes.truncate(offset);
    let read_bytes = bytes.len() as u64;
    let starts_on_boundary = start == 0 || preceding_byte_is_newline(descriptor, start)?;
    let leading = drop_incomplete_leading(starts_on_boundary, &mut bytes);
    let incomplete_final = drop_incomplete_final(&mut bytes);
    let lines = bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .enumerate()
        .map(|(index, line)| (index as u64 + 1, line.to_vec()))
        .collect();
    Ok(TailRead {
        read_bytes,
        incomplete_leading_bytes: leading,
        incomplete_final_bytes: incomplete_final,
        lines,
    })
}

fn preceding_byte_is_newline(descriptor: &OwnedFd, start: u64) -> io::Result<bool> {
    let mut byte = [0_u8; 1];
    // SAFETY: descriptor is open, the one-byte buffer is writable, and start
    // is nonzero so start - 1 stays within the snapshotted file.
    let read = unsafe {
        libc::pread(
            descriptor.as_raw_fd(),
            byte.as_mut_ptr().cast(),
            1,
            i64::try_from(start - 1).unwrap_or(i64::MAX),
        )
    };
    if read < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(read == 1 && byte[0] == b'\n')
    }
}

fn drop_incomplete_leading(starts_on_boundary: bool, bytes: &mut Vec<u8>) -> u64 {
    if starts_on_boundary {
        return 0;
    }
    match bytes.iter().position(|byte| *byte == b'\n') {
        Some(index) => {
            bytes.drain(..=index);
            (index + 1) as u64
        }
        None => {
            let omitted = bytes.len() as u64;
            bytes.clear();
            omitted
        }
    }
}

fn drop_incomplete_final(bytes: &mut Vec<u8>) -> u64 {
    if bytes.ends_with(b"\n") {
        return 0;
    }
    match bytes.iter().rposition(|byte| *byte == b'\n') {
        Some(index) => {
            let omitted = (bytes.len() - index - 1) as u64;
            bytes.truncate(index + 1);
            omitted
        }
        None => {
            let omitted = bytes.len() as u64;
            bytes.clear();
            omitted
        }
    }
}

pub(super) enum OpenFileError {
    Missing,
    Unreadable,
    Unsafe,
}

pub(super) fn open_evidence_file(
    parent: &OwnedFd,
    leaf: &str,
    exact_mode: Option<u32>,
) -> Result<(OwnedFd, u64), OpenFileError> {
    if leaf.is_empty() || leaf == "." || leaf == ".." || leaf.contains('/') {
        return Err(OpenFileError::Unsafe);
    }
    let leaf = CString::new(leaf).map_err(|_| OpenFileError::Unsafe)?;
    // SAFETY: parent is an owned directory and leaf is one component.
    let raw = unsafe { libc::openat(parent.as_raw_fd(), leaf.as_ptr(), OPEN_FILE_FLAGS) };
    if raw < 0 {
        let error = io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(libc::ENOENT) => Err(OpenFileError::Missing),
            Some(libc::ELOOP) | Some(libc::ENOTDIR) => Err(OpenFileError::Unsafe),
            _ => Err(OpenFileError::Unreadable),
        };
    }
    // SAFETY: raw was returned by openat and has no other owner.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    // SAFETY: zeroed stat is a valid fstat output buffer.
    let mut stat: libc::stat = unsafe { zeroed() };
    // SAFETY: descriptor is open and owned.
    if unsafe { libc::fstat(descriptor.as_raw_fd(), &mut stat) } != 0 {
        return Err(OpenFileError::Unreadable);
    }
    // SAFETY: geteuid has no preconditions.
    let euid = unsafe { libc::geteuid() };
    let mode = u32::from(stat.st_mode) & 0o777;
    let safe_mode = exact_mode.map_or(mode & 0o022 == 0, |required| mode == required);
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG
        || stat.st_uid != euid
        || stat.st_nlink != 1
        || !safe_mode
        || stat.st_size < 0
    {
        return Err(OpenFileError::Unsafe);
    }
    Ok((descriptor, stat.st_size as u64))
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File, OpenOptions},
        io::Write,
        os::fd::OwnedFd,
    };

    use super::*;

    fn fixture(bytes: &[u8]) -> (std::path::PathBuf, OwnedFd) {
        let path =
            std::env::temp_dir().join(format!("proliferate-support-tail-{}", uuid::Uuid::new_v4()));
        fs::write(&path, bytes).expect("tail fixture");
        let descriptor: OwnedFd = File::open(&path).expect("open fixture").into();
        (path, descriptor)
    }

    #[test]
    fn tail_discards_partial_leading_and_final_fragments() {
        let bytes = b"prefix\nwhole\npartial";
        let (path, descriptor) = fixture(bytes);
        let tail = read_snapshotted_tail(&descriptor, bytes.len() as u64, bytes.len() as u64 - 2)
            .expect("read tail");
        assert_eq!(tail.incomplete_leading_bytes, 5);
        assert_eq!(tail.incomplete_final_bytes, b"partial".len() as u64);
        assert_eq!(tail.lines, vec![(1, b"whole".to_vec())]);
        fs::remove_file(path).ok();
    }

    #[test]
    fn tail_never_reads_growth_past_the_snapshotted_length() {
        let (path, descriptor) = fixture(b"old\n");
        OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("open append")
            .write_all(b"new\n")
            .expect("append growth");
        let tail = read_snapshotted_tail(&descriptor, 4, 4).expect("read snapshot");
        assert_eq!(tail.lines, vec![(1, b"old".to_vec())]);
        fs::remove_file(path).ok();
    }

    #[test]
    fn tail_rejects_truncation_after_the_length_snapshot() {
        let (path, descriptor) = fixture(b"line\n");
        OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open truncate")
            .set_len(0)
            .expect("truncate fixture");
        assert_eq!(
            read_snapshotted_tail(&descriptor, 5, 5)
                .expect_err("short snapshot read")
                .kind(),
            io::ErrorKind::UnexpectedEof
        );
        fs::remove_file(path).ok();
    }
}
