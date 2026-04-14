use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::app_config::{
    default_anyharness_runtime_home_path,
    load_runtime_info_record,
    logs_dir_path,
};

use super::scrub::scrub_diagnostic_text;

const MAX_ROTATED_LOG_FILES: usize = 5;

#[derive(Debug, Clone, Default)]
pub struct ExportDebugBundleOptions {
    pub output_path: PathBuf,
    pub runtime_url_override: Option<String>,
    pub runtime_status_override: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDebugBundleResult {
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugBundleManifest {
    schema_version: u32,
    app_version: String,
    runtime_version: Option<String>,
    runtime_status: Option<String>,
    runtime_home: Option<String>,
    platform: String,
    timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    runtime_home: String,
    status: String,
    version: String,
}

pub fn suggested_bundle_file_name() -> String {
    format!(
        "proliferate-debug-{}.zip",
        Utc::now().format("%Y%m%d-%H%M%S")
    )
}

pub async fn export_debug_bundle_to_path(
    options: ExportDebugBundleOptions,
) -> Result<ExportDebugBundleResult, String> {
    if let Some(parent) = options.output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    let runtime_info = load_runtime_info_record().ok().flatten();
    let runtime_url = options
        .runtime_url_override
        .clone()
        .or_else(|| runtime_info.as_ref().map(|info| info.url.clone()))
        .filter(|value| !value.trim().is_empty());
    let runtime_status = options
        .runtime_status_override
        .clone()
        .or_else(|| runtime_info.as_ref().map(|info| info.status.clone()))
        .filter(|value| !value.trim().is_empty());
    let health = match runtime_status.as_deref() {
        Some("healthy") => fetch_runtime_health(runtime_url.as_deref()).await,
        _ => None,
    };

    let default_runtime_home = default_anyharness_runtime_home_path()?;
    let anyharness_runtime_home = health
        .as_ref()
        .map(|value| PathBuf::from(&value.runtime_home))
        .or_else(|| {
            runtime_info
                .as_ref()
                .and_then(|value| value.runtime_home.clone().map(PathBuf::from))
        })
        .or_else(|| {
            (runtime_status.as_deref() != Some("healthy")).then_some(default_runtime_home.clone())
        });
    let anyharness_base_log = anyharness_runtime_home
        .as_ref()
        .map(|runtime_home| runtime_home.join("logs/anyharness.log"));
    let anyharness_logs_exist = anyharness_base_log.as_ref().is_some_and(|path| path.is_file());
    let runtime_home_for_manifest = health
        .as_ref()
        .map(|value| value.runtime_home.clone())
        .or_else(|| runtime_info.as_ref().and_then(|value| value.runtime_home.clone()))
        .or_else(|| {
            anyharness_logs_exist.then(|| {
                anyharness_runtime_home
                    .as_ref()
                    .expect("runtime home should exist when logs are present")
                    .to_string_lossy()
                    .into_owned()
            })
        });

    let output_file = fs::File::create(&options.output_path)
        .map_err(|error| format!("Failed to create {}: {error}", options.output_path.display()))?;
    let mut zip = ZipWriter::new(output_file);
    let file_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for path in collect_log_files(&logs_dir_path()?.join("desktop-native.log")) {
        let file_name = path
            .file_name()
            .expect("desktop log file should have a name")
            .to_string_lossy();
        add_scrubbed_text_file(
            &mut zip,
            &format!("logs/desktop/{file_name}"),
            &path,
            file_options,
        )?;
    }

    if let Some(anyharness_base_log) = anyharness_base_log.as_ref() {
        for path in collect_log_files(anyharness_base_log) {
            let file_name = path
                .file_name()
                .expect("runtime log file should have a name")
                .to_string_lossy();
            add_scrubbed_text_file(
                &mut zip,
                &format!("logs/anyharness/{file_name}"),
                &path,
                file_options,
            )?;
        }
    }

    if let Some(health) = health.as_ref() {
        let health_json = serde_json::to_string_pretty(health)
            .map_err(|error| format!("Failed to serialize health payload: {error}"))?;
        add_text_entry(&mut zip, "health.json", &health_json, file_options)?;
    }

    let manifest = DebugBundleManifest {
        schema_version: 1,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        runtime_version: health
            .as_ref()
            .map(|value| value.version.clone())
            .or_else(|| runtime_info.as_ref().and_then(|value| value.version.clone())),
        runtime_status,
        runtime_home: runtime_home_for_manifest,
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        timestamp: Utc::now().to_rfc3339(),
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Failed to serialize manifest: {error}"))?;
    add_text_entry(&mut zip, "manifest.json", &manifest_json, file_options)?;

    zip.finish()
        .map_err(|error| format!("Failed to finalize zip archive: {error}"))?;

    Ok(ExportDebugBundleResult {
        output_path: options.output_path.to_string_lossy().into_owned(),
    })
}

fn collect_log_files(base_path: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    if base_path.is_file() {
        files.push(base_path.to_path_buf());
    }

    for index in 1..=MAX_ROTATED_LOG_FILES {
        let rotated = base_path.with_extension(format!(
            "{}.{}",
            base_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
            index
        ));
        if rotated.is_file() {
            files.push(rotated);
        }
    }

    files
}

async fn fetch_runtime_health(runtime_url: Option<&str>) -> Option<HealthResponse> {
    let runtime_url = runtime_url?.trim().trim_end_matches('/').to_string();
    if runtime_url.is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;
    let response = client
        .get(format!("{runtime_url}/health"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }

    response.json::<HealthResponse>().await.ok()
}

fn add_scrubbed_text_file<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    entry_name: &str,
    path: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    add_text_entry(zip, entry_name, &contents, options)
}

fn add_text_entry<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    entry_name: &str,
    contents: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(entry_name, options)
        .map_err(|error| format!("Failed to start zip entry {entry_name}: {error}"))?;
    let scrubbed = scrub_diagnostic_text(contents);
    zip.write_all(scrubbed.as_bytes())
        .map_err(|error| format!("Failed to write zip entry {entry_name}: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{collect_log_files, scrub_diagnostic_text, suggested_bundle_file_name};

    fn temp_path(file_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("debug-bundle-tests-{unique}"))
            .join(file_name)
    }

    #[test]
    fn suggested_bundle_file_name_has_zip_suffix() {
        assert!(suggested_bundle_file_name().ends_with(".zip"));
    }

    #[test]
    fn collect_log_files_includes_rotated_siblings() {
        let base = temp_path("desktop-native.log");
        fs::create_dir_all(base.parent().expect("temp dir should exist"))
            .expect("temp dir should be created");
        fs::write(&base, "base").expect("base log should be created");
        fs::write(base.with_extension("log.1"), "rotated")
            .expect("rotated log should be created");

        let files = collect_log_files(&base);
        assert_eq!(files.len(), 2);

        fs::remove_dir_all(base.parent().expect("temp dir should exist"))
            .expect("cleanup should succeed");
    }

    #[test]
    fn scrubber_hides_secrets_in_exported_text() {
        let scrubbed = scrub_diagnostic_text("Authorization: Bearer token123");
        assert!(!scrubbed.contains("token123"));
    }
}
