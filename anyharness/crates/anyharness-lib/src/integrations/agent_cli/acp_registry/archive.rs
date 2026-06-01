use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::CURL_CONNECT_TIMEOUT;
use crate::integrations::agent_cli::executable::make_executable;

/// Download and extract a binary archive, returning the path to the extracted command.
pub fn install_binary_archive(
    archive_url: &str,
    cmd: &str,
    dest_dir: &Path,
) -> Result<PathBuf, String> {
    let parent = dest_dir
        .parent()
        .ok_or_else(|| format!("destination has no parent: {}", dest_dir.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let staging = parent.join(format!("_registry_staging_{}", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let archive_path = parent.join(format!("_registry_archive_{}", uuid::Uuid::new_v4()));

    if let Err(error) = download_archive_to_file(archive_url, &archive_path) {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_file(&archive_path);
        return Err(error);
    }

    if let Err(error) = extract_archive_to_staging(&archive_path, archive_url, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_file(&archive_path);
        return Err(error);
    }
    let _ = std::fs::remove_file(&archive_path);

    let normalized = cmd.trim_start_matches("./");
    let direct = staging.join(normalized);
    let found = if direct.exists() {
        direct
    } else {
        find_file_recursive(&staging, normalized).ok_or_else(|| {
            let _ = std::fs::remove_dir_all(&staging);
            format!("extracted command not found: {cmd}")
        })?
    };

    let relative_cmd = found
        .strip_prefix(&staging)
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&staging);
            e.to_string()
        })?
        .to_path_buf();

    let _ = std::fs::remove_dir_all(dest_dir);
    std::fs::rename(&staging, dest_dir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        e.to_string()
    })?;

    let final_path = dest_dir.join(relative_cmd);
    make_executable(&final_path).map_err(|e| e.to_string())?;

    Ok(final_path)
}

fn download_archive_to_file(archive_url: &str, archive_path: &Path) -> Result<(), String> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--connect-timeout",
            CURL_CONNECT_TIMEOUT,
            "--max-time",
            "120",
            "-o",
        ])
        .arg(archive_path)
        .arg(archive_url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("curl exited with {}", output.status)
    } else {
        stderr
    })
}

fn extract_archive_to_staging(
    archive_path: &Path,
    archive_url: &str,
    staging: &Path,
) -> Result<(), String> {
    if is_zip_archive(archive_path, archive_url) {
        return extract_zip_archive(archive_path, staging);
    }
    extract_tar_gz_archive(archive_path, staging)
}

fn is_zip_archive(archive_path: &Path, archive_url: &str) -> bool {
    let lower_url = archive_url
        .split('?')
        .next()
        .unwrap_or(archive_url)
        .to_ascii_lowercase();
    if lower_url.ends_with(".zip") {
        return true;
    }

    let Ok(mut file) = File::open(archive_path) else {
        return false;
    };
    let mut header = [0_u8; 4];
    file.read_exact(&mut header).is_ok()
        && matches!(header, [0x50, 0x4b, 0x03, 0x04] | [0x50, 0x4b, 0x05, 0x06])
}

fn extract_zip_archive(archive_path: &Path, staging: &Path) -> Result<(), String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let enclosed_name = entry
            .enclosed_name()
            .ok_or_else(|| format!("zip entry escapes destination: {}", entry.name()))?;
        let output_path = staging.join(enclosed_name);

        if entry.is_dir() {
            std::fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = File::create(&output_path).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn extract_tar_gz_archive(archive_path: &Path, staging: &Path) -> Result<(), String> {
    let output = Command::new("tar")
        .arg("xzf")
        .arg(archive_path)
        .arg("-C")
        .arg(staging)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("tar exited with {}", output.status)
    } else {
        stderr
    })
}

fn find_file_recursive(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::agent_cli::executable::make_executable;
    use std::io::Write;

    #[cfg(unix)]
    #[test]
    fn binary_archive_install_preserves_extracted_sibling_files() {
        let root = std::env::temp_dir().join(format!(
            "anyharness-registry-archive-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_dir = root.join("source").join("dist-package");
        std::fs::create_dir_all(&source_dir).expect("create source dir");
        let command_path = source_dir.join("cursor-agent");
        std::fs::write(
            &command_path,
            "#!/bin/sh\nexec \"$(dirname \"$0\")/node\" \"$@\"\n",
        )
        .expect("write command");
        make_executable(&command_path).expect("make command executable");
        std::fs::write(source_dir.join("node"), "#!/bin/sh\nexit 0\n").expect("write sibling");

        let archive_path = root.join("cursor.tar.gz");
        let output = Command::new("tar")
            .arg("czf")
            .arg(&archive_path)
            .arg("-C")
            .arg(root.join("source"))
            .arg("dist-package")
            .output()
            .expect("create tar archive");
        assert!(output.status.success());

        let dest_dir = root.join("registry_binary");
        let installed = install_binary_archive(
            &format!("file://{}", archive_path.display()),
            "./dist-package/cursor-agent",
            &dest_dir,
        )
        .expect("install archive");

        assert_eq!(
            installed,
            dest_dir.join("dist-package").join("cursor-agent")
        );
        assert!(dest_dir.join("dist-package").join("node").is_file());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn binary_archive_install_extracts_zip_archives() {
        let root = std::env::temp_dir().join(format!(
            "anyharness-registry-zip-archive-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create root dir");
        let archive_path = root.join("cursor.zip");
        let archive_file = File::create(&archive_path).expect("create zip archive");
        let mut archive = zip::ZipWriter::new(archive_file);
        let options = zip::write::SimpleFileOptions::default();
        archive
            .add_directory("dist-package/", options)
            .expect("add package dir");
        archive
            .start_file("dist-package/cursor-agent.exe", options)
            .expect("start command file");
        archive
            .write_all(b"@echo off\r\n")
            .expect("write command file");
        archive
            .start_file("dist-package/node.exe", options)
            .expect("start sibling file");
        archive.write_all(b"node").expect("write sibling file");
        archive.finish().expect("finish zip archive");

        let dest_dir = root.join("registry_binary");
        let installed = install_binary_archive(
            &format!("file://{}", archive_path.display()),
            "./dist-package/cursor-agent.exe",
            &dest_dir,
        )
        .expect("install archive");

        assert_eq!(
            installed,
            dest_dir.join("dist-package").join("cursor-agent.exe")
        );
        assert!(dest_dir.join("dist-package").join("node.exe").is_file());

        let _ = std::fs::remove_dir_all(root);
    }
}
