use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::WorkerError;

use super::files::write_file;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeConfigMaterializationFragment {
    pub revision_id: String,
    pub sandbox_profile_id: String,
    pub sequence: i64,
    pub content_hash: String,
    pub manifest: Value,
    #[serde(default)]
    pub artifact_refs: Vec<Value>,
    #[serde(default)]
    pub credential_refs: Vec<Value>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfigProjectionSummary {
    pub revision_id: String,
    pub sandbox_profile_id: String,
    pub sequence: i64,
    pub content_hash: String,
    pub mcp_server_count: usize,
    pub skill_count: usize,
    pub artifact_count: usize,
    pub credential_ref_count: usize,
}

impl RuntimeConfigMaterializationFragment {
    pub fn summary(&self) -> RuntimeConfigProjectionSummary {
        RuntimeConfigProjectionSummary {
            revision_id: self.revision_id.clone(),
            sandbox_profile_id: self.sandbox_profile_id.clone(),
            sequence: self.sequence,
            content_hash: self.content_hash.clone(),
            mcp_server_count: array_len(&self.manifest, "mcpServers"),
            skill_count: array_len(&self.manifest, "skills"),
            artifact_count: self.artifact_refs.len(),
            credential_ref_count: self.credential_refs.len(),
        }
    }
}

pub fn write_runtime_config_projection(
    workspace_root: &Path,
    runtime_config: Option<&RuntimeConfigMaterializationFragment>,
) -> Result<Option<RuntimeConfigProjectionSummary>, WorkerError> {
    let Some(runtime_config) = runtime_config else {
        return Ok(None);
    };
    let projection = serde_json::json!({
        "revisionId": runtime_config.revision_id,
        "sandboxProfileId": runtime_config.sandbox_profile_id,
        "sequence": runtime_config.sequence,
        "contentHash": runtime_config.content_hash,
        "manifest": runtime_config.manifest,
        "artifactRefs": runtime_config.artifact_refs,
        "credentialRefs": runtime_config.credential_refs,
    });
    let contents = serde_json::to_vec_pretty(&projection)?;
    write_file(
        &workspace_root
            .join(".proliferate")
            .join("runtime-config")
            .join("manifest.json"),
        &contents,
        true,
    )?;
    Ok(Some(runtime_config.summary()))
}

fn array_len(value: &Value, field: &str) -> usize {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}
