use crate::editors;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::process::Stdio;

#[tauri::command]
pub fn list_available_editors() -> Result<Vec<editors::EditorInfo>, String> {
    Ok(editors::list_available_editors())
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: String) -> Result<(), String> {
    editors::open_path_in_editor(&path, &editor)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PathInspection {
    File,
    Directory,
    Missing,
    Unavailable {
        reason: PathInspectionUnavailableReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PathInspectionUnavailableReason {
    InvalidPath,
    PermissionDenied,
    UnsupportedType,
    IoError,
}

#[tauri::command]
pub fn inspect_path(path: String) -> PathInspection {
    if path.is_empty() || path.contains('\0') || !Path::new(&path).is_absolute() {
        return PathInspection::Unavailable {
            reason: PathInspectionUnavailableReason::InvalidPath,
        };
    }

    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => PathInspection::File,
        Ok(metadata) if metadata.is_dir() => PathInspection::Directory,
        Ok(_) => PathInspection::Unavailable {
            reason: PathInspectionUnavailableReason::UnsupportedType,
        },
        Err(error) => classify_path_inspection_error(error.kind()),
    }
}

fn classify_path_inspection_error(kind: std::io::ErrorKind) -> PathInspection {
    match kind {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => PathInspection::Missing,
        std::io::ErrorKind::PermissionDenied => PathInspection::Unavailable {
            reason: PathInspectionUnavailableReason::PermissionDenied,
        },
        _ => PathInspection::Unavailable {
            reason: PathInspectionUnavailableReason::IoError,
        },
    }
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("reveal_in_finder is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Terminal: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("open_in_terminal is only supported on macOS".to_string())
    }
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("open_external is only supported on macOS currently".to_string())
    }
}

#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    let result = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Select Project Folder")
            .pick_folder()
    })
    .await
    .map_err(|e| format!("Dialog failed: {e}"))?;

    Ok(result.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn copy_text(value: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return write_to_clipboard_command("pbcopy", &[], &value);
    }

    #[cfg(target_os = "windows")]
    {
        return write_to_clipboard_command("cmd", &["/C", "clip"], &value);
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        for (program, args) in [
            ("wl-copy", &[][..]),
            ("xclip", &["-selection", "clipboard"][..]),
            ("xsel", &["--clipboard", "--input"][..]),
        ] {
            if write_to_clipboard_command(program, args, &value).is_ok() {
                return Ok(());
            }
        }

        Err("No supported clipboard command found.".to_string())
    }
}

fn write_to_clipboard_command(program: &str, args: &[&str], value: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start clipboard command {program}: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("Failed to open clipboard command {program} stdin"))?;
    stdin
        .write_all(value.as_bytes())
        .map_err(|error| format!("Failed to write to clipboard command {program}: {error}"))?;
    drop(stdin);

    let status = child
        .wait()
        .map_err(|error| format!("Clipboard command {program} failed: {error}"))?;
    if !status.success() {
        return Err(format!("Clipboard command {program} exited with {status}"));
    }

    Ok(())
}

#[cfg(test)]
mod path_inspection_tests {
    use super::{
        classify_path_inspection_error, inspect_path, PathInspection,
        PathInspectionUnavailableReason,
    };
    use serde_json::json;
    use std::fs;
    use std::io::ErrorKind;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "proliferate-path-inspection-{}-{label}-{sequence}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create path-inspection test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn path_inspection_serializes_the_exact_tagged_union() {
        let values = [
            (PathInspection::File, json!({"kind": "file"})),
            (PathInspection::Directory, json!({"kind": "directory"})),
            (PathInspection::Missing, json!({"kind": "missing"})),
            (
                PathInspection::Unavailable {
                    reason: PathInspectionUnavailableReason::InvalidPath,
                },
                json!({"kind": "unavailable", "reason": "invalid_path"}),
            ),
            (
                PathInspection::Unavailable {
                    reason: PathInspectionUnavailableReason::PermissionDenied,
                },
                json!({"kind": "unavailable", "reason": "permission_denied"}),
            ),
            (
                PathInspection::Unavailable {
                    reason: PathInspectionUnavailableReason::UnsupportedType,
                },
                json!({"kind": "unavailable", "reason": "unsupported_type"}),
            ),
            (
                PathInspection::Unavailable {
                    reason: PathInspectionUnavailableReason::IoError,
                },
                json!({"kind": "unavailable", "reason": "io_error"}),
            ),
        ];

        for (value, expected) in values {
            assert_eq!(
                serde_json::to_value(value).expect("serialize inspection"),
                expected
            );
        }
    }

    #[test]
    fn path_inspection_rejects_empty_relative_and_nul_bearing_input() {
        let expected = PathInspection::Unavailable {
            reason: PathInspectionUnavailableReason::InvalidPath,
        };
        assert_eq!(inspect_path(String::new()), expected);
        assert_eq!(inspect_path("relative/file.txt".to_string()), expected);
        assert_eq!(inspect_path("/tmp/bad\0path".to_string()), expected);
    }

    #[test]
    fn path_inspection_classifies_file_directory_missing_and_not_a_directory() {
        let directory = TestDirectory::new("basic");
        let file = directory.path().join("file.txt");
        fs::write(&file, b"content").expect("write test file");

        assert_eq!(
            inspect_path(file.to_string_lossy().into_owned()),
            PathInspection::File
        );
        assert_eq!(
            inspect_path(directory.path().to_string_lossy().into_owned()),
            PathInspection::Directory
        );
        assert_eq!(
            inspect_path(
                directory
                    .path()
                    .join("missing.txt")
                    .to_string_lossy()
                    .into_owned()
            ),
            PathInspection::Missing
        );
        assert_eq!(
            inspect_path(file.join("child").to_string_lossy().into_owned()),
            PathInspection::Missing
        );
    }

    #[test]
    fn path_inspection_classifies_permission_and_unexpected_io_errors() {
        assert_eq!(
            classify_path_inspection_error(ErrorKind::PermissionDenied),
            PathInspection::Unavailable {
                reason: PathInspectionUnavailableReason::PermissionDenied,
            }
        );
        assert_eq!(
            classify_path_inspection_error(ErrorKind::TimedOut),
            PathInspection::Unavailable {
                reason: PathInspectionUnavailableReason::IoError,
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn path_inspection_follows_file_and_directory_links_and_reports_dangling_links() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("links");
        let file = directory.path().join("file.txt");
        let child_directory = directory.path().join("child");
        fs::write(&file, b"content").expect("write link target");
        fs::create_dir(&child_directory).expect("create directory link target");

        let file_link = directory.path().join("file-link");
        let directory_link = directory.path().join("directory-link");
        let dangling_link = directory.path().join("dangling-link");
        symlink(&file, &file_link).expect("create file link");
        symlink(&child_directory, &directory_link).expect("create directory link");
        symlink(directory.path().join("absent"), &dangling_link).expect("create dangling link");

        assert_eq!(
            inspect_path(file_link.to_string_lossy().into_owned()),
            PathInspection::File
        );
        assert_eq!(
            inspect_path(directory_link.to_string_lossy().into_owned()),
            PathInspection::Directory
        );
        assert_eq!(
            inspect_path(dangling_link.to_string_lossy().into_owned()),
            PathInspection::Missing
        );
    }

    #[cfg(unix)]
    #[test]
    fn path_inspection_rejects_unsupported_unix_objects() {
        use std::os::unix::net::UnixListener;

        let directory = TestDirectory::new("unsupported");
        let socket_path = directory.path().join("socket");
        let _listener = UnixListener::bind(&socket_path).expect("bind test socket");

        assert_eq!(
            inspect_path(socket_path.to_string_lossy().into_owned()),
            PathInspection::Unavailable {
                reason: PathInspectionUnavailableReason::UnsupportedType,
            }
        );
    }
}
