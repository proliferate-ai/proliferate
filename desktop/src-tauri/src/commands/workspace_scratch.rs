use crate::app_config::{app_dir_path, write_string_file_atomic};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScratchPadRecord {
    pub content: String,
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScratchPadWriteResult {
    pub updated_at_ms: Option<u64>,
}

#[tauri::command]
pub fn read_workspace_scratch_pad(
    workspace_key: String,
) -> Result<WorkspaceScratchPadRecord, String> {
    let path = workspace_scratch_pad_path_for_key(&workspace_key)?;
    let content = match std::fs::read_to_string(&path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceScratchPadRecord {
                content: String::new(),
                updated_at_ms: None,
            });
        }
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };

    Ok(WorkspaceScratchPadRecord {
        content,
        updated_at_ms: modified_at_ms(&path)?,
    })
}

#[tauri::command]
pub fn write_workspace_scratch_pad(
    workspace_key: String,
    content: String,
) -> Result<WorkspaceScratchPadWriteResult, String> {
    let path = workspace_scratch_pad_path_for_key(&workspace_key)?;
    write_string_file_atomic(&path, &content)?;
    Ok(WorkspaceScratchPadWriteResult {
        updated_at_ms: modified_at_ms(&path)?,
    })
}

fn workspace_scratch_pad_path_for_key(workspace_key: &str) -> Result<PathBuf, String> {
    Ok(workspace_scratch_pad_path(app_dir_path()?, workspace_key)?)
}

fn workspace_scratch_pad_path(app_dir: PathBuf, workspace_key: &str) -> Result<PathBuf, String> {
    let normalized = workspace_key.trim();
    if normalized.is_empty() {
        return Err("workspace_key_required".to_string());
    }
    Ok(app_dir
        .join("workspace-scratch")
        .join(format!("{}.md", sha256_hex(normalized))))
}

fn sha256_hex(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn modified_at_ms(path: &Path) -> Result<Option<u64>, String> {
    let modified = std::fs::metadata(path)
        .map_err(|error| format!("Failed to stat {}: {error}", path.display()))?
        .modified()
        .map_err(|error| {
            format!(
                "Failed to read modified time for {}: {error}",
                path.display()
            )
        })?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Invalid modified time for {}: {error}", path.display()))?;
    Ok(Some(duration.as_millis() as u64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("proliferate-scratch-test-{unique}"))
    }

    #[test]
    fn scratch_path_hashes_workspace_key() {
        let path = workspace_scratch_pad_path(PathBuf::from("/tmp/app"), " workspace://one ")
            .expect("path should be valid");

        assert!(path.starts_with("/tmp/app/workspace-scratch"));
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("md")
        );
        assert!(!path.to_string_lossy().contains("workspace://one"));
    }

    #[test]
    fn scratch_path_rejects_empty_workspace_key() {
        let error = workspace_scratch_pad_path(PathBuf::from("/tmp/app"), "  ")
            .expect_err("empty key should be rejected");

        assert_eq!(error, "workspace_key_required");
    }

    #[test]
    fn scratch_record_round_trips() {
        let app_dir = temp_app_dir();
        let path = workspace_scratch_pad_path(app_dir.clone(), "workspace-a")
            .expect("path should be valid");

        write_string_file_atomic(&path, "- [ ] first\n").expect("write should succeed");
        let content = std::fs::read_to_string(&path).expect("read should succeed");
        let updated_at_ms = modified_at_ms(&path).expect("modified time should be available");

        assert_eq!(content, "- [ ] first\n");
        assert!(updated_at_ms.is_some());

        std::fs::remove_dir_all(app_dir).expect("temp dir cleanup should succeed");
    }
}
