use std::fs;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct SaveDiagnosticJsonOptions {
    pub output_path: PathBuf,
    pub contents: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDiagnosticJsonResult {
    pub output_path: String,
}

pub fn save_diagnostic_json_to_path(
    options: SaveDiagnosticJsonOptions,
) -> Result<SaveDiagnosticJsonResult, String> {
    if let Some(parent) = options.output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }

    fs::write(&options.output_path, options.contents)
        .map_err(|error| format!("Failed to write {}: {error}", options.output_path.display()))?;

    Ok(SaveDiagnosticJsonResult {
        output_path: options.output_path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{save_diagnostic_json_to_path, SaveDiagnosticJsonOptions};

    fn temp_path(file_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("diagnostic-json-tests-{unique}"))
            .join(file_name)
    }

    #[test]
    fn writes_exact_json_content() {
        let output_path = temp_path("payload.json");
        let contents = "{\n  \"message\": \"exact\"\n}".to_string();

        let result = save_diagnostic_json_to_path(SaveDiagnosticJsonOptions {
            output_path: output_path.clone(),
            contents: contents.clone(),
        })
        .expect("json export should be written");

        assert_eq!(result.output_path, output_path.to_string_lossy());
        assert_eq!(fs::read_to_string(&output_path).unwrap(), contents);

        fs::remove_dir_all(output_path.parent().unwrap()).expect("cleanup should succeed");
    }

    #[test]
    fn preserves_full_payload_without_scrubbing() {
        let output_path = temp_path("full-payload.json");
        let contents =
            "{\"authorization\":\"Bearer token123\",\"path\":\"/Users/pablo/repo\"}".to_string();

        save_diagnostic_json_to_path(SaveDiagnosticJsonOptions {
            output_path: output_path.clone(),
            contents: contents.clone(),
        })
        .expect("json export should be written");

        let written = fs::read_to_string(&output_path).unwrap();
        assert_eq!(written, contents);
        assert!(written.contains("token123"));
        assert!(written.contains("/Users/pablo/repo"));

        fs::remove_dir_all(output_path.parent().unwrap()).expect("cleanup should succeed");
    }

    #[test]
    fn returns_json_file_path_result() {
        let output_path = temp_path("session-debug.json");

        let result = save_diagnostic_json_to_path(SaveDiagnosticJsonOptions {
            output_path: output_path.clone(),
            contents: "{}".to_string(),
        })
        .expect("json export should be written");

        assert!(result.output_path.ends_with(".json"));

        fs::remove_dir_all(output_path.parent().unwrap()).expect("cleanup should succeed");
    }
}
