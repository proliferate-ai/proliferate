use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::app_config::app_dir_path;

pub const SUPPORT_WINDOW_LABEL: &str = "support";
pub const SUPPORT_REPORT_JOB_EVENT: &str = "support://report-job";
pub const SUPPORT_SNAPSHOT_UPDATED_EVENT: &str = "support://snapshot-updated";

#[derive(Debug, Default)]
pub struct SupportWindowState {
    latest_snapshot: Mutex<Option<Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSupportReportWindowInput {
    pub snapshot: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSupportReportAttachmentInput {
    pub client_file_id: String,
    pub file_name: String,
    pub data_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedSupportReportAttachmentInput {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportCommandResult {
    pub ok: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSupportReportAttachmentResult {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSupportReportAttachmentResult {
    pub data_base64: String,
}

#[tauri::command]
pub fn open_support_report_window(
    app: AppHandle,
    state: tauri::State<'_, SupportWindowState>,
    input: OpenSupportReportWindowInput,
) -> Result<SupportCommandResult, String> {
    {
        let mut guard = state
            .latest_snapshot
            .lock()
            .map_err(|_| "support snapshot lock poisoned".to_string())?;
        *guard = Some(input.snapshot.clone());
    }

    if let Some(window) = app.get_webview_window(SUPPORT_WINDOW_LABEL) {
        window
            .emit(SUPPORT_SNAPSHOT_UPDATED_EVENT, input.snapshot)
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(SupportCommandResult { ok: true });
    }

    let window = WebviewWindowBuilder::new(
        &app,
        SUPPORT_WINDOW_LABEL,
        WebviewUrl::App("index.html?support=1".into()),
    )
    .title("Report issue")
    .inner_size(560.0, 720.0)
    .min_inner_size(480.0, 560.0)
    .resizable(true)
    .disable_drag_drop_handler()
    .build()
    .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;

    Ok(SupportCommandResult { ok: true })
}

#[tauri::command]
pub fn get_support_report_window_snapshot(
    state: tauri::State<'_, SupportWindowState>,
) -> Result<Option<Value>, String> {
    let guard = state
        .latest_snapshot
        .lock()
        .map_err(|_| "support snapshot lock poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn submit_support_report_job(
    app: AppHandle,
    input: Value,
) -> Result<SupportCommandResult, String> {
    app.emit_to("main", SUPPORT_REPORT_JOB_EVENT, input)
        .map_err(|error| error.to_string())?;
    Ok(SupportCommandResult { ok: true })
}

#[tauri::command]
pub fn close_support_report_window(window: WebviewWindow) -> Result<SupportCommandResult, String> {
    if window.label() == SUPPORT_WINDOW_LABEL {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(SupportCommandResult { ok: true })
}

#[tauri::command]
pub fn stage_support_report_attachment(
    input: StageSupportReportAttachmentInput,
) -> Result<StageSupportReportAttachmentResult, String> {
    let bytes = STANDARD
        .decode(input.data_base64)
        .map_err(|error| format!("Failed to decode attachment: {error}"))?;
    // Canonicalize the staging root (which exists) so the containment check below
    // resolves any symlinks in the app-dir prefix before comparing.
    let root = support_attachment_dir()?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create {}: {error}", root.display()))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve support attachment directory: {error}"))?;
    // Resolve + contain the write path so a crafted client_file_id / file_name can
    // never escape the staging directory (path traversal → arbitrary overwrite).
    let path =
        resolve_staged_attachment_write_path(&canonical_root, &input.client_file_id, &input.file_name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    fs::write(&path, bytes)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    Ok(StageSupportReportAttachmentResult {
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn read_staged_support_report_attachment(
    input: StagedSupportReportAttachmentInput,
) -> Result<ReadSupportReportAttachmentResult, String> {
    let path = validate_staged_attachment_path(&input.path)?;
    let bytes =
        fs::read(&path).map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    Ok(ReadSupportReportAttachmentResult {
        data_base64: STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub fn delete_staged_support_report_attachment(
    input: StagedSupportReportAttachmentInput,
) -> Result<SupportCommandResult, String> {
    let path = validate_staged_attachment_path(&input.path)?;
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to delete {}: {error}", path.display())),
    }
    Ok(SupportCommandResult { ok: true })
}

fn support_attachment_dir() -> Result<PathBuf, String> {
    Ok(app_dir_path()?.join("support-report-attachments"))
}

/// Build the on-disk write path for a staged attachment and guarantee it stays
/// inside `canonical_root`. `canonical_root` must already be canonicalized.
///
/// This is defense-in-depth: `safe_path_segment` / `safe_file_name` already strip
/// any parent-dir component, and this containment check catches anything that
/// slips through (e.g. via a normalization quirk) before we touch the filesystem.
fn resolve_staged_attachment_write_path(
    canonical_root: &Path,
    client_file_id: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let path = canonical_root
        .join(safe_path_segment(client_file_id))
        .join(safe_file_name(file_name));
    if !is_within(canonical_root, &path) {
        return Err("Attachment path is outside support staging.".to_string());
    }
    Ok(normalize_lexically(&path))
}

/// Lexically resolve `.` and `..` components without touching the filesystem, so
/// containment can be checked even when the leaf does not exist yet.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// True when `path`, once `.`/`..` are lexically resolved, stays under `root`.
fn is_within(root: &Path, path: &Path) -> bool {
    normalize_lexically(path).starts_with(root)
}

fn validate_staged_attachment_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let root = support_attachment_dir()?
        .canonicalize()
        .map_err(|error| format!("Failed to resolve support attachment directory: {error}"))?;
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve {}: {error}", candidate.display()))?;
    if !canonical.starts_with(&root) {
        return Err("Attachment path is outside support staging.".to_string());
    }
    Ok(canonical)
}

fn safe_file_name(file_name: &str) -> String {
    Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .map(safe_path_segment)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "attachment".to_string())
}

fn safe_path_segment(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string();

    // Collapse dot-only segments (".", "..", "...") — anything with no non-dot
    // character — to a placeholder so a parent-dir component can never be
    // produced. Legitimate ids (which always contain a non-dot character) pass
    // through unchanged.
    if sanitized.is_empty() || sanitized.chars().all(|character| character == '.') {
        return "_".to_string();
    }

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contains_parent_component(value: &str) -> bool {
        Path::new(value)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    }

    #[test]
    fn safe_path_segment_collapses_dot_only_segments() {
        // The exact bytes used in the exploit must never survive as a
        // parent-dir component.
        for input in ["..", ".", "...", "   ..   ", "./", "../"] {
            let segment = safe_path_segment(input);
            assert!(
                !contains_parent_component(&segment),
                "segment {input:?} sanitized to {segment:?} which still traverses",
            );
        }
        assert_eq!(safe_path_segment(".."), "_");
        assert_eq!(safe_path_segment("."), "_");
    }

    #[test]
    fn safe_path_segment_keeps_legitimate_ids() {
        assert_eq!(safe_path_segment("legit-id_123"), "legit-id_123");
        assert_eq!(safe_path_segment("report.log"), "report.log");
        assert_eq!(safe_path_segment(".hidden"), ".hidden");
        // Slashes are neutralized to underscores, so no component boundary is
        // introduced.
        let segment = safe_path_segment("a/../../etc");
        assert!(!contains_parent_component(&segment));
        assert!(!segment.contains('/'));
    }

    #[test]
    fn is_within_rejects_lexical_escape() {
        let root = PathBuf::from("/home/user/.app/support-report-attachments");
        // Belt-and-suspenders: even a raw "../secret" (which the sanitizer would
        // never produce) is caught by the containment guard.
        assert!(!is_within(&root, &root.join("..").join("auth-session.json")));
        assert!(!is_within(&root, &root.join("..").join("..").join("etc")));
        assert!(is_within(&root, &root.join("client-1").join("file.txt")));
    }

    #[test]
    fn resolve_write_path_contains_parent_dir_client_id() {
        let root = PathBuf::from("/home/user/.app/support-report-attachments");
        // The reported exploit: clientFileId "..", fileName "auth-session.json"
        // must resolve to a path INSIDE the staging root, never app_dir/auth-session.json.
        let resolved =
            resolve_staged_attachment_write_path(&root, "..", "auth-session.json").unwrap();
        assert!(
            resolved.starts_with(&root),
            "resolved path {resolved:?} escaped staging root",
        );
        assert_ne!(resolved, PathBuf::from("/home/user/.app/auth-session.json"));
        assert!(!contains_parent_component(resolved.to_str().unwrap()));
    }

    #[test]
    fn resolve_write_path_contains_nested_traversal() {
        let root = PathBuf::from("/home/user/.app/support-report-attachments");
        for (client_file_id, file_name) in [
            ("../../etc", "passwd"),
            ("..", "env-secrets.json"),
            ("../..", "pending-auth.json"),
        ] {
            let resolved =
                resolve_staged_attachment_write_path(&root, client_file_id, file_name).unwrap();
            assert!(
                resolved.starts_with(&root),
                "clientFileId {client_file_id:?} escaped to {resolved:?}",
            );
            assert!(!contains_parent_component(resolved.to_str().unwrap()));
        }
    }
}
