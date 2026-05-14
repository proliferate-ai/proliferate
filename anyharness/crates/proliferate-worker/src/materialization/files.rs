use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::error::WorkerError;

pub fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(path)
}

pub fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, WorkerError> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err(materialization_error(format!(
            "materialized path must be relative: {relative_path}"
        )));
    }
    for component in relative.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(materialization_error(format!(
                "materialized path escapes workspace: {relative_path}"
            )));
        }
    }
    let destination = root.join(relative);
    ensure_no_symlink_path(&destination)?;
    Ok(destination)
}

pub fn write_file(path: &Path, contents: &[u8], private: bool) -> Result<(), WorkerError> {
    ensure_no_symlink_path(path)?;
    if let Some(parent) = path.parent() {
        ensure_no_symlink_path(parent)?;
        fs::create_dir_all(parent).map_err(|source| WorkerError::CreateParent {
            path: parent.to_path_buf(),
            source,
        })?;
        ensure_no_symlink_path(parent)?;
        if private {
            set_private_dir_permissions(parent)?;
        }
    }
    let tmp_path = path.with_file_name(format!(
        ".{}.tmp.{}",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("materialized"),
        std::process::id()
    ));
    fs::write(&tmp_path, contents).map_err(|source| WorkerError::WriteConfig {
        path: tmp_path.clone(),
        source,
    })?;
    if private {
        set_private_file_permissions(&tmp_path)?;
    }
    fs::rename(&tmp_path, path).map_err(|source| WorkerError::WriteConfig {
        path: path.to_path_buf(),
        source,
    })
}

pub fn ensure_no_symlink_path(path: &Path) -> Result<(), WorkerError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(materialization_error(format!(
                    "materialized path contains symlink: {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(source) => {
                return Err(materialization_error(format!(
                    "failed to inspect materialized path {}: {source}",
                    current.display()
                )));
            }
        }
    }
    Ok(())
}

pub fn materialization_error(message: impl Into<String>) -> WorkerError {
    WorkerError::Materialization(message.into())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions).map_err(|source| WorkerError::SetPrivatePermissions {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), WorkerError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o700);
    fs::set_permissions(path, permissions).map_err(|source| WorkerError::SetPrivatePermissions {
        path: path.to_path_buf(),
        source,
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), WorkerError> {
    Ok(())
}

pub fn decode_base64(input: &str) -> Result<Vec<u8>, WorkerError> {
    base64_decode(input).ok_or_else(|| materialization_error("invalid base64 credential file"))
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = TABLE.iter().position(|candidate| *candidate == byte)? as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(output)
}
