use rfd::FileDialog;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use proliferate_diagnostics_protocol::v1::types::{IngestBatchV1, IngestReceiptV1};
use proliferate_diagnostics_protocol::v1::validation::parse_ingest_batch_value;

use crate::{
    diagnostics::{
        export_debug_bundle_to_path, save_diagnostic_json_to_path, suggested_bundle_file_name,
        ExportDebugBundleOptions, ExportDebugBundleResult, SaveDiagnosticJsonOptions,
        SaveDiagnosticJsonResult,
    },
    diagnostics_collector::supervisor::DiagnosticsCollectorSupervisor,
    sidecar::{RuntimeStatus, SharedSidecar},
};

#[tauri::command]
pub async fn ingest_renderer_diagnostics(
    window: tauri::WebviewWindow,
    supervisor: State<'_, Arc<DiagnosticsCollectorSupervisor>>,
    batch: serde_json::Value,
) -> Result<IngestReceiptV1, String> {
    require_main_window(window.label())?;
    let batch = parse_renderer_ingest_value(batch)?;
    supervisor
        .ingest_renderer(batch)
        .await
        .map_err(|error| format!("renderer_ingest_{}", error.classification()))
}

fn parse_renderer_ingest_value(value: Value) -> Result<IngestBatchV1, String> {
    let batch = parse_ingest_batch_value(&value)
        .map_err(|_| "renderer_ingest_invalid_batch".to_string())?;
    validate_renderer_ingest_shape(&value)
        .map_err(|_| "renderer_ingest_invalid_batch".to_string())?;
    Ok(batch)
}

fn validate_renderer_ingest_shape(value: &Value) -> Result<(), ()> {
    let batch = closed_object(value, &["schema_version", "records"])?;
    if let Some(schema) = batch.get("schema_version") {
        validate_schema_shape(schema)?;
    }
    if let Some(records) = batch.get("records") {
        for record in records.as_array().ok_or(())? {
            validate_renderer_record_shape(record)?;
        }
    }
    Ok(())
}

fn validate_schema_shape(value: &Value) -> Result<(), ()> {
    closed_object(value, &["major", "minor"]).map(|_| ())
}

fn validate_renderer_record_shape(value: &Value) -> Result<(), ()> {
    let record = closed_object(
        value,
        &[
            "schema_version",
            "source_timestamp",
            "producer_sequence",
            "producer_boot_id",
            "component",
            "source",
            "release",
            "environment",
            "operation_id",
            "parent_operation_id",
            "trace_id",
            "workspace_id",
            "session_id",
            "turn_id",
            "item_id",
            "request_id",
            "target_id",
            "prompt_id",
            "workflow_id",
            "name",
            "severity",
            "arguments",
            "error_classification",
            "record_class",
            "privacy",
            "redaction",
            "detailed",
            "lifecycle",
        ],
    )?;
    if let Some(schema) = record.get("schema_version") {
        validate_schema_shape(schema)?;
    }
    if let Some(arguments) = record.get("arguments") {
        for argument in arguments.as_array().ok_or(())? {
            let argument = closed_object(argument, &["name", "privacy", "value"])?;
            if let Some(value) = argument.get("value") {
                validate_argument_value_shape(value)?;
            }
        }
    }
    if let Some(detailed) = record.get("detailed").filter(|value| !value.is_null()) {
        closed_object(
            detailed,
            &["kind", "message", "stream", "dropped_count", "milestone"],
        )?;
    }
    if let Some(lifecycle) = record.get("lifecycle").filter(|value| !value.is_null()) {
        let lifecycle = closed_object(
            lifecycle,
            &["phase", "outcome", "finalizer", "model", "plugin"],
        )?;
        if let Some(model) = lifecycle.get("model").filter(|value| !value.is_null()) {
            closed_object(
                model,
                &[
                    "model_id",
                    "provider_kind",
                    "phase",
                    "input_tokens",
                    "output_tokens",
                    "duration_ms",
                ],
            )?;
        }
        if let Some(plugin) = lifecycle.get("plugin").filter(|value| !value.is_null()) {
            closed_object(plugin, &["plugin_id", "kind", "phase", "duration_ms"])?;
        }
    }
    Ok(())
}

fn validate_argument_value_shape(value: &Value) -> Result<(), ()> {
    let argument_value = closed_object(value, &["type", "value"])?;
    match argument_value.get("type").and_then(Value::as_str) {
        Some("list") => {
            for nested in argument_value
                .get("value")
                .and_then(Value::as_array)
                .ok_or(())?
            {
                validate_argument_value_shape(nested)?;
            }
        }
        Some("object") => {
            for nested in argument_value
                .get("value")
                .and_then(Value::as_object)
                .ok_or(())?
                .values()
            {
                validate_argument_value_shape(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn closed_object<'a>(value: &'a Value, allowed: &[&str]) -> Result<&'a Map<String, Value>, ()> {
    let object = value.as_object().ok_or(())?;
    if object
        .keys()
        .any(|field| !allowed.contains(&field.as_str()))
    {
        return Err(());
    }
    Ok(object)
}

fn require_main_window(label: &str) -> Result<(), String> {
    (label == "main")
        .then_some(())
        .ok_or_else(|| "renderer_ingest_wrong_window".to_string())
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
pub async fn export_debug_bundle(
    sidecar: State<'_, SharedSidecar>,
) -> Result<Option<ExportDebugBundleResult>, String> {
    let Some(output_path) = FileDialog::new()
        .add_filter("Zip archive", &["zip"])
        .set_file_name(suggested_bundle_file_name())
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
    // `app_config::home_dir_os` reads `HOME` first, verbatim and as an
    // `OsString`, and only then `USERPROFILE`. Unix resolution is unchanged
    // for every `HOME` value including non-UTF-8 ones, error string included,
    // while windows, which has no `HOME`, stops failing outright.
    let home = || crate::app_config::home_dir_os().ok_or_else(|| "HOME is not set".to_string());

    if path == "~" {
        return home();
    }

    if let Some(rest) = path.strip_prefix("~/") {
        return Ok(home()?.join(rest));
    }

    Ok(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics_collector::supervisor::SupervisorUnavailable;

    #[test]
    fn renderer_ingest_errors_carry_a_stable_string_per_unavailable_variant() {
        // The renderer loss classifier parses these strings verbatim
        // (renderer-diagnostics-native-error.ts); changing one silently
        // demotes that loss reason to `invoke_failure`.
        let cases = [
            (
                SupervisorUnavailable::Starting,
                "renderer_ingest_collector_starting",
            ),
            (
                SupervisorUnavailable::Unsupported,
                "renderer_ingest_collector_unsupported",
            ),
            (
                SupervisorUnavailable::Degraded,
                "renderer_ingest_collector_degraded",
            ),
            (
                SupervisorUnavailable::Stopped,
                "renderer_ingest_collector_stopped",
            ),
            (
                SupervisorUnavailable::Replaced,
                "renderer_ingest_collector_replaced",
            ),
            (
                SupervisorUnavailable::ShuttingDown,
                "renderer_ingest_broker_shutting_down",
            ),
            (
                SupervisorUnavailable::CollectorRejected,
                "renderer_ingest_collector_rejected",
            ),
            (
                SupervisorUnavailable::Deadline,
                "renderer_ingest_deadline_exceeded",
            ),
            (
                SupervisorUnavailable::Protocol,
                "renderer_ingest_protocol_error",
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(
                format!("renderer_ingest_{}", error.classification()),
                expected
            );
        }
    }

    #[test]
    fn renderer_ingest_is_main_window_only_with_a_stable_error() {
        assert!(require_main_window("main").is_ok());
        assert_eq!(
            require_main_window("secondary"),
            Err("renderer_ingest_wrong_window".to_string())
        );
    }

    #[test]
    fn renderer_ingest_rejects_unknown_fields_at_the_raw_value_boundary() {
        let value = serde_json::json!({
            "schema_version": {"major": 1, "minor": 1},
            "records": [{
                "schema_version": {"major": 1, "minor": 1},
                "source_timestamp": "2026-08-11T00:00:00Z",
                "producer_sequence": 1,
                "producer_boot_id": "renderer-boot",
                "component": "desktop_renderer",
                "source": "renderer",
                "release": "test",
                "environment": "test",
                "operation_id": "renderer-operation",
                "name": "desktop.renderer.detail",
                "severity": "info",
                "arguments": [],
                "record_class": "detailed",
                "privacy": "customer_content",
                "redaction": "structural",
                "detailed": {"kind": "log", "message": "safe"}
            }]
        });
        assert!(parse_renderer_ingest_value(value.clone()).is_ok());
        let mut top_level = value.clone();
        top_level.as_object_mut().expect("batch object").insert(
            "endpoint".to_string(),
            serde_json::json!("http://127.0.0.1:1"),
        );
        assert_eq!(
            parse_renderer_ingest_value(top_level),
            Err("renderer_ingest_invalid_batch".to_string())
        );

        let mut nested = value;
        nested["records"][0]["detailed"]
            .as_object_mut()
            .expect("detailed object")
            .insert("token".to_string(), serde_json::json!("secret"));
        assert_eq!(
            parse_renderer_ingest_value(nested),
            Err("renderer_ingest_invalid_batch".to_string())
        );
    }
}
