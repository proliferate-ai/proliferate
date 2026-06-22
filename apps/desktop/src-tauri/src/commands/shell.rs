use crate::{editors, platform};
use std::io::Write;
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

#[tauri::command]
pub fn path_is_directory(path: String) -> bool {
    std::fs::metadata(&path)
        .map(|m| m.is_dir())
        .unwrap_or(false)
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    platform::reveal_path(path)
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    platform::open_terminal_at(path)
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    platform::open_url(&url)
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
