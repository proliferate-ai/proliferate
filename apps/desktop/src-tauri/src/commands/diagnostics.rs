use rfd::FileDialog;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

use crate::{
    diagnostics::{
        collect_support_diagnostics_bundle, export_debug_bundle_to_path,
        save_diagnostic_json_to_path, scrub_diagnostic_text, suggested_bundle_file_name,
        ExportDebugBundleOptions, ExportDebugBundleResult, SaveDiagnosticJsonOptions,
        SaveDiagnosticJsonResult, SupportDiagnosticsBundle,
    },
    sidecar::{RuntimeStatus, SharedSidecar},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererDiagnosticInput {
    pub source: String,
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub route: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererEventInput {
    pub source: String,
    pub message: String,
    pub route: Option<String>,
    pub elapsed_ms: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDiagnosticJsonToPathInput {
    pub output_path: String,
    pub contents: String,
}

fn runtime_status_label(status: &RuntimeStatus) -> &'static str {
    match status {
        RuntimeStatus::Starting => "starting",
        RuntimeStatus::Healthy => "healthy",
        RuntimeStatus::Failed => "failed",
        RuntimeStatus::Stopped => "stopped",
    }
}

#[tauri::command]
pub fn log_renderer_diagnostic(input: RendererDiagnosticInput) -> Result<(), String> {
    tracing::error!(
        source = %input.source,
        route = %input.route.unwrap_or_default(),
        message = %scrub_diagnostic_text(&input.message),
        stack = %scrub_diagnostic_text(input.stack.as_deref().unwrap_or_default()),
        component_stack = %scrub_diagnostic_text(input.component_stack.as_deref().unwrap_or_default()),
        "Renderer diagnostic"
    );
    Ok(())
}

#[tauri::command]
pub fn log_renderer_event(input: RendererEventInput) -> Result<(), String> {
    tracing::info!(
        source = %input.source,
        route = %input.route.unwrap_or_default(),
        elapsed_ms = input.elapsed_ms.unwrap_or_default(),
        message = %scrub_diagnostic_text(&input.message),
        "Renderer event"
    );
    Ok(())
}

#[tauri::command]
pub async fn export_debug_bundle(
    sidecar: State<'_, SharedSidecar>,
) -> Result<Option<ExportDebugBundleResult>, String> {
    let Some(output_path) = FileDialog::new()
        .add_filter("Zip archive", &["zip"])
        .set_file_name(&suggested_bundle_file_name())
        .save_file()
    else {
        return Ok(None);
    };

    let (runtime_url_override, runtime_status_override) = {
        let guard = sidecar.lock().await;
        (
            Some(guard.info.url.clone()),
            Some(runtime_status_label(&guard.info.status).to_string()),
        )
    };

    export_debug_bundle_to_path(ExportDebugBundleOptions {
        output_path,
        runtime_url_override,
        runtime_status_override,
    })
    .await
    .map(Some)
}

#[tauri::command]
pub async fn collect_support_diagnostics(
    sidecar: State<'_, SharedSidecar>,
) -> Result<SupportDiagnosticsBundle, String> {
    let (runtime_url_override, runtime_status_override) = {
        let guard = sidecar.lock().await;
        (
            Some(guard.info.url.clone()),
            Some(runtime_status_label(&guard.info.status).to_string()),
        )
    };

    collect_support_diagnostics_bundle(runtime_url_override, runtime_status_override).await
}

#[tauri::command]
pub async fn save_diagnostic_json(
    suggested_file_name: String,
    contents: String,
) -> Result<Option<SaveDiagnosticJsonResult>, String> {
    let Some(output_path) = FileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name(&suggested_file_name)
        .save_file()
    else {
        return Ok(None);
    };

    save_diagnostic_json_to_path(SaveDiagnosticJsonOptions {
        output_path,
        contents,
    })
    .map(Some)
}

#[tauri::command]
pub fn save_diagnostic_json_to_absolute_path(
    input: SaveDiagnosticJsonToPathInput,
) -> Result<SaveDiagnosticJsonResult, String> {
    if !cfg!(debug_assertions) {
        return Err("save_diagnostic_json_to_absolute_path is dev-only".to_string());
    }

    let output_path = expand_home_path(&input.output_path)?;
    if !output_path.is_absolute() {
        return Err("output_path must be absolute".to_string());
    }

    save_diagnostic_json_to_path(SaveDiagnosticJsonOptions {
        output_path,
        contents: input.contents,
    })
}

fn expand_home_path(path: &str) -> Result<PathBuf, String> {
    if path == "~" {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set".to_string());
    }

    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set".to_string())?;
        return Ok(home.join(rest));
    }

    Ok(PathBuf::from(path))
}
