//! Canonical direct-native executable validation shared by protected children.

use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

const EXECUTABLE_HEADER_PROBE_BYTES: usize = 4096;
pub(crate) const MACHO_MAGIC_64_LE: [u8; 4] = [0xcf, 0xfa, 0xed, 0xfe];
pub(crate) const MACHO_FAT_MAGIC_BE: [u8; 4] = [0xca, 0xfe, 0xba, 0xbe];
pub(crate) const MACHO_FAT_MAGIC_64_BE: [u8; 4] = [0xca, 0xfe, 0xba, 0xbf];
const MACHO_FAT_MAX_ARCHES: u32 = 16;
pub(crate) const MACHO_CPU_TYPE_X86_64: u32 = 0x0100_0007;
pub(crate) const MACHO_CPU_TYPE_ARM64: u32 = 0x0100_000c;
pub(crate) const ELF_MACHINE_X86_64: u16 = 62;
pub(crate) const ELF_MACHINE_AARCH64: u16 = 183;
pub(crate) const PE_MACHINE_X86_64: u16 = 0x8664;
pub(crate) const PE_MACHINE_ARM64: u16 = 0xaa64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeImageRejection {
    Unavailable,
    NotRegularFile,
    NotExecutable,
    ImageFormatUnsupported,
}

/// Resolves and validates the exact direct image the current target can load.
/// The fixed header probe rejects scripts, wrappers, Java class files, and
/// thin/fat images that do not contain this compile target's architecture.
pub(crate) fn canonical_current_target_executable(
    candidate: &Path,
) -> Result<PathBuf, NativeImageRejection> {
    let executable = candidate
        .canonicalize()
        .map_err(|_| NativeImageRejection::Unavailable)?;
    let metadata = executable
        .metadata()
        .map_err(|_| NativeImageRejection::Unavailable)?;
    if !metadata.file_type().is_file() {
        return Err(NativeImageRejection::NotRegularFile);
    }
    if !has_execute_permission(&metadata) {
        return Err(NativeImageRejection::NotExecutable);
    }
    if !has_native_executable_image(&executable) {
        return Err(NativeImageRejection::ImageFormatUnsupported);
    }
    Ok(executable)
}

fn has_native_executable_image(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut header = Vec::with_capacity(EXECUTABLE_HEADER_PROBE_BYTES);
    let mut probe = file.take(EXECUTABLE_HEADER_PROBE_BYTES as u64);
    probe.read_to_end(&mut header).is_ok() && is_current_target_executable_image(&header)
}

pub(crate) fn is_current_target_executable_image(header: &[u8]) -> bool {
    let Some((macho_cpu_type, elf_machine, pe_machine)) = (if cfg!(target_arch = "aarch64") {
        Some((MACHO_CPU_TYPE_ARM64, ELF_MACHINE_AARCH64, PE_MACHINE_ARM64))
    } else if cfg!(target_arch = "x86_64") {
        Some((MACHO_CPU_TYPE_X86_64, ELF_MACHINE_X86_64, PE_MACHINE_X86_64))
    } else {
        None
    }) else {
        return false;
    };
    if cfg!(target_os = "macos") {
        is_macho_image(header, macho_cpu_type)
    } else if cfg!(target_os = "linux") {
        is_elf_image(header, elf_machine)
    } else if cfg!(target_os = "windows") {
        is_pe_image(header, pe_machine)
    } else {
        false
    }
}

pub(crate) fn is_macho_image(header: &[u8], cpu_type: u32) -> bool {
    is_thin_macho_image(header, cpu_type) || is_fat_macho_image(header, cpu_type)
}

fn is_thin_macho_image(header: &[u8], cpu_type: u32) -> bool {
    header.get(..4) == Some(MACHO_MAGIC_64_LE.as_slice())
        && read_u32(header, 4, false) == Some(cpu_type)
}

fn is_fat_macho_image(header: &[u8], cpu_type: u32) -> bool {
    let arch_entry_bytes = if header.get(..4) == Some(MACHO_FAT_MAGIC_BE.as_slice()) {
        20
    } else if header.get(..4) == Some(MACHO_FAT_MAGIC_64_BE.as_slice()) {
        32
    } else {
        return false;
    };
    let Some(arch_count) = read_u32(header, 4, true) else {
        return false;
    };
    if arch_count == 0 || arch_count > MACHO_FAT_MAX_ARCHES {
        return false;
    }
    let arch_count = arch_count as usize;
    if header.len() < 8 + arch_count * arch_entry_bytes {
        return false;
    }
    (0..arch_count)
        .any(|index| read_u32(header, 8 + index * arch_entry_bytes, true) == Some(cpu_type))
}

pub(crate) fn is_elf_image(header: &[u8], machine: u16) -> bool {
    if header.get(..4) != Some([0x7f, b'E', b'L', b'F'].as_slice()) {
        return false;
    }
    if header.get(4) != Some(&2) || header.get(6) != Some(&1) {
        return false;
    }
    let big_endian = match header.get(5) {
        Some(1) => false,
        Some(2) => true,
        _ => return false,
    };
    read_u16(header, 18, big_endian) == Some(machine)
}

pub(crate) fn is_pe_image(header: &[u8], machine: u16) -> bool {
    if header.get(..2) != Some(b"MZ".as_slice()) {
        return false;
    }
    let Some(pe_offset) = read_u32(header, 0x3c, false) else {
        return false;
    };
    let pe_offset = pe_offset as usize;
    let Some(machine_offset) = pe_offset.checked_add(4) else {
        return false;
    };
    header.get(pe_offset..machine_offset) == Some(b"PE\0\0".as_slice())
        && read_u16(header, machine_offset, false) == Some(machine)
}

fn read_u32(bytes: &[u8], offset: usize, big_endian: bool) -> Option<u32> {
    let bytes: [u8; 4] = bytes.get(offset..offset.checked_add(4)?)?.try_into().ok()?;
    Some(if big_endian {
        u32::from_be_bytes(bytes)
    } else {
        u32::from_le_bytes(bytes)
    })
}

fn read_u16(bytes: &[u8], offset: usize, big_endian: bool) -> Option<u16> {
    let bytes: [u8; 2] = bytes.get(offset..offset.checked_add(2)?)?.try_into().ok()?;
    Some(if big_endian {
        u16::from_be_bytes(bytes)
    } else {
        u16::from_le_bytes(bytes)
    })
}

#[cfg(unix)]
fn has_execute_permission(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_execute_permission(_metadata: &std::fs::Metadata) -> bool {
    true
}
