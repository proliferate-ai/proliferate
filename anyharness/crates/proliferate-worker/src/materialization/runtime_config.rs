use std::path::Path;

use anyharness_contract::v1::{
    RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeConfigManifest, RuntimeMcpLaunch,
    RuntimeMcpTemplatePart, RuntimeMcpValue,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::WorkerError;

use super::files::write_file;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeConfigMaterializationFragment {
    pub revision_id: String,
    pub sandbox_profile_id: String,
    pub target_id: Option<String>,
    pub sequence: i64,
    pub content_hash: String,
    pub manifest: RuntimeConfigManifest,
    #[serde(default)]
    pub artifact_refs: Vec<RuntimeArtifactRef>,
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
            mcp_server_count: self.manifest.mcp_servers.len(),
            skill_count: self.manifest.skills.len(),
            artifact_count: self.artifact_refs.len(),
            credential_ref_count: self.credential_refs.len(),
        }
    }
}

pub fn manifest_credential_refs(manifest: &RuntimeConfigManifest) -> Vec<String> {
    let mut refs = Vec::new();
    for server in &manifest.mcp_servers {
        for credential_ref in &server.credential_refs {
            push_unique(&mut refs, credential_ref.credential_ref.clone());
        }
        match &server.launch {
            RuntimeMcpLaunch::Http {
                url,
                headers,
                query,
            } => {
                collect_value_credential_refs(&mut refs, url);
                for header in headers {
                    collect_value_credential_refs(&mut refs, &header.value);
                }
                for query in query {
                    collect_value_credential_refs(&mut refs, &query.value);
                }
            }
            RuntimeMcpLaunch::Stdio { command, args, env } => {
                collect_value_credential_refs(&mut refs, command);
                for arg in args {
                    collect_value_credential_refs(&mut refs, arg);
                }
                for env in env {
                    collect_value_credential_refs(&mut refs, &env.value);
                }
            }
        }
    }
    refs
}

pub fn validate_runtime_artifact_payload(
    artifact: &RuntimeArtifactRef,
    payload: &RuntimeArtifactPayload,
) -> Result<(), WorkerError> {
    if payload.hash != artifact.hash
        || payload.content_type != artifact.content_type
        || payload.byte_size != artifact.byte_size
        || payload.content.as_bytes().len() as i64 != artifact.byte_size
        || runtime_artifact_hash(&payload.content) != artifact.hash
    {
        return Err(WorkerError::Materialization(format!(
            "Runtime config artifact integrity mismatch for {}.",
            artifact.hash
        )));
    }
    Ok(())
}

fn runtime_artifact_hash(content: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
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
        "targetId": runtime_config.target_id,
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

fn collect_value_credential_refs(refs: &mut Vec<String>, value: &RuntimeMcpValue) {
    match value {
        RuntimeMcpValue::Literal { .. } => {}
        RuntimeMcpValue::Credential { credential_ref } => {
            push_unique(refs, credential_ref.clone());
        }
        RuntimeMcpValue::Template { parts } => {
            for part in parts {
                collect_template_part_credential_refs(refs, part);
            }
        }
    }
}

fn collect_template_part_credential_refs(refs: &mut Vec<String>, part: &RuntimeMcpTemplatePart) {
    match part {
        RuntimeMcpTemplatePart::Literal { .. } => {}
        RuntimeMcpTemplatePart::Credential { credential_ref } => {
            push_unique(refs, credential_ref.clone());
        }
    }
}

fn push_unique(refs: &mut Vec<String>, credential_ref: String) {
    if !refs.contains(&credential_ref) {
        refs.push(credential_ref);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collects_runtime_config_credential_refs_without_mutating_manifest() {
        let manifest = serde_json::from_value::<RuntimeConfigManifest>(json!({
            "mcpServers": [{
                "id": "mcp:1",
                "connectionId": "conn-1",
                "catalogEntryId": "github",
                "serverName": "github",
                "transport": "http",
                "launch": {
                    "kind": "http",
                    "url": {"kind": "literal", "value": "https://example.test/mcp"},
                    "headers": [{
                        "name": "Authorization",
                        "value": {
                            "kind": "template",
                            "parts": [
                                {"kind": "literal", "value": "Bearer "},
                                {"kind": "credential", "credentialRef": "mcp:conn-db:api_key"}
                            ]
                        }
                    }],
                    "query": []
                },
                "credentialRefs": [{
                    "credentialRef": "mcp:conn-db:api_key",
                    "usedIn": "mcp_launch_header",
                    "mcpServerId": "mcp:1",
                    "fieldName": "api_key"
                }]
            }],
            "mcpBindingSummaries": [],
            "skills": [{
                "id": "skill:1",
                "sourceKind": "plugin",
                "displayName": "Skill",
                "description": "Skill",
                "instructionArtifact": {
                    "hash": "sha256:instructions",
                    "contentType": "text/markdown",
                    "byteSize": 1
                },
                "resources": [],
                "requiredMcpServerIds": ["mcp:1"],
                "credentialRefs": ["mcp:mcp:1:credentials"]
            }],
            "artifacts": [],
            "warnings": []
        }))
        .expect("manifest");
        assert_eq!(
            manifest_credential_refs(&manifest),
            vec!["mcp:conn-db:api_key".to_string()]
        );
        assert_eq!(manifest.mcp_servers[0].credential_refs.len(), 1);
        assert_eq!(
            manifest.skills[0].credential_refs,
            vec!["mcp:mcp:1:credentials".to_string()]
        );
        let RuntimeMcpLaunch::Http { headers, .. } = &manifest.mcp_servers[0].launch else {
            panic!("expected http launch");
        };
        assert!(matches!(headers[0].value, RuntimeMcpValue::Template { .. }));
    }

    #[test]
    fn validates_runtime_artifact_payload_hash_and_metadata() {
        let content = "# Skill\n";
        let artifact = RuntimeArtifactRef {
            hash: runtime_artifact_hash(content),
            content_type: "text/markdown".to_string(),
            byte_size: content.as_bytes().len() as i64,
            source_ref: Some("skill:instructions".to_string()),
            resource_id: None,
            display_name: None,
        };
        let payload = RuntimeArtifactPayload {
            hash: artifact.hash.clone(),
            content_type: artifact.content_type.clone(),
            byte_size: artifact.byte_size,
            source_ref: artifact.source_ref.clone(),
            resource_id: None,
            display_name: None,
            content: content.to_string(),
        };
        validate_runtime_artifact_payload(&artifact, &payload).expect("valid payload");

        let mut tampered = payload;
        tampered.content = "# Different\n".to_string();
        assert!(validate_runtime_artifact_payload(&artifact, &tampered).is_err());
    }
}
