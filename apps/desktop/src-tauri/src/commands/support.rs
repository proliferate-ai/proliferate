use std::fs;
use std::path::{Path, PathBuf};
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
    let path = support_attachment_dir()?
        .join(safe_path_segment(&input.client_file_id))
        .join(safe_file_name(&input.file_name));
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
    value
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
        .to_string()
}
