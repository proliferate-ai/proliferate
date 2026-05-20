use std::collections::{BTreeMap, HashMap};

use anyharness_contract::v1::{
    ApplyRuntimeConfigRequest, ApplyRuntimeConfigResponse, RuntimeArtifactPayload,
    RuntimeConfigExternalScope, RuntimeConfigManifest, RuntimeConfigRevision,
    RuntimeConfigRevisionExpectation, RuntimeConfigStatusResponse, RuntimeMcpLaunch,
    RuntimeMcpServer, RuntimeMcpValue, RuntimeSkill, SessionMcpBindingSummary,
};
use rusqlite::{params, OptionalExtension, Row};

use crate::domains::plugins::{
    SessionPlugin, SessionPluginBundle, SessionPluginSkill, SessionPluginSkillResource,
};
use crate::persistence::Db;
use crate::sessions::mcp_bindings::model::{
    SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    SessionMcpStdioServer,
};

#[derive(Clone)]
pub struct RuntimeConfigStore {
    db: Db,
}

#[derive(Debug, Clone)]
struct RuntimeConfigRecord {
    revision: RuntimeConfigRevision,
    manifest: RuntimeConfigManifest,
    artifact_payloads: Vec<RuntimeArtifactPayload>,
}

impl RuntimeConfigStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    fn upsert_current(
        &self,
        scope_key: &str,
        request: &ApplyRuntimeConfigRequest,
    ) -> anyhow::Result<bool> {
        let manifest_json = serde_json::to_string(&request.manifest)?;
        let artifact_payloads_json = serde_json::to_string(&request.artifact_payloads)?;
        let scope = request
            .revision
            .external_scope
            .clone()
            .unwrap_or_else(default_external_scope);
        let changed = self.db.with_tx(|conn| {
            let changed = conn.execute(
                "INSERT INTO runtime_config_current (
                    scope_key, scope_provider, scope_id, target_id, revision_id, sequence,
                    content_hash, manifest_json, artifact_payloads_json, source,
                    applied_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    datetime('now'), datetime('now')
                 )
                 ON CONFLICT(scope_key) DO UPDATE SET
                    scope_provider = excluded.scope_provider,
                    scope_id = excluded.scope_id,
                    target_id = excluded.target_id,
                    revision_id = excluded.revision_id,
                    sequence = excluded.sequence,
                    content_hash = excluded.content_hash,
                    manifest_json = excluded.manifest_json,
                    artifact_payloads_json = excluded.artifact_payloads_json,
                    source = excluded.source,
                    applied_at = datetime('now'),
                    updated_at = datetime('now')
                 WHERE runtime_config_current.sequence <= excluded.sequence",
                params![
                    scope_key,
                    scope.provider,
                    scope.id,
                    scope.target_id.as_deref(),
                    request.revision.id,
                    request.revision.sequence,
                    request.revision.content_hash,
                    manifest_json,
                    artifact_payloads_json,
                    format!("{:?}", request.source).to_lowercase(),
                ],
            )?;
            for artifact in &request.artifact_payloads {
                conn.execute(
                    "INSERT INTO runtime_config_artifacts (
                        hash, content_type, byte_size, source_ref, content, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                     ON CONFLICT(hash) DO UPDATE SET
                        content_type = excluded.content_type,
                        byte_size = excluded.byte_size,
                        source_ref = excluded.source_ref,
                        content = excluded.content,
                        updated_at = datetime('now')",
                    params![
                        artifact.hash,
                        artifact.content_type,
                        artifact.byte_size,
                        artifact.source_ref.as_deref(),
                        artifact.content,
                    ],
                )?;
            }
            Ok(changed > 0)
        })?;
        Ok(changed)
    }

    fn latest(&self) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision_id, sequence,
                        content_hash, manifest_json, artifact_payloads_json
                 FROM runtime_config_current
                 ORDER BY updated_at DESC
                 LIMIT 1",
                [],
                runtime_config_record_from_row,
            )
            .optional()
        })
    }

    fn find_by_scope(&self, scope_key: &str) -> anyhow::Result<Option<RuntimeConfigRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT scope_provider, scope_id, target_id, revision_id, sequence,
                        content_hash, manifest_json, artifact_payloads_json
                 FROM runtime_config_current
                 WHERE scope_key = ?1",
                [scope_key],
                runtime_config_record_from_row,
            )
            .optional()
        })
    }
}

fn runtime_config_record_from_row(row: &Row<'_>) -> rusqlite::Result<RuntimeConfigRecord> {
    let scope = RuntimeConfigExternalScope {
        provider: row.get(0)?,
        id: row.get(1)?,
        target_id: row.get(2)?,
    };
    let manifest_json: String = row.get(6)?;
    let artifacts_json: String = row.get(7)?;
    let manifest = serde_json::from_str(&manifest_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let artifact_payloads = serde_json::from_str(&artifacts_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(RuntimeConfigRecord {
        revision: RuntimeConfigRevision {
            id: row.get(3)?,
            sequence: row.get(4)?,
            content_hash: row.get(5)?,
            external_scope: Some(scope),
        },
        manifest,
        artifact_payloads,
    })
}

#[derive(Clone)]
pub struct RuntimeConfigService {
    store: RuntimeConfigStore,
}

#[derive(Debug, thiserror::Error)]
pub enum RuntimeConfigError {
    #[error("runtime config is missing")]
    Missing,
    #[error("runtime config revision is stale")]
    Stale,
    #[error("runtime config contains unresolved credentials")]
    UnresolvedCredentials,
    #[error("runtime config artifact is missing: {0}")]
    MissingArtifact(String),
    #[error("runtime config value is not materialized")]
    UnmaterializedValue,
    #[error("runtime config storage error: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct RuntimeConfigSessionInputs {
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
    pub plugin_bundle: Option<SessionPluginBundle>,
}

impl RuntimeConfigService {
    pub fn new(store: RuntimeConfigStore) -> Self {
        Self { store }
    }

    pub fn apply_config(
        &self,
        request: ApplyRuntimeConfigRequest,
    ) -> Result<ApplyRuntimeConfigResponse, RuntimeConfigError> {
        validate_apply_request(&request)?;
        let scope_key = scope_key(request.revision.external_scope.as_ref());
        let applied = self.store.upsert_current(&scope_key, &request)?;
        Ok(ApplyRuntimeConfigResponse {
            applied,
            revision: request.revision,
            status: if applied { "applied" } else { "stale" }.to_string(),
        })
    }

    pub fn status(&self) -> Result<RuntimeConfigStatusResponse, RuntimeConfigError> {
        let current = self.store.latest()?;
        Ok(match current {
            Some(record) => RuntimeConfigStatusResponse {
                current_revision: Some(record.revision),
                manifest: Some(record.manifest),
                artifact_payloads: record.artifact_payloads,
            },
            None => RuntimeConfigStatusResponse {
                current_revision: None,
                manifest: None,
                artifact_payloads: Vec::new(),
            },
        })
    }

    pub fn session_inputs_for_expected(
        &self,
        expected: &RuntimeConfigRevisionExpectation,
    ) -> Result<RuntimeConfigSessionInputs, RuntimeConfigError> {
        let current = if expected.external_scope.is_some() {
            self.store
                .find_by_scope(&scope_key(expected.external_scope.as_ref()))?
        } else {
            self.store.latest()?
        }
        .ok_or(RuntimeConfigError::Missing)?;
        if current.revision.id != expected.revision_id
            || current.revision.content_hash != expected.content_hash
            || expected
                .sequence
                .is_some_and(|sequence| current.revision.sequence != sequence)
        {
            return Err(RuntimeConfigError::Stale);
        }
        if !current.manifest.mcp_servers.iter().all(|server| {
            server.credential_refs.is_empty() && runtime_launch_is_materialized(&server.launch)
        }) || current
            .manifest
            .skills
            .iter()
            .any(|skill| !skill.credential_refs.is_empty())
        {
            return Err(RuntimeConfigError::UnresolvedCredentials);
        }
        let mcp_servers = current
            .manifest
            .mcp_servers
            .iter()
            .map(runtime_mcp_to_session_mcp)
            .collect::<Result<Vec<_>, _>>()?;
        let artifacts = current
            .artifact_payloads
            .iter()
            .map(|artifact| (artifact.hash.as_str(), artifact))
            .collect::<HashMap<_, _>>();
        let plugin_bundle = runtime_skills_to_plugin_bundle(
            &current.manifest.skills,
            &current.manifest.mcp_servers,
            &mcp_servers,
            &current.manifest.mcp_binding_summaries,
            &artifacts,
        )?;
        let summaries = if current.manifest.mcp_binding_summaries.is_empty() {
            None
        } else {
            Some(current.manifest.mcp_binding_summaries)
        };
        Ok(RuntimeConfigSessionInputs {
            mcp_servers,
            mcp_binding_summaries: summaries,
            plugin_bundle,
        })
    }
}

fn validate_apply_request(request: &ApplyRuntimeConfigRequest) -> Result<(), RuntimeConfigError> {
    if !request.manifest.mcp_servers.iter().all(|server| {
        server.credential_refs.is_empty() && runtime_launch_is_materialized(&server.launch)
    }) || request
        .manifest
        .skills
        .iter()
        .any(|skill| !skill.credential_refs.is_empty())
    {
        return Err(RuntimeConfigError::UnresolvedCredentials);
    }
    let payloads = request
        .artifact_payloads
        .iter()
        .map(|artifact| (artifact.hash.as_str(), artifact))
        .collect::<HashMap<_, _>>();
    for artifact in &request.manifest.artifacts {
        match payloads.get(artifact.hash.as_str()) {
            Some(payload)
                if payload.content_type == artifact.content_type
                    && payload.byte_size == artifact.byte_size => {}
            _ => return Err(RuntimeConfigError::MissingArtifact(artifact.hash.clone())),
        }
    }
    Ok(())
}

fn runtime_launch_is_materialized(launch: &RuntimeMcpLaunch) -> bool {
    match launch {
        RuntimeMcpLaunch::Http {
            url,
            headers,
            query,
        } => {
            runtime_value_is_literal(url)
                && headers
                    .iter()
                    .all(|header| runtime_value_is_literal(&header.value))
                && query
                    .iter()
                    .all(|query| runtime_value_is_literal(&query.value))
        }
        RuntimeMcpLaunch::Stdio { command, args, env } => {
            runtime_value_is_literal(command)
                && args.iter().all(runtime_value_is_literal)
                && env.iter().all(|env| runtime_value_is_literal(&env.value))
        }
    }
}

fn runtime_value_is_literal(value: &RuntimeMcpValue) -> bool {
    matches!(value, RuntimeMcpValue::Literal { .. })
}

fn literal_runtime_value(value: &RuntimeMcpValue) -> Result<String, RuntimeConfigError> {
    match value {
        RuntimeMcpValue::Literal { value } => Ok(value.clone()),
        RuntimeMcpValue::Credential { .. } | RuntimeMcpValue::Template { .. } => {
            Err(RuntimeConfigError::UnmaterializedValue)
        }
    }
}

fn runtime_mcp_to_session_mcp(
    server: &RuntimeMcpServer,
) -> Result<SessionMcpServer, RuntimeConfigError> {
    match &server.launch {
        RuntimeMcpLaunch::Http { url, headers, .. } => {
            Ok(SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: server.id.clone(),
                catalog_entry_id: server.catalog_entry_id.clone(),
                server_name: server.server_name.clone(),
                url: literal_runtime_value(url)?,
                headers: headers
                    .iter()
                    .map(|header| {
                        Ok(SessionMcpHeader {
                            name: header.name.clone(),
                            value: literal_runtime_value(&header.value)?,
                        })
                    })
                    .collect::<Result<Vec<_>, RuntimeConfigError>>()?,
            }))
        }
        RuntimeMcpLaunch::Stdio { command, args, env } => {
            Ok(SessionMcpServer::Stdio(SessionMcpStdioServer {
                connection_id: server.id.clone(),
                catalog_entry_id: server.catalog_entry_id.clone(),
                server_name: server.server_name.clone(),
                command: literal_runtime_value(command)?,
                args: args
                    .iter()
                    .map(literal_runtime_value)
                    .collect::<Result<Vec<_>, _>>()?,
                env: env
                    .iter()
                    .map(|env| {
                        Ok(SessionMcpEnvVar {
                            name: env.name.clone(),
                            value: literal_runtime_value(&env.value)?,
                        })
                    })
                    .collect::<Result<Vec<_>, RuntimeConfigError>>()?,
            }))
        }
    }
}

fn runtime_skills_to_plugin_bundle(
    skills: &[RuntimeSkill],
    runtime_mcp_servers: &[RuntimeMcpServer],
    mcp_servers: &[SessionMcpServer],
    mcp_binding_summaries: &[SessionMcpBindingSummary],
    artifacts: &HashMap<&str, &RuntimeArtifactPayload>,
) -> Result<Option<SessionPluginBundle>, RuntimeConfigError> {
    if skills.is_empty() {
        return Ok(None);
    }
    let mut server_names = BTreeMap::new();
    for server in runtime_mcp_servers {
        server_names.insert(server.id.clone(), server.server_name.clone());
        server_names.insert(server.connection_id.clone(), server.server_name.clone());
    }
    for server in mcp_servers {
        match server {
            SessionMcpServer::Http(server) => {
                server_names.insert(server.connection_id.clone(), server.server_name.clone());
            }
            SessionMcpServer::Stdio(server) => {
                server_names.insert(server.connection_id.clone(), server.server_name.clone());
            }
        }
    }
    let plugin_skills = skills
        .iter()
        .map(|skill| runtime_skill_to_session_skill(skill, artifacts, &server_names))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(SessionPluginBundle {
        plugins: vec![SessionPlugin {
            plugin_id: "runtime-config".to_string(),
            version: None,
            skills: plugin_skills,
            mcp_servers: mcp_servers.to_vec(),
            mcp_binding_summaries: mcp_binding_summaries.to_vec(),
            credential_bindings: Vec::new(),
        }],
    }))
}

fn runtime_skill_to_session_skill(
    skill: &RuntimeSkill,
    artifacts: &HashMap<&str, &RuntimeArtifactPayload>,
    server_names: &BTreeMap<String, String>,
) -> Result<SessionPluginSkill, RuntimeConfigError> {
    let instruction = artifacts
        .get(skill.instruction_artifact.hash.as_str())
        .ok_or_else(|| {
            RuntimeConfigError::MissingArtifact(skill.instruction_artifact.hash.clone())
        })?;
    let resources = skill
        .resources
        .iter()
        .map(|resource| {
            let payload = artifacts
                .get(resource.hash.as_str())
                .ok_or_else(|| RuntimeConfigError::MissingArtifact(resource.hash.clone()))?;
            Ok(SessionPluginSkillResource {
                resource_id: resource
                    .source_ref
                    .clone()
                    .unwrap_or_else(|| resource.hash.clone()),
                display_name: resource.source_ref.clone(),
                content_type: payload.content_type.clone(),
                content: payload.content.clone(),
            })
        })
        .collect::<Result<Vec<_>, RuntimeConfigError>>()?;
    let required_mcp_servers = skill
        .required_mcp_server_ids
        .iter()
        .map(|id| server_names.get(id).cloned().unwrap_or_else(|| id.clone()))
        .collect();
    Ok(SessionPluginSkill {
        skill_id: skill.id.clone(),
        display_name: skill.display_name.clone(),
        description: skill.description.clone(),
        instructions: instruction.content.clone(),
        resources,
        required_mcp_servers,
        credential_binding_ids: Vec::new(),
    })
}

fn default_external_scope() -> RuntimeConfigExternalScope {
    RuntimeConfigExternalScope {
        provider: "local".to_string(),
        id: "default".to_string(),
        target_id: None,
    }
}

fn scope_key(scope: Option<&RuntimeConfigExternalScope>) -> String {
    let scope = scope.cloned().unwrap_or_else(default_external_scope);
    match scope.target_id.as_deref() {
        Some(target_id) if !target_id.is_empty() => {
            format!("{}:{}:{}", scope.provider, scope.id, target_id)
        }
        _ => format!("{}:{}", scope.provider, scope.id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::{
        RuntimeArtifactRef, RuntimeConfigSource, RuntimeCredentialRef, RuntimeCredentialUse,
        RuntimeMcpNamedValue, RuntimeMcpServer, RuntimeMcpTransport, RuntimeSkill,
        RuntimeSkillSourceKind, SessionMcpBindingOutcome, SessionMcpBindingSummary,
        SessionMcpTransport,
    };

    #[test]
    fn apply_and_session_inputs_require_current_revision() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let request = apply_request();
        service.apply_config(request.clone()).expect("apply");

        let inputs = service
            .session_inputs_for_expected(&RuntimeConfigRevisionExpectation {
                revision_id: request.revision.id.clone(),
                sequence: Some(request.revision.sequence),
                content_hash: request.revision.content_hash.clone(),
                external_scope: request.revision.external_scope.clone(),
            })
            .expect("runtime inputs");
        assert_eq!(inputs.mcp_servers.len(), 1);
        assert_eq!(inputs.mcp_binding_summaries.expect("summaries").len(), 1);
        assert_eq!(
            inputs
                .plugin_bundle
                .expect("plugin bundle")
                .plugins
                .first()
                .expect("plugin")
                .skills
                .first()
                .expect("skill")
                .instructions,
            "# Use GitHub\n"
        );

        let stale = service.session_inputs_for_expected(&RuntimeConfigRevisionExpectation {
            revision_id: "rev-old".to_string(),
            sequence: Some(1),
            content_hash: "sha256:old".to_string(),
            external_scope: None,
        });
        assert!(matches!(stale, Err(RuntimeConfigError::Stale)));
    }

    #[test]
    fn apply_rejects_missing_artifact_payloads() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let mut request = apply_request();
        request.artifact_payloads.clear();
        assert!(matches!(
            service.apply_config(request),
            Err(RuntimeConfigError::MissingArtifact(_))
        ));
    }

    #[test]
    fn apply_rejects_unresolved_credentials() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let mut request = apply_request();
        request.manifest.mcp_servers[0]
            .credential_refs
            .push(RuntimeCredentialRef {
                credential_ref: "mcp:secret".to_string(),
                used_in: RuntimeCredentialUse::McpLaunchHeader,
                mcp_server_id: Some("mcp:1".to_string()),
                field_name: "Authorization".to_string(),
            });
        assert!(matches!(
            service.apply_config(request),
            Err(RuntimeConfigError::UnresolvedCredentials)
        ));
    }

    #[test]
    fn python_manifest_shape_deserializes() {
        let raw = serde_json::json!({
            "mcpServers": [{
                "id": "mcp:1",
                "connectionId": "conn-1",
                "catalogEntryId": "github",
                "serverName": "github",
                "transport": "http",
                "launch": {
                    "kind": "http",
                    "url": {"kind": "literal", "value": "https://example.test/mcp"},
                    "headers": [],
                    "query": []
                },
                "credentialRefs": []
            }],
            "mcpBindingSummaries": [{
                "id": "mcp:1",
                "serverName": "github",
                "displayName": "GitHub",
                "transport": "http",
                "outcome": "applied"
            }],
            "skills": [],
            "artifacts": [],
            "warnings": []
        });
        let manifest: RuntimeConfigManifest =
            serde_json::from_value(raw).expect("manifest should match Rust contract");
        assert_eq!(manifest.mcp_servers.len(), 1);
        assert_eq!(manifest.mcp_binding_summaries.len(), 1);
    }

    fn apply_request() -> ApplyRuntimeConfigRequest {
        let artifact = RuntimeArtifactRef {
            hash: "sha256:instructions".to_string(),
            content_type: "text/markdown".to_string(),
            byte_size: 13,
            source_ref: Some("plugin:github:instructions".to_string()),
        };
        ApplyRuntimeConfigRequest {
            revision: RuntimeConfigRevision {
                id: "rev-1".to_string(),
                sequence: 2,
                content_hash: "sha256:manifest".to_string(),
                external_scope: Some(RuntimeConfigExternalScope {
                    provider: "proliferate-cloud".to_string(),
                    id: "profile-1".to_string(),
                    target_id: Some("target-1".to_string()),
                }),
            },
            manifest: RuntimeConfigManifest {
                mcp_servers: vec![RuntimeMcpServer {
                    id: "mcp:1".to_string(),
                    connection_id: "conn-1".to_string(),
                    catalog_entry_id: Some("github".to_string()),
                    server_name: "github".to_string(),
                    transport: RuntimeMcpTransport::Http,
                    launch: RuntimeMcpLaunch::Http {
                        url: RuntimeMcpValue::Literal {
                            value: "https://example.test/mcp".to_string(),
                        },
                        headers: vec![RuntimeMcpNamedValue {
                            name: "X-Test".to_string(),
                            value: RuntimeMcpValue::Literal {
                                value: "ok".to_string(),
                            },
                        }],
                        query: Vec::new(),
                    },
                    credential_refs: Vec::new(),
                }],
                mcp_binding_summaries: vec![SessionMcpBindingSummary {
                    id: "mcp:1".to_string(),
                    server_name: "github".to_string(),
                    display_name: Some("GitHub".to_string()),
                    transport: SessionMcpTransport::Http,
                    outcome: SessionMcpBindingOutcome::Applied,
                    reason: None,
                }],
                skills: vec![RuntimeSkill {
                    id: "plugin:github:use".to_string(),
                    source_kind: RuntimeSkillSourceKind::Plugin,
                    display_name: "Use GitHub".to_string(),
                    description: "Use GitHub".to_string(),
                    instruction_artifact: artifact.clone(),
                    resources: Vec::new(),
                    required_mcp_server_ids: vec!["conn-1".to_string()],
                    credential_refs: Vec::new(),
                }],
                artifacts: vec![artifact],
                warnings: Vec::new(),
            },
            artifact_payloads: vec![RuntimeArtifactPayload {
                hash: "sha256:instructions".to_string(),
                content_type: "text/markdown".to_string(),
                byte_size: 13,
                source_ref: Some("plugin:github:instructions".to_string()),
                content: "# Use GitHub\n".to_string(),
            }],
            source: RuntimeConfigSource::Worker,
        }
    }
}
