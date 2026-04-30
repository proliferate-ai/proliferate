use std::path::PathBuf;

use sha2::{Digest, Sha256};

use super::model::{ReviewAssignmentRecord, ReviewChangedFileManifest, ReviewCodeTargetManifest};
use super::runtime::ReviewRuntime;
use super::service::ReviewError;
use crate::git::GitService;

impl ReviewRuntime {
    pub(super) async fn capture_code_manifest(
        &self,
        workspace_id: &str,
    ) -> Result<ReviewCodeTargetManifest, ReviewError> {
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::WorkspaceNotFound(workspace_id.to_string()))?;
        let workspace_path = PathBuf::from(&workspace.path);
        let snapshot = tokio::task::spawn_blocking({
            let workspace_id = workspace_id.to_string();
            let workspace_path = workspace_path.clone();
            move || GitService::status(&workspace_id, &workspace_path)
        })
        .await
        .map_err(|error| ReviewError::Internal(anyhow::anyhow!(error.to_string())))?
        .map_err(ReviewError::Internal)?;
        let mut changed_files = Vec::new();
        for file in snapshot.files {
            let path = file.path.clone();
            let diff_hash = tokio::task::spawn_blocking({
                let workspace_path = workspace_path.clone();
                let path = path.clone();
                move || GitService::diff_for_path(&workspace_path, &path)
            })
            .await
            .ok()
            .and_then(Result::ok)
            .and_then(|diff| diff.patch.map(|patch| sha256_hex(patch.as_bytes())));
            changed_files.push(ReviewChangedFileManifest {
                path,
                status: format!("{:?}", file.status),
                diff_hash,
            });
        }
        changed_files.sort_by(|a, b| a.path.cmp(&b.path));
        let captured_at = chrono::Utc::now().to_rfc3339();
        let hash_input = serde_json::json!({
            "gitHead": snapshot.head_oid,
            "branch": snapshot.current_branch,
            "changedFiles": changed_files,
        });
        let manifest_hash = sha256_hex(hash_input.to_string().as_bytes());
        let changed_files: Vec<ReviewChangedFileManifest> =
            serde_json::from_value(hash_input["changedFiles"].clone())
                .map_err(|error| ReviewError::Internal(anyhow::Error::from(error)))?;
        Ok(ReviewCodeTargetManifest {
            git_head: Some(snapshot.head_oid),
            branch: snapshot.current_branch,
            changed_files,
            manifest_hash,
            captured_at,
        })
    }

    pub(super) fn write_critique_artifact(
        &self,
        assignment: &ReviewAssignmentRecord,
        critique_markdown: &str,
    ) -> Result<String, ReviewError> {
        let path = self
            .runtime_home
            .join("review-artifacts")
            .join(&assignment.review_run_id)
            .join(&assignment.review_round_id);
        std::fs::create_dir_all(&path)
            .map_err(|error| ReviewError::Internal(anyhow::Error::from(error)))?;
        let file_name = format!("{}.md", slugify(&assignment.persona_label));
        let file_path = path.join(file_name);
        std::fs::write(&file_path, critique_markdown)
            .map_err(|error| ReviewError::Internal(anyhow::Error::from(error)))?;
        Ok(file_path.display().to_string())
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn slugify(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch.is_ascii_whitespace() || ch == '-' || ch == '_') && !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "reviewer".to_string()
    } else {
        trimmed.to_string()
    }
}
