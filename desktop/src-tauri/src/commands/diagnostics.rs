use rfd::FileDialog;
use serde::Deserialize;
use tauri::State;

use crate::{
    diagnostics::{
        export_debug_bundle_to_path,
        save_diagnostic_json_to_path,
        scrub_diagnostic_text,
        suggested_bundle_file_name,
        ExportDebugBundleOptions,
        ExportDebugBundleResult,
        SaveDiagnosticJsonOptions,
        SaveDiagnosticJsonResult,
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
