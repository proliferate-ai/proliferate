use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeArtifactStatus, RuntimeConfigManifest,
    RuntimeConfigRevisionExpectation, RuntimeCredentialValue, RuntimeMcpLaunch,
    RuntimeMcpNamedValue, RuntimeMcpServer, RuntimeMcpTemplatePart, RuntimeMcpValue, RuntimeSkill,
    SessionMcpBindingSummary,
};
use sha2::{Digest, Sha256};
use url::Url;

use super::model::{
    scope_key, RuntimeConfigApplyInput, RuntimeConfigApplyOutcome, RuntimeConfigRecord,
    RuntimeConfigSessionContext, RuntimeConfigSessionSkill, RuntimeConfigSessionSkillResource,
    RuntimeConfigStatus,
};
use super::store::RuntimeConfigStore;
use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    SessionMcpStdioServer,
};

type CredentialCache = Arc<Mutex<HashMap<String, HashMap<String, String>>>>;

#[derive(Clone)]
pub struct RuntimeConfigService {
    store: RuntimeConfigStore,
    credential_cache: CredentialCache,
}

#[derive(Debug, thiserror::Error)]
pub enum RuntimeConfigError {
    #[error("runtime config is missing")]
    Missing,
    #[error("runtime config revision is stale")]
    Stale,
    #[error("runtime config contains unresolved credentials")]
    UnresolvedCredentials,
    #[error("runtime config is missing credentials: {0:?}")]
    MissingCredentials(Vec<String>),
    #[error("runtime config contains inline secret-bearing launch value: {0}")]
    InlineSecretLiteral(String),
    #[error("runtime config artifact is missing: {0}")]
    MissingArtifact(String),
    #[error("runtime config artifact integrity mismatch: {0}")]
    ArtifactIntegrityMismatch(String),
    #[error("runtime config value is not materialized")]
    UnmaterializedValue,
    #[error("runtime config storage error: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct RuntimeConfigSessionInputs {
    pub mcp_servers: Vec<SessionMcpServer>,
    pub mcp_binding_summaries: Option<Vec<SessionMcpBindingSummary>>,
    pub context: RuntimeConfigSessionContext,
}

impl RuntimeConfigService {
    pub fn new(store: RuntimeConfigStore) -> Self {
        Self {
            store,
            credential_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn apply_config(
        &self,
        input: RuntimeConfigApplyInput,
    ) -> Result<RuntimeConfigApplyOutcome, RuntimeConfigError> {
        validate_apply_input(&input)?;
        let scope_key = scope_key(input.revision.external_scope.as_ref());
        let applied = self.store.upsert_current(&scope_key, &input)?;
        if applied {
            self.cache_credentials(&input.revision.id, &input.credential_values)?;
        }
        Ok(RuntimeConfigApplyOutcome {
            applied,
            revision: input.revision,
        })
    }

    pub fn status(&self) -> Result<RuntimeConfigStatus, RuntimeConfigError> {
        let current = self.store.latest()?;
        Ok(match current {
            Some(record) => RuntimeConfigStatus {
                artifacts: self.artifact_statuses(&record.manifest)?,
                current_revision: Some(record.revision),
                manifest: Some(record.manifest),
            },
            None => RuntimeConfigStatus {
                artifacts: Vec::new(),
                current_revision: None,
                manifest: None,
            },
        })
    }

    pub fn session_inputs_for_expected(
        &self,
        expected: &RuntimeConfigRevisionExpectation,
    ) -> Result<RuntimeConfigSessionInputs, RuntimeConfigError> {
        let current = self.record_for_expected(expected)?;
        self.session_inputs_from_record(current)
    }

    pub fn bind_session_to_expected(
        &self,
        session_id: &str,
        expected: &RuntimeConfigRevisionExpectation,
    ) -> Result<RuntimeConfigSessionInputs, RuntimeConfigError> {
        let current = self.record_for_expected(expected)?;
        self.store.set_session_context(session_id, &current)?;
        self.session_inputs_from_record(current)
    }

    pub fn session_context(
        &self,
        session_id: &str,
    ) -> Result<Option<RuntimeConfigSessionContext>, RuntimeConfigError> {
        let Some(record) = self.store.find_session_context(session_id)? else {
            return Ok(None);
        };
        self.session_inputs_from_record(record)
            .map(|inputs| Some(inputs.context))
    }

    pub fn assert_session_context_matches(
        &self,
        session_id: &str,
        expected: &RuntimeConfigRevisionExpectation,
    ) -> Result<(), RuntimeConfigError> {
        let record = self
            .store
            .find_session_context(session_id)?
            .ok_or(RuntimeConfigError::Missing)?;
        if record.revision.id != expected.revision_id
            || record.revision.content_hash != expected.content_hash
            || expected
                .sequence
                .is_some_and(|sequence| record.revision.sequence != sequence)
        {
            return Err(RuntimeConfigError::Stale);
        }
        Ok(())
    }

    fn record_for_expected(
        &self,
        expected: &RuntimeConfigRevisionExpectation,
    ) -> Result<RuntimeConfigRecord, RuntimeConfigError> {
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
        Ok(current)
    }

    fn cache_credentials(
        &self,
        revision_id: &str,
        credential_values: &[RuntimeCredentialValue],
    ) -> Result<(), RuntimeConfigError> {
        let mut values = HashMap::new();
        for credential in credential_values {
            values.insert(credential.credential_ref.clone(), credential.value.clone());
        }
        let mut cache = self.credential_cache.lock().map_err(|_| {
            RuntimeConfigError::Internal(anyhow::anyhow!("credential cache poisoned"))
        })?;
        cache.insert(revision_id.to_string(), values);
        Ok(())
    }

    fn credential_values_for_revision(
        &self,
        revision_id: &str,
        required_refs: &[String],
    ) -> Result<HashMap<String, String>, RuntimeConfigError> {
        let cache = self.credential_cache.lock().map_err(|_| {
            RuntimeConfigError::Internal(anyhow::anyhow!("credential cache poisoned"))
        })?;
        let values = cache.get(revision_id);
        let mut missing = Vec::new();
        let mut resolved = HashMap::new();
        for credential_ref in required_refs {
            match values.and_then(|items| items.get(credential_ref)) {
                Some(value) => {
                    resolved.insert(credential_ref.clone(), value.clone());
                }
                None => missing.push(credential_ref.clone()),
            }
        }
        if missing.is_empty() {
            Ok(resolved)
        } else {
            Err(RuntimeConfigError::MissingCredentials(missing))
        }
    }

    fn artifact_statuses(
        &self,
        manifest: &RuntimeConfigManifest,
    ) -> Result<Vec<RuntimeArtifactStatus>, RuntimeConfigError> {
        let cached = self.store.cached_artifact_hashes()?;
        Ok(manifest
            .artifacts
            .iter()
            .map(|artifact| RuntimeArtifactStatus {
                hash: artifact.hash.clone(),
                content_type: artifact.content_type.clone(),
                byte_size: artifact.byte_size,
                source_ref: artifact.source_ref.clone(),
                resource_id: artifact.resource_id.clone(),
                display_name: artifact.display_name.clone(),
                cached: cached.contains(&artifact.hash),
            })
            .collect())
    }

    fn session_inputs_from_record(
        &self,
        current: RuntimeConfigRecord,
    ) -> Result<RuntimeConfigSessionInputs, RuntimeConfigError> {
        session_inputs_from_record(current, self)
    }
}

fn session_inputs_from_record(
    current: RuntimeConfigRecord,
    service: &RuntimeConfigService,
) -> Result<RuntimeConfigSessionInputs, RuntimeConfigError> {
    validate_materialized_record(&current)?;
    let required_credential_refs = manifest_credential_refs(&current.manifest);
    let credentials =
        service.credential_values_for_revision(&current.revision.id, &required_credential_refs)?;
    let mcp_servers = current
        .manifest
        .mcp_servers
        .iter()
        .map(|server| runtime_mcp_to_session_mcp(server, &credentials))
        .collect::<Result<Vec<_>, _>>()?;
    let artifacts = current
        .artifact_payloads
        .iter()
        .map(|artifact| (artifact.hash.as_str(), artifact))
        .collect::<HashMap<_, _>>();
    let skills = runtime_skills_to_session_skills(
        &current.manifest.skills,
        &current.manifest.mcp_servers,
        &mcp_servers,
        &artifacts,
    )?;
    let summaries = if current.manifest.mcp_binding_summaries.is_empty() {
        None
    } else {
        Some(current.manifest.mcp_binding_summaries.clone())
    };
    Ok(RuntimeConfigSessionInputs {
        mcp_servers: mcp_servers.clone(),
        mcp_binding_summaries: summaries,
        context: RuntimeConfigSessionContext {
            revision: current.revision,
            mcp_servers,
            mcp_binding_summaries: current.manifest.mcp_binding_summaries,
            skills,
        },
    })
}

fn validate_materialized_record(record: &RuntimeConfigRecord) -> Result<(), RuntimeConfigError> {
    validate_no_inline_secret_literals(&record.manifest)?;
    validate_artifact_payloads(&record.manifest, &record.artifact_payloads)?;
    Ok(())
}

fn validate_apply_input(input: &RuntimeConfigApplyInput) -> Result<(), RuntimeConfigError> {
    validate_no_inline_secret_literals(&input.manifest)?;
    let credential_values = input
        .credential_values
        .iter()
        .map(|credential| (credential.credential_ref.as_str(), credential))
        .collect::<HashMap<_, _>>();
    let missing = manifest_credential_refs(&input.manifest)
        .into_iter()
        .filter(|credential_ref| !credential_values.contains_key(credential_ref.as_str()))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(RuntimeConfigError::MissingCredentials(missing));
    }
    validate_artifact_payloads(&input.manifest, &input.artifact_payloads)?;
    Ok(())
}

fn validate_artifact_payloads(
    manifest: &RuntimeConfigManifest,
    artifact_payloads: &[RuntimeArtifactPayload],
) -> Result<(), RuntimeConfigError> {
    let payloads = artifact_payloads
        .iter()
        .map(|artifact| (artifact.hash.as_str(), artifact))
        .collect::<HashMap<_, _>>();
    for artifact in &manifest.artifacts {
        match payloads.get(artifact.hash.as_str()) {
            Some(payload) => validate_artifact_payload(artifact, payload)?,
            _ => return Err(RuntimeConfigError::MissingArtifact(artifact.hash.clone())),
        }
    }
    Ok(())
}

fn validate_artifact_payload(
    artifact: &RuntimeArtifactRef,
    payload: &RuntimeArtifactPayload,
) -> Result<(), RuntimeConfigError> {
    if payload.hash != artifact.hash
        || payload.content_type != artifact.content_type
        || payload.byte_size != artifact.byte_size
        || payload.content.as_bytes().len() as i64 != artifact.byte_size
        || runtime_artifact_hash(&payload.content) != artifact.hash
    {
        return Err(RuntimeConfigError::ArtifactIntegrityMismatch(
            artifact.hash.clone(),
        ));
    }
    Ok(())
}

fn runtime_artifact_hash(content: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
}

fn validate_no_inline_secret_literals(
    manifest: &RuntimeConfigManifest,
) -> Result<(), RuntimeConfigError> {
    for server in &manifest.mcp_servers {
        match &server.launch {
            RuntimeMcpLaunch::Http {
                url,
                headers,
                query,
            } => {
                reject_secret_literal_url(url, &server.server_name)?;
                for header in headers {
                    reject_secret_literal_named_value(
                        "header",
                        &server.server_name,
                        &header.name,
                        &header.value,
                    )?;
                }
                for query in query {
                    reject_secret_literal_named_value(
                        "query",
                        &server.server_name,
                        &query.name,
                        &query.value,
                    )?;
                }
            }
            RuntimeMcpLaunch::Stdio { env, .. } => {
                for env in env {
                    reject_secret_literal_named_value(
                        "env",
                        &server.server_name,
                        &env.name,
                        &env.value,
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn reject_secret_literal_url(
    value: &RuntimeMcpValue,
    server_name: &str,
) -> Result<(), RuntimeConfigError> {
    if let RuntimeMcpValue::Literal { value } = value {
        let lower = value.to_ascii_lowercase();
        if lower.contains("access_token=")
            || lower.contains("api_key=")
            || lower.contains("apikey=")
            || lower.contains("token=")
        {
            return Err(RuntimeConfigError::InlineSecretLiteral(format!(
                "{server_name} url"
            )));
        }
    }
    Ok(())
}

fn reject_secret_literal_named_value(
    kind: &str,
    server_name: &str,
    name: &str,
    value: &RuntimeMcpValue,
) -> Result<(), RuntimeConfigError> {
    if !is_secret_field_name(name) || !runtime_value_has_inline_literal(value) {
        return Ok(());
    }
    Err(RuntimeConfigError::InlineSecretLiteral(format!(
        "{server_name} {kind} {name}"
    )))
}

fn runtime_value_has_inline_literal(value: &RuntimeMcpValue) -> bool {
    match value {
        RuntimeMcpValue::Literal { value } => !value.is_empty(),
        RuntimeMcpValue::Credential { .. } => false,
        RuntimeMcpValue::Template { parts } => {
            let has_credential = parts
                .iter()
                .any(|part| matches!(part, RuntimeMcpTemplatePart::Credential { .. }));
            !has_credential
                && parts.iter().any(|part| {
                    matches!(part, RuntimeMcpTemplatePart::Literal { value } if !value.is_empty())
                })
        }
    }
}

fn is_secret_field_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "authorization"
        || lower == "proxy-authorization"
        || lower.contains("api-key")
        || lower.contains("apikey")
        || lower.contains("api_key")
        || lower.contains("access-token")
        || lower.contains("access_token")
        || lower.contains("auth-token")
        || lower.contains("auth_token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.ends_with("_key")
        || lower.ends_with("_token")
}

fn manifest_credential_refs(manifest: &RuntimeConfigManifest) -> Vec<String> {
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

fn collect_value_credential_refs(refs: &mut Vec<String>, value: &RuntimeMcpValue) {
    match value {
        RuntimeMcpValue::Literal { .. } => {}
        RuntimeMcpValue::Credential { credential_ref } => {
            push_unique(refs, credential_ref.clone());
        }
        RuntimeMcpValue::Template { parts } => {
            for part in parts {
                match part {
                    RuntimeMcpTemplatePart::Literal { .. } => {}
                    RuntimeMcpTemplatePart::Credential { credential_ref } => {
                        push_unique(refs, credential_ref.clone());
                    }
                }
            }
        }
    }
}

fn push_unique(refs: &mut Vec<String>, credential_ref: String) {
    if !refs.contains(&credential_ref) {
        refs.push(credential_ref);
    }
}

fn materialize_runtime_value(
    value: &RuntimeMcpValue,
    credentials: &HashMap<String, String>,
) -> Result<String, RuntimeConfigError> {
    match value {
        RuntimeMcpValue::Literal { value } => Ok(value.clone()),
        RuntimeMcpValue::Credential { credential_ref } => credentials
            .get(credential_ref)
            .cloned()
            .ok_or_else(|| RuntimeConfigError::MissingCredentials(vec![credential_ref.clone()])),
        RuntimeMcpValue::Template { parts } => {
            let mut rendered = String::new();
            for part in parts {
                match part {
                    RuntimeMcpTemplatePart::Literal { value } => rendered.push_str(value),
                    RuntimeMcpTemplatePart::Credential { credential_ref } => {
                        let value = credentials.get(credential_ref).ok_or_else(|| {
                            RuntimeConfigError::MissingCredentials(vec![credential_ref.clone()])
                        })?;
                        rendered.push_str(value);
                    }
                }
            }
            Ok(rendered)
        }
    }
}

fn runtime_mcp_to_session_mcp(
    server: &RuntimeMcpServer,
    credentials: &HashMap<String, String>,
) -> Result<SessionMcpServer, RuntimeConfigError> {
    match &server.launch {
        RuntimeMcpLaunch::Http {
            url,
            headers,
            query,
        } => Ok(SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: server.id.clone(),
            catalog_entry_id: server.catalog_entry_id.clone(),
            server_name: server.server_name.clone(),
            url: http_url_with_query(url, query, credentials)?,
            headers: headers
                .iter()
                .map(|header| {
                    Ok(SessionMcpHeader {
                        name: header.name.clone(),
                        value: materialize_runtime_value(&header.value, credentials)?,
                    })
                })
                .collect::<Result<Vec<_>, RuntimeConfigError>>()?,
        })),
        RuntimeMcpLaunch::Stdio { command, args, env } => {
            Ok(SessionMcpServer::Stdio(SessionMcpStdioServer {
                connection_id: server.id.clone(),
                catalog_entry_id: server.catalog_entry_id.clone(),
                server_name: server.server_name.clone(),
                command: materialize_runtime_value(command, credentials)?,
                args: args
                    .iter()
                    .map(|arg| materialize_runtime_value(arg, credentials))
                    .collect::<Result<Vec<_>, _>>()?,
                env: env
                    .iter()
                    .map(|env| {
                        Ok(SessionMcpEnvVar {
                            name: env.name.clone(),
                            value: materialize_runtime_value(&env.value, credentials)?,
                        })
                    })
                    .collect::<Result<Vec<_>, RuntimeConfigError>>()?,
            }))
        }
    }
}

fn http_url_with_query(
    url: &RuntimeMcpValue,
    query: &[RuntimeMcpNamedValue],
    credentials: &HashMap<String, String>,
) -> Result<String, RuntimeConfigError> {
    let raw_url = materialize_runtime_value(url, credentials)?;
    if query.is_empty() {
        return Ok(raw_url);
    }
    let mut parsed = Url::parse(&raw_url)
        .map_err(|error| RuntimeConfigError::Internal(anyhow::anyhow!(error)))?;
    {
        let mut pairs = parsed.query_pairs_mut();
        for item in query {
            pairs.append_pair(
                &item.name,
                &materialize_runtime_value(&item.value, credentials)?,
            );
        }
    }
    Ok(parsed.into())
}

fn runtime_skills_to_session_skills(
    skills: &[RuntimeSkill],
    runtime_mcp_servers: &[RuntimeMcpServer],
    mcp_servers: &[SessionMcpServer],
    artifacts: &HashMap<&str, &RuntimeArtifactPayload>,
) -> Result<Vec<RuntimeConfigSessionSkill>, RuntimeConfigError> {
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
    skills
        .iter()
        .map(|skill| runtime_skill_to_session_skill(skill, artifacts, &server_names))
        .collect::<Result<Vec<_>, _>>()
}

fn runtime_skill_to_session_skill(
    skill: &RuntimeSkill,
    artifacts: &HashMap<&str, &RuntimeArtifactPayload>,
    server_names: &BTreeMap<String, String>,
) -> Result<RuntimeConfigSessionSkill, RuntimeConfigError> {
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
            Ok(RuntimeConfigSessionSkillResource {
                resource_id: resource
                    .resource_id
                    .clone()
                    .or_else(|| resource.source_ref.clone())
                    .unwrap_or_else(|| resource.hash.clone()),
                display_name: resource.display_name.clone(),
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
    Ok(RuntimeConfigSessionSkill {
        skill_id: skill.id.clone(),
        display_name: skill.display_name.clone(),
        description: skill.description.clone(),
        instructions: instruction.content.clone(),
        resources,
        required_mcp_servers,
        credential_binding_ids: skill.credential_refs.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;
    use anyharness_contract::v1::{
        RuntimeArtifactRef, RuntimeConfigExternalScope, RuntimeConfigRevision,
        RuntimeCredentialRef, RuntimeCredentialUse, RuntimeMcpNamedValue, RuntimeMcpServer,
        RuntimeMcpTransport, RuntimeSkill, RuntimeSkillSourceKind, SessionMcpBindingOutcome,
        SessionMcpBindingSummary, SessionMcpTransport,
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
            inputs.context.skills.first().expect("skill").instructions,
            "# Use GitHub\n"
        );
        let skill = inputs.context.skills.first().expect("skill");
        let resource = skill.resources.first().expect("resource");
        assert_eq!(resource.resource_id, "triage-guide");
        assert_eq!(resource.display_name.as_deref(), Some("Triage guide"));

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
    fn apply_rejects_artifact_hash_mismatch() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let mut request = apply_request();
        request.artifact_payloads[0].content = "# Use GitLub\n".to_string();
        assert!(matches!(
            service.apply_config(request),
            Err(RuntimeConfigError::ArtifactIntegrityMismatch(hash))
                if hash == runtime_artifact_hash("# Use GitHub\n")
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
        request.manifest.mcp_servers[0].launch = RuntimeMcpLaunch::Http {
            url: RuntimeMcpValue::Literal {
                value: "https://example.test/mcp".to_string(),
            },
            headers: vec![RuntimeMcpNamedValue {
                name: "Authorization".to_string(),
                value: RuntimeMcpValue::Credential {
                    credential_ref: "mcp:secret".to_string(),
                },
            }],
            query: Vec::new(),
        };
        assert!(matches!(
            service.apply_config(request),
            Err(RuntimeConfigError::MissingCredentials(missing)) if missing == vec!["mcp:secret".to_string()]
        ));
    }

    #[test]
    fn credentials_remain_refs_in_manifest_and_materialize_from_memory_cache() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let mut request = apply_request();
        request.manifest.mcp_servers[0]
            .credential_refs
            .push(RuntimeCredentialRef {
                credential_ref: "mcp:api-key".to_string(),
                used_in: RuntimeCredentialUse::McpLaunchHeader,
                mcp_server_id: Some("mcp:1".to_string()),
                field_name: "Authorization".to_string(),
            });
        request.manifest.mcp_servers[0].launch = RuntimeMcpLaunch::Http {
            url: RuntimeMcpValue::Literal {
                value: "https://example.test/mcp".to_string(),
            },
            headers: vec![RuntimeMcpNamedValue {
                name: "Authorization".to_string(),
                value: RuntimeMcpValue::Template {
                    parts: vec![
                        RuntimeMcpTemplatePart::Literal {
                            value: "Bearer ".to_string(),
                        },
                        RuntimeMcpTemplatePart::Credential {
                            credential_ref: "mcp:api-key".to_string(),
                        },
                    ],
                },
            }],
            query: Vec::new(),
        };
        request.credential_values.push(RuntimeCredentialValue {
            credential_ref: "mcp:api-key".to_string(),
            value: "secret-token".to_string(),
        });
        service.apply_config(request.clone()).expect("apply");

        let status = service.status().expect("status");
        let manifest = status.manifest.expect("manifest");
        let manifest_json = serde_json::to_string(&manifest).expect("manifest json");
        assert!(manifest_json.contains("mcp:api-key"));
        assert!(!manifest_json.contains("secret-token"));
        let RuntimeMcpLaunch::Http { headers, .. } = &manifest.mcp_servers[0].launch else {
            panic!("expected http launch");
        };
        assert!(matches!(headers[0].value, RuntimeMcpValue::Template { .. }));

        let inputs = service
            .session_inputs_for_expected(&RuntimeConfigRevisionExpectation {
                revision_id: request.revision.id.clone(),
                sequence: Some(request.revision.sequence),
                content_hash: request.revision.content_hash.clone(),
                external_scope: request.revision.external_scope.clone(),
            })
            .expect("runtime inputs");
        let SessionMcpServer::Http(server) = inputs.mcp_servers.first().expect("mcp server") else {
            panic!("expected HTTP MCP server");
        };
        assert_eq!(server.headers[0].value, "Bearer secret-token");

        let restarted_service = RuntimeConfigService::new(service.store.clone());
        let after_restart =
            restarted_service.session_inputs_for_expected(&RuntimeConfigRevisionExpectation {
                revision_id: request.revision.id.clone(),
                sequence: Some(request.revision.sequence),
                content_hash: request.revision.content_hash.clone(),
                external_scope: request.revision.external_scope.clone(),
            });
        assert!(matches!(
            after_restart,
            Err(RuntimeConfigError::MissingCredentials(missing)) if missing == vec!["mcp:api-key".to_string()]
        ));
    }

    #[test]
    fn status_returns_artifact_metadata_without_payload_content() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        service.apply_config(apply_request()).expect("apply");

        let status = service.status().expect("status");

        assert_eq!(status.artifacts.len(), 2);
        assert!(status.artifacts.iter().all(|artifact| artifact.cached));
        let status_json = serde_json::to_string(&status).expect("status json");
        assert!(status_json.contains("\"artifacts\""));
        assert!(!status_json.contains("artifactPayloads"));
        assert!(!status_json.contains("# Use GitHub"));
        assert!(!status_json.contains("Use issues."));
    }

    #[test]
    fn runtime_http_query_values_are_included_in_session_url() {
        let db = Db::open_in_memory().expect("db");
        let service = RuntimeConfigService::new(RuntimeConfigStore::new(db));
        let mut request = apply_request();
        request.manifest.mcp_servers[0].launch = RuntimeMcpLaunch::Http {
            url: RuntimeMcpValue::Literal {
                value: "https://example.test/mcp?existing=1".to_string(),
            },
            headers: Vec::new(),
            query: vec![
                RuntimeMcpNamedValue {
                    name: "key".to_string(),
                    value: RuntimeMcpValue::Literal {
                        value: "non-secret value".to_string(),
                    },
                },
                RuntimeMcpNamedValue {
                    name: "team".to_string(),
                    value: RuntimeMcpValue::Literal {
                        value: "eng".to_string(),
                    },
                },
            ],
        };
        service.apply_config(request.clone()).expect("apply");

        let inputs = service
            .session_inputs_for_expected(&RuntimeConfigRevisionExpectation {
                revision_id: request.revision.id.clone(),
                sequence: Some(request.revision.sequence),
                content_hash: request.revision.content_hash.clone(),
                external_scope: request.revision.external_scope.clone(),
            })
            .expect("runtime inputs");

        let SessionMcpServer::Http(server) = inputs.mcp_servers.first().expect("mcp server") else {
            panic!("expected HTTP MCP server");
        };
        assert_eq!(
            server.url,
            "https://example.test/mcp?existing=1&key=non-secret+value&team=eng"
        );
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

    fn apply_request() -> RuntimeConfigApplyInput {
        let instruction_content = "# Use GitHub\n";
        let instruction_hash = runtime_artifact_hash(instruction_content);
        let guide_content = "Use issues.";
        let guide_hash = runtime_artifact_hash(guide_content);
        let artifact = RuntimeArtifactRef {
            hash: instruction_hash.clone(),
            content_type: "text/markdown".to_string(),
            byte_size: instruction_content.as_bytes().len() as i64,
            source_ref: Some("plugin:github:instructions".to_string()),
            resource_id: None,
            display_name: None,
        };
        let resource = RuntimeArtifactRef {
            hash: guide_hash.clone(),
            content_type: "text/markdown".to_string(),
            byte_size: guide_content.as_bytes().len() as i64,
            source_ref: Some("plugin:github:resource:guide".to_string()),
            resource_id: Some("triage-guide".to_string()),
            display_name: Some("Triage guide".to_string()),
        };
        RuntimeConfigApplyInput {
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
                    resources: vec![resource.clone()],
                    required_mcp_server_ids: vec!["conn-1".to_string()],
                    credential_refs: Vec::new(),
                }],
                artifacts: vec![artifact, resource],
                direct_attach_auth: None,
                warnings: Vec::new(),
            },
            artifact_payloads: vec![
                RuntimeArtifactPayload {
                    hash: instruction_hash,
                    content_type: "text/markdown".to_string(),
                    byte_size: instruction_content.as_bytes().len() as i64,
                    source_ref: Some("plugin:github:instructions".to_string()),
                    resource_id: None,
                    display_name: None,
                    content: instruction_content.to_string(),
                },
                RuntimeArtifactPayload {
                    hash: guide_hash,
                    content_type: "text/markdown".to_string(),
                    byte_size: guide_content.as_bytes().len() as i64,
                    source_ref: Some("plugin:github:resource:guide".to_string()),
                    resource_id: Some("triage-guide".to_string()),
                    display_name: Some("Triage guide".to_string()),
                    content: guide_content.to_string(),
                },
            ],
            credential_values: Vec::new(),
            source: "worker".to_string(),
        }
    }
}
