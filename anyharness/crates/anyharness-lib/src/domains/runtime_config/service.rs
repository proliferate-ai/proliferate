use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyharness_contract::v1::{
    RuntimeArtifactFulfillment, RuntimeArtifactRef, RuntimeConfigPrefetchRequest,
    RuntimeConfigPrefetchResponse, RuntimeConfigResolutionProblem, RuntimeConfigResolutionReason,
    RuntimeCredentialFulfillment, RuntimeCredentialRef, RuntimeMcpLaunch,
    RuntimeResolutionFulfillRequest, RuntimeResolutionRejectRequest, RuntimeResolutionRequest,
    RuntimeResolutionRequestKind, RuntimeSkill, RuntimeTextTemplate, RuntimeTextTemplatePart,
    SessionMcpServer, SessionPlugin, SessionPluginBundle, SessionPluginCredentialBinding,
    SessionPluginCredentialBindingStatus, SessionPluginSkill, SessionPluginSkillResource,
    TargetRuntimeConfigApplyResponse, TargetRuntimeConfigRefreshRequest,
    TargetRuntimeConfigResponse,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;

use super::store::RuntimeConfigStore;
use crate::sessions::model::{SessionMcpBindingPolicy, SessionRecord};
use crate::workspaces::model::WorkspaceRecord;

const ARTIFACT_DIR: &str = "runtime-config/artifacts";
const RUNTIME_CONFIG_PLUGIN_ID: &str = "proliferate.runtime-config";

#[derive(Debug, thiserror::Error)]
pub enum RuntimeConfigLaunchError {
    #[error("runtime config resolution required")]
    ResolutionRequired(RuntimeConfigResolutionProblem),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct RuntimeConfigService {
    store: RuntimeConfigStore,
    artifact_dir: PathBuf,
    pending: Arc<Mutex<HashMap<String, RuntimeResolutionRequest>>>,
    credentials: Arc<Mutex<HashMap<String, CachedCredential>>>,
}

#[derive(Debug, Clone)]
struct CachedCredential {
    value: String,
    expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
struct MissingCredential {
    credential_ref: RuntimeCredentialRef,
    reason: RuntimeConfigResolutionReason,
}

impl RuntimeConfigService {
    pub fn new(store: RuntimeConfigStore, runtime_home: PathBuf) -> Self {
        Self {
            store,
            artifact_dir: runtime_home.join(ARTIFACT_DIR),
            pending: Arc::new(Mutex::new(HashMap::new())),
            credentials: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_config(&self) -> anyhow::Result<TargetRuntimeConfigResponse> {
        Ok(TargetRuntimeConfigResponse {
            current: self.store.load_current()?.map(|record| record.manifest),
            pending_resolution_requests: self.list_resolution_requests(),
            artifact_cache: self.store.list_artifact_cache()?,
        })
    }

    pub fn put_config(
        &self,
        manifest: TargetRuntimeConfigRefreshRequest,
    ) -> anyhow::Result<TargetRuntimeConfigApplyResponse> {
        self.validate_manifest_is_redacted(&manifest)?;
        self.store.save_current(&manifest)?;
        self.pending
            .lock()
            .expect("runtime config pending request registry poisoned")
            .retain(|_, request| request.revision_id == manifest.revision.id);
        let missing_artifacts = self.missing_artifacts(&manifest)?;
        if !missing_artifacts.is_empty() {
            self.ensure_artifact_request(&manifest, missing_artifacts.clone());
        }
        tracing::info!(
            revision_id = %manifest.revision.id,
            content_hash = %manifest.revision.content_hash,
            source = ?manifest.source,
            mcp_server_count = manifest.mcp_servers.len(),
            skill_count = manifest.skills.len(),
            artifact_count = collect_artifacts(&manifest).len(),
            missing_artifact_count = missing_artifacts.len(),
            credential_ref_count = collect_credentials(&manifest).len(),
            "runtime config applied"
        );
        Ok(TargetRuntimeConfigApplyResponse {
            revision: manifest.revision,
            missing_artifacts,
        })
    }

    pub fn prefetch(
        &self,
        request: RuntimeConfigPrefetchRequest,
    ) -> anyhow::Result<RuntimeConfigPrefetchResponse> {
        let Some(current) = self.store.load_current()? else {
            return Err(anyhow::anyhow!("runtime config has not been applied"));
        };
        let manifest = current.manifest;
        let mut request_ids = Vec::new();
        let missing_artifacts = self.missing_artifacts(&manifest)?;
        if !missing_artifacts.is_empty() {
            request_ids.push(self.ensure_artifact_request(&manifest, missing_artifacts));
        }
        if request.include_credentials {
            let missing_credentials = self.missing_credentials(&manifest)?;
            if !missing_credentials.is_empty() {
                request_ids.push(self.ensure_credential_request(&manifest, missing_credentials));
            }
        }
        Ok(RuntimeConfigPrefetchResponse {
            revision_id: manifest.revision.id,
            content_hash: manifest.revision.content_hash,
            request_ids,
        })
    }

    pub fn list_resolution_requests(&self) -> Vec<RuntimeResolutionRequest> {
        let mut requests = self
            .pending
            .lock()
            .expect("runtime config pending request registry poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| left.request_id.cmp(&right.request_id));
        requests
    }

    pub fn fulfill_request(
        &self,
        request_id: &str,
        request: RuntimeResolutionFulfillRequest,
    ) -> anyhow::Result<RuntimeResolutionRequest> {
        let current = self
            .store
            .load_current()?
            .ok_or_else(|| anyhow::anyhow!("runtime config has not been applied"))?;
        let pending = self
            .pending
            .lock()
            .expect("runtime config pending request registry poisoned")
            .get(request_id)
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!("unknown runtime config resolution request: {request_id}")
            })?;

        for artifact in request.artifacts {
            self.fulfill_artifact(&current.manifest, artifact)?;
        }
        for credential in request.credentials {
            self.fulfill_credential(&current.manifest, credential)?;
        }

        let remaining = self.remaining_request(&pending)?;
        if let Some(remaining) = remaining {
            self.pending
                .lock()
                .expect("runtime config pending request registry poisoned")
                .insert(request_id.to_string(), remaining.clone());
            Ok(remaining)
        } else {
            let completed = self
                .pending
                .lock()
                .expect("runtime config pending request registry poisoned")
                .remove(request_id)
                .unwrap_or(pending);
            Ok(completed)
        }
    }

    pub fn reject_request(
        &self,
        request_id: &str,
        _request: RuntimeResolutionRejectRequest,
    ) -> anyhow::Result<()> {
        self.pending
            .lock()
            .expect("runtime config pending request registry poisoned")
            .remove(request_id)
            .ok_or_else(|| {
                anyhow::anyhow!("unknown runtime config resolution request: {request_id}")
            })?;
        Ok(())
    }

    pub fn session_plugin_bundle(
        &self,
        workspace: &WorkspaceRecord,
        session: &SessionRecord,
    ) -> Result<Option<SessionPluginBundle>, RuntimeConfigLaunchError> {
        if session.mcp_binding_policy == SessionMcpBindingPolicy::InternalOnly {
            tracing::debug!(
                session_id = %session.id,
                workspace_id = %workspace.id,
                "skipping runtime config for internal-only session"
            );
            return Ok(None);
        }
        let Some(current) = self.store.load_current()? else {
            tracing::debug!(
                session_id = %session.id,
                workspace_id = %workspace.id,
                "no runtime config available for session launch"
            );
            return Ok(None);
        };
        let manifest = current.manifest;
        let missing_artifacts = self.missing_artifacts(&manifest)?;
        if !missing_artifacts.is_empty() {
            let request_id = self.ensure_artifact_request(&manifest, missing_artifacts);
            tracing::info!(
                session_id = %session.id,
                workspace_id = %workspace.id,
                revision_id = %manifest.revision.id,
                request_id = %request_id,
                "runtime config launch blocked on missing artifacts"
            );
            return Err(RuntimeConfigLaunchError::ResolutionRequired(
                resolution_problem(
                    &manifest,
                    RuntimeConfigResolutionReason::MissingArtifact,
                    vec![request_id],
                    vec![RuntimeResolutionRequestKind::Artifact],
                ),
            ));
        }

        let missing_credentials = self.missing_credentials(&manifest)?;
        if !missing_credentials.is_empty() {
            let reason = missing_credentials
                .iter()
                .find(|missing| missing.reason == RuntimeConfigResolutionReason::ExpiredCredential)
                .map(|missing| missing.reason.clone())
                .unwrap_or(RuntimeConfigResolutionReason::MissingCredential);
            let request_id = self.ensure_credential_request(&manifest, missing_credentials);
            tracing::info!(
                session_id = %session.id,
                workspace_id = %workspace.id,
                revision_id = %manifest.revision.id,
                request_id = %request_id,
                reason = ?reason,
                "runtime config launch blocked on missing credentials"
            );
            return Err(RuntimeConfigLaunchError::ResolutionRequired(
                resolution_problem(
                    &manifest,
                    reason,
                    vec![request_id],
                    vec![RuntimeResolutionRequestKind::Credential],
                ),
            ));
        }

        let mcp_servers = self.render_mcp_servers(&manifest, workspace)?;
        let skills = self.render_skills(&manifest)?;
        if mcp_servers.is_empty() && skills.is_empty() && manifest.mcp_binding_summaries.is_empty()
        {
            tracing::debug!(
                session_id = %session.id,
                workspace_id = %workspace.id,
                revision_id = %manifest.revision.id,
                "runtime config produced no session plugin bundle"
            );
            return Ok(None);
        }
        tracing::info!(
            session_id = %session.id,
            workspace_id = %workspace.id,
            revision_id = %manifest.revision.id,
            mcp_server_count = mcp_servers.len(),
            skill_count = skills.len(),
            summary_count = manifest.mcp_binding_summaries.len(),
            "runtime config session plugin bundle mounted"
        );

        Ok(Some(SessionPluginBundle {
            plugins: vec![SessionPlugin {
                plugin_id: RUNTIME_CONFIG_PLUGIN_ID.to_string(),
                version: Some(manifest.revision.id.clone()),
                skills,
                mcp_servers,
                mcp_binding_summaries: manifest.mcp_binding_summaries.clone(),
                credential_bindings: credential_bindings(&manifest),
            }],
        }))
    }

    fn validate_manifest_is_redacted(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
    ) -> anyhow::Result<()> {
        for server in &manifest.mcp_servers {
            match &server.launch {
                RuntimeMcpLaunch::Http(launch) => {
                    for header in &launch.headers {
                        ensure_no_literal_secret(&header.value, "HTTP MCP header")?;
                    }
                    for param in &launch.query {
                        ensure_no_literal_secret(&param.value, "HTTP MCP query parameter")?;
                    }
                }
                RuntimeMcpLaunch::Stdio(launch) => {
                    for arg in &launch.args {
                        ensure_no_literal_secret(arg, "stdio MCP argument")?;
                    }
                    for env in &launch.env {
                        ensure_no_literal_secret(&env.value, "stdio MCP env var")?;
                    }
                }
            }
        }
        Ok(())
    }

    fn missing_artifacts(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
    ) -> anyhow::Result<Vec<RuntimeArtifactRef>> {
        let mut seen = HashSet::new();
        let mut missing = Vec::new();
        for artifact in collect_artifacts(manifest) {
            if !seen.insert(artifact.hash.clone()) {
                continue;
            }
            let Some(cache) = self.store.find_artifact_cache(&artifact.hash)? else {
                missing.push(artifact);
                continue;
            };
            let path = PathBuf::from(&cache.cache_path);
            if !path.is_file() || cache.byte_size != artifact.byte_size {
                missing.push(artifact);
            }
        }
        Ok(missing)
    }

    fn missing_credentials(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
    ) -> anyhow::Result<Vec<MissingCredential>> {
        let now = Utc::now();
        let credentials = self
            .credentials
            .lock()
            .expect("runtime config credential cache poisoned");
        let mut missing = Vec::new();
        let mut seen = HashSet::new();
        for credential_ref in collect_credentials(manifest) {
            if !seen.insert(credential_ref.credential_ref.clone()) {
                continue;
            }
            match credentials.get(&credential_cache_key(
                manifest,
                &credential_ref.credential_ref,
            )) {
                Some(cached)
                    if cached
                        .expires_at
                        .as_ref()
                        .is_some_and(|expires_at| *expires_at <= now) =>
                {
                    missing.push(MissingCredential {
                        credential_ref,
                        reason: RuntimeConfigResolutionReason::ExpiredCredential,
                    });
                }
                Some(_) => {}
                None => missing.push(MissingCredential {
                    credential_ref,
                    reason: RuntimeConfigResolutionReason::MissingCredential,
                }),
            }
        }
        Ok(missing)
    }

    fn ensure_artifact_request(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        artifacts: Vec<RuntimeArtifactRef>,
    ) -> String {
        let mut pending = self
            .pending
            .lock()
            .expect("runtime config pending request registry poisoned");
        let mut hashes = artifacts
            .iter()
            .map(|artifact| artifact.hash.as_str())
            .collect::<Vec<_>>();
        hashes.sort_unstable();
        if let Some(existing) = pending.values().find(|request| {
            request.revision_id == manifest.revision.id
                && request.kind == RuntimeResolutionRequestKind::Artifact
                && sorted_artifact_hashes(&request.artifacts) == hashes
        }) {
            return existing.request_id.clone();
        }
        let request = RuntimeResolutionRequest {
            request_id: format!("runtime-config-artifact-{}", Uuid::new_v4()),
            revision_id: manifest.revision.id.clone(),
            content_hash: manifest.revision.content_hash.clone(),
            kind: RuntimeResolutionRequestKind::Artifact,
            reason: RuntimeConfigResolutionReason::MissingArtifact,
            artifacts,
            credential_refs: Vec::new(),
        };
        let request_id = request.request_id.clone();
        pending.insert(request_id.clone(), request);
        request_id
    }

    fn ensure_credential_request(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        credentials: Vec<MissingCredential>,
    ) -> String {
        let mut pending = self
            .pending
            .lock()
            .expect("runtime config pending request registry poisoned");
        let credential_refs = credentials
            .iter()
            .map(|missing| missing.credential_ref.clone())
            .collect::<Vec<_>>();
        let reason = credentials
            .iter()
            .find(|missing| missing.reason == RuntimeConfigResolutionReason::ExpiredCredential)
            .map(|missing| missing.reason.clone())
            .unwrap_or(RuntimeConfigResolutionReason::MissingCredential);
        let mut refs = credential_refs
            .iter()
            .map(|credential| credential.credential_ref.as_str())
            .collect::<Vec<_>>();
        refs.sort_unstable();
        if let Some(existing) = pending.values().find(|request| {
            request.revision_id == manifest.revision.id
                && request.kind == RuntimeResolutionRequestKind::Credential
                && sorted_credential_refs(&request.credential_refs) == refs
        }) {
            return existing.request_id.clone();
        }
        let request = RuntimeResolutionRequest {
            request_id: format!("runtime-config-credential-{}", Uuid::new_v4()),
            revision_id: manifest.revision.id.clone(),
            content_hash: manifest.revision.content_hash.clone(),
            kind: RuntimeResolutionRequestKind::Credential,
            reason,
            artifacts: Vec::new(),
            credential_refs,
        };
        let request_id = request.request_id.clone();
        pending.insert(request_id.clone(), request);
        request_id
    }

    fn fulfill_artifact(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        fulfillment: RuntimeArtifactFulfillment,
    ) -> anyhow::Result<()> {
        let expected = collect_artifacts(manifest)
            .into_iter()
            .find(|artifact| artifact.hash == fulfillment.hash)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "artifact {} is not referenced by current runtime config",
                    fulfillment.hash
                )
            })?;
        let bytes = read_artifact_fulfillment(&fulfillment)?;
        validate_artifact_bytes(&expected, &bytes)?;
        let cache_path = self.artifact_cache_path(&expected.hash);
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&cache_path, &bytes)?;
        self.store.upsert_artifact_cache(
            &expected.hash,
            &expected.content_type,
            expected.byte_size,
            &cache_path.to_string_lossy(),
        )?;
        Ok(())
    }

    fn fulfill_credential(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        fulfillment: RuntimeCredentialFulfillment,
    ) -> anyhow::Result<()> {
        let expected = collect_credentials(manifest)
            .into_iter()
            .find(|credential| credential.credential_ref == fulfillment.credential_ref)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "credential {} is not referenced by current runtime config",
                    fulfillment.credential_ref
                )
            })?;
        let expires_at = fulfillment
            .expires_at
            .as_deref()
            .map(DateTime::parse_from_rfc3339)
            .transpose()?
            .map(|value| value.with_timezone(&Utc));
        self.credentials
            .lock()
            .expect("runtime config credential cache poisoned")
            .insert(
                credential_cache_key(manifest, &expected.credential_ref),
                CachedCredential {
                    value: fulfillment.value,
                    expires_at,
                },
            );
        Ok(())
    }

    fn remaining_request(
        &self,
        request: &RuntimeResolutionRequest,
    ) -> anyhow::Result<Option<RuntimeResolutionRequest>> {
        let Some(current) = self.store.load_current()? else {
            return Ok(None);
        };
        if current.manifest.revision.id != request.revision_id {
            return Ok(None);
        }
        match request.kind {
            RuntimeResolutionRequestKind::Artifact => {
                let remaining = self
                    .missing_artifacts(&current.manifest)?
                    .into_iter()
                    .filter(|artifact| {
                        request
                            .artifacts
                            .iter()
                            .any(|candidate| candidate.hash == artifact.hash)
                    })
                    .collect::<Vec<_>>();
                if remaining.is_empty() {
                    return Ok(None);
                }
                let mut updated = request.clone();
                updated.artifacts = remaining;
                Ok(Some(updated))
            }
            RuntimeResolutionRequestKind::Credential => {
                let missing = self.missing_credentials(&current.manifest)?;
                let remaining = missing
                    .into_iter()
                    .map(|missing| missing.credential_ref)
                    .filter(|credential| {
                        request
                            .credential_refs
                            .iter()
                            .any(|candidate| candidate.credential_ref == credential.credential_ref)
                    })
                    .collect::<Vec<_>>();
                if remaining.is_empty() {
                    return Ok(None);
                }
                let mut updated = request.clone();
                updated.credential_refs = remaining;
                Ok(Some(updated))
            }
        }
    }

    fn render_mcp_servers(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<Vec<SessionMcpServer>> {
        manifest
            .mcp_servers
            .iter()
            .map(|server| {
                Ok(match &server.launch {
                    RuntimeMcpLaunch::Http(launch) => {
                        let mut url = Url::parse(&launch.base_url)?;
                        if !launch.query.is_empty() {
                            let mut pairs = url.query_pairs_mut();
                            for param in &launch.query {
                                pairs.append_pair(
                                    &param.name,
                                    &self.render_template(manifest, &param.value, workspace)?,
                                );
                            }
                        }
                        SessionMcpServer::Http(anyharness_contract::v1::SessionMcpHttpServer {
                            connection_id: server.connection_id.clone(),
                            catalog_entry_id: server.catalog_entry_id.clone(),
                            server_name: server.server_name.clone(),
                            url: url.to_string(),
                            headers: launch
                                .headers
                                .iter()
                                .map(|header| {
                                    Ok(anyharness_contract::v1::SessionMcpHeader {
                                        name: header.name.clone(),
                                        value: self.render_template(
                                            manifest,
                                            &header.value,
                                            workspace,
                                        )?,
                                    })
                                })
                                .collect::<anyhow::Result<Vec<_>>>()?,
                        })
                    }
                    RuntimeMcpLaunch::Stdio(launch) => {
                        SessionMcpServer::Stdio(anyharness_contract::v1::SessionMcpStdioServer {
                            connection_id: server.connection_id.clone(),
                            catalog_entry_id: server.catalog_entry_id.clone(),
                            server_name: server.server_name.clone(),
                            command: launch.command.clone(),
                            args: launch
                                .args
                                .iter()
                                .map(|arg| self.render_template(manifest, arg, workspace))
                                .collect::<anyhow::Result<Vec<_>>>()?,
                            env: launch
                                .env
                                .iter()
                                .map(|env| {
                                    Ok(anyharness_contract::v1::SessionMcpEnvVar {
                                        name: env.name.clone(),
                                        value: self
                                            .render_template(manifest, &env.value, workspace)?,
                                    })
                                })
                                .collect::<anyhow::Result<Vec<_>>>()?,
                        })
                    }
                })
            })
            .collect()
    }

    fn render_template(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
        template: &RuntimeTextTemplate,
        workspace: &WorkspaceRecord,
    ) -> anyhow::Result<String> {
        let credentials = self
            .credentials
            .lock()
            .expect("runtime config credential cache poisoned");
        let mut rendered = String::new();
        for part in &template.parts {
            match part {
                RuntimeTextTemplatePart::Literal { value } => rendered.push_str(value),
                RuntimeTextTemplatePart::Credential { credential_ref } => {
                    let key = credential_cache_key(manifest, credential_ref);
                    let value = credentials.get(&key).ok_or_else(|| {
                        anyhow::anyhow!("credential not fulfilled: {credential_ref}")
                    })?;
                    rendered.push_str(&value.value);
                }
                RuntimeTextTemplatePart::WorkspacePath => rendered.push_str(&workspace.path),
            }
        }
        Ok(rendered)
    }

    fn render_skills(
        &self,
        manifest: &TargetRuntimeConfigRefreshRequest,
    ) -> anyhow::Result<Vec<SessionPluginSkill>> {
        manifest
            .skills
            .iter()
            .map(|skill| self.render_skill(skill))
            .collect()
    }

    fn render_skill(&self, skill: &RuntimeSkill) -> anyhow::Result<SessionPluginSkill> {
        let instructions = self.read_cached_artifact(&skill.instruction_artifact)?;
        let resources = skill
            .resources
            .iter()
            .map(|resource| {
                Ok(SessionPluginSkillResource {
                    resource_id: resource.resource_id.clone(),
                    display_name: resource.display_name.clone(),
                    content_type: resource.artifact.content_type.clone(),
                    content: self.read_cached_artifact(&resource.artifact)?,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(SessionPluginSkill {
            skill_id: skill.id.clone(),
            display_name: skill.display_name.clone(),
            description: skill.description.clone(),
            instructions,
            resources,
            required_mcp_servers: skill.required_mcp_server_ids.clone(),
            credential_binding_ids: skill.credential_refs.clone(),
        })
    }

    fn read_cached_artifact(&self, artifact: &RuntimeArtifactRef) -> anyhow::Result<String> {
        let cache = self
            .store
            .find_artifact_cache(&artifact.hash)?
            .ok_or_else(|| anyhow::anyhow!("artifact not fulfilled: {}", artifact.hash))?;
        self.store.touch_artifact_cache(&artifact.hash)?;
        let bytes = fs::read(&cache.cache_path)?;
        validate_artifact_bytes(artifact, &bytes)?;
        Ok(String::from_utf8(bytes)?)
    }

    fn artifact_cache_path(&self, hash: &str) -> PathBuf {
        let prefix = hash.get(0..2).unwrap_or("xx");
        self.artifact_dir.join(prefix).join(hash)
    }
}

fn collect_artifacts(manifest: &TargetRuntimeConfigRefreshRequest) -> Vec<RuntimeArtifactRef> {
    let mut artifacts = manifest.artifacts.clone();
    for skill in &manifest.skills {
        artifacts.push(skill.instruction_artifact.clone());
        artifacts.extend(
            skill
                .resources
                .iter()
                .map(|resource| resource.artifact.clone()),
        );
    }
    artifacts
}

fn collect_credentials(manifest: &TargetRuntimeConfigRefreshRequest) -> Vec<RuntimeCredentialRef> {
    let mut credentials = Vec::new();
    for server in &manifest.mcp_servers {
        credentials.extend(server.credential_refs.clone());
    }
    let by_ref = credentials
        .iter()
        .map(|credential| (credential.credential_ref.clone(), credential.clone()))
        .collect::<HashMap<_, _>>();
    for skill in &manifest.skills {
        for credential_ref in &skill.credential_refs {
            if let Some(credential) = by_ref.get(credential_ref) {
                credentials.push(credential.clone());
            }
        }
    }
    credentials
}

fn credential_bindings(
    manifest: &TargetRuntimeConfigRefreshRequest,
) -> Vec<SessionPluginCredentialBinding> {
    let mut seen = HashSet::new();
    collect_credentials(manifest)
        .into_iter()
        .filter(|credential| seen.insert(credential.credential_ref.clone()))
        .map(|credential| SessionPluginCredentialBinding {
            id: credential.credential_ref,
            display_name: credential.display_name,
            status: SessionPluginCredentialBindingStatus::Ready,
        })
        .collect()
}

fn credential_cache_key(
    manifest: &TargetRuntimeConfigRefreshRequest,
    credential_ref: &str,
) -> String {
    format!("{}:{credential_ref}", manifest.revision.id)
}

fn resolution_problem(
    manifest: &TargetRuntimeConfigRefreshRequest,
    reason: RuntimeConfigResolutionReason,
    request_ids: Vec<String>,
    request_kinds: Vec<RuntimeResolutionRequestKind>,
) -> RuntimeConfigResolutionProblem {
    RuntimeConfigResolutionProblem {
        revision_id: manifest.revision.id.clone(),
        content_hash: manifest.revision.content_hash.clone(),
        request_ids,
        request_kinds,
        reason,
        retry_after_ms: None,
    }
}

fn ensure_no_literal_secret(template: &RuntimeTextTemplate, field: &str) -> anyhow::Result<()> {
    if template
        .parts
        .iter()
        .any(|part| matches!(part, RuntimeTextTemplatePart::Credential { .. }))
    {
        return Ok(());
    }
    let literal = template
        .parts
        .iter()
        .filter_map(|part| match part {
            RuntimeTextTemplatePart::Literal { value } => Some(value.as_str()),
            _ => None,
        })
        .collect::<String>();
    let lower = literal.to_ascii_lowercase();
    if lower.contains("bearer ")
        || lower.contains("token=")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("secret")
    {
        return Err(anyhow::anyhow!(
            "{field} appears to contain a concrete secret; use a credential template part"
        ));
    }
    Ok(())
}

fn sorted_artifact_hashes(artifacts: &[RuntimeArtifactRef]) -> Vec<&str> {
    let mut hashes = artifacts
        .iter()
        .map(|artifact| artifact.hash.as_str())
        .collect::<Vec<_>>();
    hashes.sort_unstable();
    hashes
}

fn sorted_credential_refs(credentials: &[RuntimeCredentialRef]) -> Vec<&str> {
    let mut refs = credentials
        .iter()
        .map(|credential| credential.credential_ref.as_str())
        .collect::<Vec<_>>();
    refs.sort_unstable();
    refs
}

fn read_artifact_fulfillment(fulfillment: &RuntimeArtifactFulfillment) -> anyhow::Result<Vec<u8>> {
    match (
        fulfillment.content_base64.as_deref(),
        fulfillment.local_path.as_deref(),
    ) {
        (Some(_), Some(_)) => Err(anyhow::anyhow!(
            "artifact fulfillment must provide contentBase64 or localPath, not both"
        )),
        (Some(encoded), None) => STANDARD.decode(encoded).map_err(Into::into),
        (None, Some(path)) => {
            let path = PathBuf::from(path);
            validate_local_path(&path)?;
            fs::read(path).map_err(Into::into)
        }
        (None, None) => Err(anyhow::anyhow!(
            "artifact fulfillment must provide contentBase64 or localPath"
        )),
    }
}

fn validate_local_path(path: &Path) -> anyhow::Result<()> {
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(anyhow::anyhow!(
            "artifact localPath must not contain parent traversal"
        ));
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(anyhow::anyhow!("artifact localPath must not be a symlink"));
    }
    if !metadata.is_file() {
        return Err(anyhow::anyhow!("artifact localPath must point to a file"));
    }
    reject_symlink_ancestors(path)?;
    Ok(())
}

fn reject_symlink_ancestors(path: &Path) -> anyhow::Result<()> {
    let mut cursor = PathBuf::new();
    for component in path.components() {
        cursor.push(component.as_os_str());
        if cursor == path {
            break;
        }
        if let Ok(metadata) = fs::symlink_metadata(&cursor) {
            if metadata.file_type().is_symlink() {
                return Err(anyhow::anyhow!(
                    "artifact localPath must not traverse symlink ancestors"
                ));
            }
        }
    }
    Ok(())
}

fn validate_artifact_bytes(artifact: &RuntimeArtifactRef, bytes: &[u8]) -> anyhow::Result<()> {
    let actual_size = u64::try_from(bytes.len())?;
    if actual_size != artifact.byte_size {
        return Err(anyhow::anyhow!(
            "artifact {} byte size mismatch: expected {}, got {}",
            artifact.hash,
            artifact.byte_size,
            actual_size
        ));
    }
    let hash = Sha256::digest(bytes);
    let actual_hash = format!("{hash:x}");
    if actual_hash != artifact.hash {
        return Err(anyhow::anyhow!(
            "artifact hash mismatch: expected {}, got {}",
            artifact.hash,
            actual_hash
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use anyharness_contract::v1::{
        RuntimeConfigOwnerScope, RuntimeConfigSource, RuntimeCredentialKind, RuntimeMcpEnvVar,
        RuntimeMcpHeader, RuntimeMcpHttpLaunch, RuntimeMcpQueryParam, RuntimeMcpServer,
        RuntimeMcpStdioLaunch, RuntimeResolutionFulfillRequest, SessionMcpBindingOutcome,
        SessionMcpBindingSummary, SessionMcpTransport, TargetRuntimeConfigRevision,
    };

    use super::*;
    use crate::persistence::Db;

    #[test]
    fn runtime_config_prefetches_credentials_and_renders_workspace_templates() {
        let temp = TempDirGuard::new("runtime-config-render");
        let service = service(temp.path());
        let manifest = manifest();

        let response = service.put_config(manifest).expect("put config");
        assert!(response.missing_artifacts.is_empty());

        let prefetch = service
            .prefetch(RuntimeConfigPrefetchRequest {
                include_credentials: true,
            })
            .expect("prefetch");
        assert_eq!(prefetch.request_ids.len(), 1);
        let request_id = prefetch.request_ids[0].clone();

        let launch_error = service
            .session_plugin_bundle(
                &workspace_record(),
                &session_record(SessionMcpBindingPolicy::InheritWorkspace),
            )
            .expect_err("credential gap should block launch");
        match launch_error {
            RuntimeConfigLaunchError::ResolutionRequired(problem) => {
                assert_eq!(
                    problem.reason,
                    RuntimeConfigResolutionReason::MissingCredential
                );
                assert_eq!(problem.request_ids, vec![request_id.clone()]);
            }
            RuntimeConfigLaunchError::Internal(error) => {
                panic!("unexpected internal error: {error}")
            }
        }

        service
            .fulfill_request(
                &request_id,
                RuntimeResolutionFulfillRequest {
                    artifacts: Vec::new(),
                    credentials: vec![RuntimeCredentialFulfillment {
                        credential_ref: "conn_docs:header:authorization:0".to_string(),
                        value: "secret-token".to_string(),
                        expires_at: None,
                        redacted_summary: Some("ready".to_string()),
                    }],
                },
            )
            .expect("fulfill credential");

        let bundle = service
            .session_plugin_bundle(
                &workspace_record(),
                &session_record(SessionMcpBindingPolicy::InheritWorkspace),
            )
            .expect("session bundle")
            .expect("bundle");
        let plugin = bundle.plugins.first().expect("plugin");
        assert_eq!(plugin.version.as_deref(), Some("runtime-revision-1"));
        assert_eq!(plugin.credential_bindings.len(), 1);
        assert_eq!(plugin.mcp_servers.len(), 2);
        match &plugin.mcp_servers[0] {
            SessionMcpServer::Http(server) => {
                assert_eq!(server.url, "https://docs.example.com/mcp?mode=read");
                assert_eq!(server.headers[0].value, "Bearer secret-token");
            }
            other => panic!("unexpected server: {other:?}"),
        }
        match &plugin.mcp_servers[1] {
            SessionMcpServer::Stdio(server) => {
                assert_eq!(server.args, vec!["/tmp/workspace".to_string()]);
                assert_eq!(server.env[0].value, "/tmp/workspace");
            }
            other => panic!("unexpected server: {other:?}"),
        }
    }

    #[test]
    fn runtime_config_internal_only_sessions_skip_target_manifest() {
        let temp = TempDirGuard::new("runtime-config-internal-only");
        let service = service(temp.path());
        service.put_config(manifest()).expect("put config");

        let bundle = service
            .session_plugin_bundle(
                &workspace_record(),
                &session_record(SessionMcpBindingPolicy::InternalOnly),
            )
            .expect("session bundle");

        assert!(bundle.is_none());
        assert!(service.list_resolution_requests().is_empty());
    }

    fn service(runtime_home: &Path) -> RuntimeConfigService {
        let db = Db::open_in_memory().expect("db");
        RuntimeConfigService::new(RuntimeConfigStore::new(db), runtime_home.to_path_buf())
    }

    fn manifest() -> TargetRuntimeConfigRefreshRequest {
        TargetRuntimeConfigRefreshRequest {
            revision: TargetRuntimeConfigRevision {
                id: "runtime-revision-1".to_string(),
                sequence: Some(1),
                generated_at: "2026-05-17T00:00:00Z".to_string(),
                content_hash: "runtime-hash-1".to_string(),
                owner_scope: RuntimeConfigOwnerScope::Personal,
                external_target_id: Some("target-1".to_string()),
            },
            mcp_servers: vec![
                RuntimeMcpServer {
                    id: "conn_docs:docs".to_string(),
                    connection_id: "conn_docs".to_string(),
                    catalog_entry_id: Some("docs".to_string()),
                    server_name: "docs".to_string(),
                    launch: RuntimeMcpLaunch::Http(RuntimeMcpHttpLaunch {
                        base_url: "https://docs.example.com/mcp".to_string(),
                        query: vec![RuntimeMcpQueryParam {
                            name: "mode".to_string(),
                            value: literal_template("read"),
                        }],
                        headers: vec![RuntimeMcpHeader {
                            name: "Authorization".to_string(),
                            value: RuntimeTextTemplate {
                                parts: vec![
                                    RuntimeTextTemplatePart::Literal {
                                        value: "Bearer ".to_string(),
                                    },
                                    RuntimeTextTemplatePart::Credential {
                                        credential_ref: "conn_docs:header:authorization:0"
                                            .to_string(),
                                    },
                                ],
                            },
                        }],
                    }),
                    credential_refs: vec![RuntimeCredentialRef {
                        credential_ref: "conn_docs:header:authorization:0".to_string(),
                        kind: RuntimeCredentialKind::OauthAccessToken,
                        connection_id: "conn_docs".to_string(),
                        catalog_entry_id: Some("docs".to_string()),
                        field_id: Some("header:authorization:0".to_string()),
                        auth_version: Some(1),
                        catalog_entry_version: Some(1),
                        display_name: Some("Authorization".to_string()),
                    }],
                },
                RuntimeMcpServer {
                    id: "conn_filesystem:filesystem".to_string(),
                    connection_id: "conn_filesystem".to_string(),
                    catalog_entry_id: Some("filesystem".to_string()),
                    server_name: "filesystem".to_string(),
                    launch: RuntimeMcpLaunch::Stdio(RuntimeMcpStdioLaunch {
                        command: "npx".to_string(),
                        args: vec![workspace_path_template()],
                        env: vec![RuntimeMcpEnvVar {
                            name: "WORKSPACE".to_string(),
                            value: workspace_path_template(),
                        }],
                    }),
                    credential_refs: Vec::new(),
                },
            ],
            mcp_binding_summaries: vec![SessionMcpBindingSummary {
                id: "conn_docs".to_string(),
                server_name: "docs".to_string(),
                display_name: Some("Docs".to_string()),
                transport: SessionMcpTransport::Http,
                outcome: SessionMcpBindingOutcome::Applied,
                reason: None,
            }],
            skills: Vec::new(),
            artifacts: Vec::new(),
            source: RuntimeConfigSource::Test,
        }
    }

    fn literal_template(value: &str) -> RuntimeTextTemplate {
        RuntimeTextTemplate {
            parts: vec![RuntimeTextTemplatePart::Literal {
                value: value.to_string(),
            }],
        }
    }

    fn workspace_path_template() -> RuntimeTextTemplate {
        RuntimeTextTemplate {
            parts: vec![RuntimeTextTemplatePart::WorkspacePath],
        }
    }

    fn workspace_record() -> WorkspaceRecord {
        WorkspaceRecord {
            id: "workspace-1".to_string(),
            kind: "repo".to_string(),
            repo_root_id: None,
            path: "/tmp/workspace".to_string(),
            surface: "local".to_string(),
            source_repo_root_path: "/tmp/workspace".to_string(),
            source_workspace_id: None,
            git_provider: None,
            git_owner: None,
            git_repo_name: None,
            original_branch: None,
            current_branch: None,
            display_name: None,
            origin: None,
            creator_context: None,
            lifecycle_state: "active".to_string(),
            cleanup_state: "none".to_string(),
            cleanup_operation: None,
            cleanup_error_message: None,
            cleanup_failed_at: None,
            cleanup_attempted_at: None,
            created_at: "2026-05-17T00:00:00Z".to_string(),
            updated_at: "2026-05-17T00:00:00Z".to_string(),
        }
    }

    fn session_record(policy: SessionMcpBindingPolicy) -> SessionRecord {
        SessionRecord {
            id: "session-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-05-17T00:00:00Z".to_string(),
            updated_at: "2026-05-17T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: policy,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
        }
    }

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(prefix: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "{prefix}-{}-{}",
                std::process::id(),
                Uuid::new_v4()
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
