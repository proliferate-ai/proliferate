use std::{collections::HashMap, path::Path};

use anyharness_contract::v1::{
    RuntimeArtifactRef, RuntimeConfigManifest, RuntimeMcpLaunch, RuntimeMcpNamedValue,
    RuntimeMcpValue,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

pub fn materialize_manifest_credentials(
    manifest: &RuntimeConfigManifest,
    credentials: &HashMap<String, String>,
) -> Result<RuntimeConfigManifest, WorkerError> {
    let mut manifest = manifest.clone();
    for server in &mut manifest.mcp_servers {
        server.launch = materialize_launch(&server.launch, credentials)?;
        server.credential_refs.clear();
    }
    for skill in &mut manifest.skills {
        skill.credential_refs.clear();
    }
    Ok(manifest)
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
                collect_value_credential_refs(refs, part);
            }
        }
    }
}

fn push_unique(refs: &mut Vec<String>, credential_ref: String) {
    if !refs.contains(&credential_ref) {
        refs.push(credential_ref);
    }
}

fn materialize_launch(
    launch: &RuntimeMcpLaunch,
    credentials: &HashMap<String, String>,
) -> Result<RuntimeMcpLaunch, WorkerError> {
    match launch {
        RuntimeMcpLaunch::Http {
            url,
            headers,
            query,
        } => Ok(RuntimeMcpLaunch::Http {
            url: materialize_value(url, credentials)?,
            headers: materialize_named_values(headers, credentials)?,
            query: materialize_named_values(query, credentials)?,
        }),
        RuntimeMcpLaunch::Stdio { command, args, env } => Ok(RuntimeMcpLaunch::Stdio {
            command: materialize_value(command, credentials)?,
            args: args
                .iter()
                .map(|arg| materialize_value(arg, credentials))
                .collect::<Result<Vec<_>, _>>()?,
            env: materialize_named_values(env, credentials)?,
        }),
    }
}

fn materialize_named_values(
    values: &[RuntimeMcpNamedValue],
    credentials: &HashMap<String, String>,
) -> Result<Vec<RuntimeMcpNamedValue>, WorkerError> {
    values
        .iter()
        .map(|value| {
            Ok(RuntimeMcpNamedValue {
                name: value.name.clone(),
                value: materialize_value(&value.value, credentials)?,
            })
        })
        .collect()
}

fn materialize_value(
    value: &RuntimeMcpValue,
    credentials: &HashMap<String, String>,
) -> Result<RuntimeMcpValue, WorkerError> {
    match value {
        RuntimeMcpValue::Literal { .. } => Ok(value.clone()),
        RuntimeMcpValue::Credential { credential_ref } => credentials
            .get(credential_ref)
            .cloned()
            .map(|value| RuntimeMcpValue::Literal { value })
            .ok_or_else(|| {
                WorkerError::Materialization(
                    "runtime config credential ref could not be materialized".to_string(),
                )
            }),
        RuntimeMcpValue::Template { parts } => {
            let mut rendered = String::new();
            for part in parts {
                rendered.push_str(&materialize_value_to_string(part, credentials)?);
            }
            Ok(RuntimeMcpValue::Literal { value: rendered })
        }
    }
}

fn materialize_value_to_string(
    value: &RuntimeMcpValue,
    credentials: &HashMap<String, String>,
) -> Result<String, WorkerError> {
    match materialize_value(value, credentials)? {
        RuntimeMcpValue::Literal { value } => Ok(value),
        RuntimeMcpValue::Credential { .. } | RuntimeMcpValue::Template { .. } => {
            Err(WorkerError::Materialization(
                "runtime config value could not be materialized".to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn materializes_runtime_config_credentials_for_apply() {
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
        let mut credentials = HashMap::new();
        credentials.insert(
            "mcp:conn-db:api_key".to_string(),
            "secret-token".to_string(),
        );

        let materialized =
            materialize_manifest_credentials(&manifest, &credentials).expect("materialized");

        assert!(materialized.mcp_servers[0].credential_refs.is_empty());
        assert!(materialized.skills[0].credential_refs.is_empty());
        let RuntimeMcpLaunch::Http { headers, .. } = &materialized.mcp_servers[0].launch else {
            panic!("expected http launch");
        };
        assert_eq!(
            headers[0].value,
            RuntimeMcpValue::Literal {
                value: "Bearer secret-token".to_string()
            }
        );
    }
}
