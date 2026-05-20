pub mod agent_auth;
pub mod env;
pub mod files;
pub mod git;
pub mod git_identity;
pub mod mcp;
pub mod repo_checkout;
pub mod runtime_config;
pub mod skills;

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::error::WorkerError;

use files::{decode_base64, expand_home, materialization_error, safe_join, write_file};
use runtime_config::{RuntimeConfigMaterializationFragment, RuntimeConfigProjectionSummary};

const CLAUDE_ALLOWED_AUTH_FILES: &[&str] = &[".claude/.credentials.json", ".claude.json"];
const CODEX_ALLOWED_AUTH_FILES: &[&str] = &[".codex/auth.json"];
const GEMINI_ALLOWED_AUTH_FILES: &[&str] = &[".gemini/oauth_creds.json", ".gemini/settings.json"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterializeEnvironmentPayload {
    pub target_config_id: String,
    pub config_version: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetConfigMaterializationPlan {
    pub target_config_id: String,
    pub target_id: String,
    pub config_version: i64,
    pub workspace_root: String,
    pub repo: TargetConfigRepo,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
    #[serde(default)]
    pub tracked_files: Vec<TargetConfigTrackedFile>,
    #[serde(default)]
    pub setup_script: String,
    #[serde(default)]
    pub run_command: String,
    pub git_credential: Option<GitCredential>,
    #[serde(default)]
    pub agent_credentials: BTreeMap<String, Value>,
    pub runtime_config: Option<RuntimeConfigMaterializationFragment>,
    pub mcp: Option<Value>,
    #[serde(default)]
    pub skills: Vec<Value>,
    #[serde(default)]
    pub readiness_requirements: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct TargetConfigRepo {
    pub provider: String,
    pub owner: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetConfigTrackedFile {
    pub relative_path: String,
    pub content: String,
    pub content_sha256: String,
    pub byte_size: u64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCredential {
    pub provider: String,
    pub access_token: String,
    pub username: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializationOutcome {
    pub target_config_id: String,
    pub config_version: i64,
    pub workspace_root: String,
    pub env_var_count: usize,
    pub tracked_file_count: usize,
    pub credential_file_count: usize,
    pub git_configured: bool,
    pub mcp_configured: bool,
    pub skills_configured: bool,
    pub runtime_config: Option<RuntimeConfigProjectionSummary>,
}

pub fn parse_materialize_environment_payload(
    payload: &Value,
) -> Result<MaterializeEnvironmentPayload, WorkerError> {
    serde_json::from_value(payload.clone()).map_err(|error| {
        materialization_error(format!("invalid materialize_environment payload: {error}"))
    })
}

pub fn materialize_plan(
    allowed_root: Option<&Path>,
    expected_config_version: i64,
    plan: &TargetConfigMaterializationPlan,
) -> Result<MaterializationOutcome, WorkerError> {
    if plan.config_version != expected_config_version {
        return Err(materialization_error(format!(
            "target config version mismatch: expected {expected_config_version}, got {}",
            plan.config_version
        )));
    }
    let workspace_root = prepare_workspace_root(allowed_root, &plan.workspace_root)?;
    let env_var_count =
        env::write_env_file(&workspace_root, &plan.env_vars, &plan.agent_credentials)?;
    let credential_file_count =
        write_agent_credential_files(&workspace_root, &plan.agent_credentials)?;
    write_repo_files(&workspace_root, &plan.tracked_files)?;
    let git_configured =
        git::write_git_materialization(&workspace_root, plan.git_credential.as_ref())?;
    let runtime_config = runtime_config::write_runtime_config_projection(
        &workspace_root,
        plan.runtime_config.as_ref(),
    )?;
    let (mcp_configured, skills_configured) = if runtime_config.is_some() {
        let summary = runtime_config
            .as_ref()
            .expect("runtime config summary exists");
        (summary.mcp_server_count > 0, summary.skill_count > 0)
    } else {
        (
            mcp::write_mcp_materialization(&workspace_root, plan.mcp.as_ref())?,
            skills::write_skill_refs(&workspace_root, &plan.skills)?,
        )
    };
    write_manifest(&workspace_root, plan)?;
    Ok(MaterializationOutcome {
        target_config_id: plan.target_config_id.clone(),
        config_version: plan.config_version,
        workspace_root: workspace_root.to_string_lossy().to_string(),
        env_var_count,
        tracked_file_count: plan.tracked_files.len(),
        credential_file_count,
        git_configured,
        mcp_configured,
        skills_configured,
        runtime_config,
    })
}

fn write_repo_files(
    workspace_root: &Path,
    tracked_files: &[TargetConfigTrackedFile],
) -> Result<(), WorkerError> {
    for file in tracked_files {
        let path = safe_join(workspace_root, &file.relative_path)?;
        let bytes = file.content.as_bytes();
        if bytes.len() as u64 != file.byte_size {
            return Err(materialization_error(format!(
                "tracked file byte size mismatch for {}",
                file.relative_path
            )));
        }
        let actual_hash = format!("{:x}", Sha256::digest(bytes));
        if actual_hash != file.content_sha256 {
            return Err(materialization_error(format!(
                "tracked file content hash mismatch for {}",
                file.relative_path
            )));
        }
        write_file(&path, bytes, true)?;
    }
    Ok(())
}

fn write_agent_credential_files(
    workspace_root: &Path,
    agent_credentials: &BTreeMap<String, Value>,
) -> Result<usize, WorkerError> {
    let mut written = 0;
    let home = dirs::home_dir().unwrap_or_else(|| workspace_root.to_path_buf());
    for (provider, payload) in agent_credentials {
        let Some(mode) = payload
            .get("authMode")
            .or_else(|| payload.get("auth_mode"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if mode != "file" {
            continue;
        }
        let Some(files) = payload.get("files") else {
            continue;
        };
        if let Some(file_map) = files.as_object() {
            for (relative_path, decoded_content) in file_map {
                require_allowed_agent_auth_file(provider, relative_path)?;
                let Some(decoded_content) = decoded_content.as_str() else {
                    return Err(materialization_error(format!(
                        "credential file payload for {provider}:{relative_path} must be a string"
                    )));
                };
                let destination = safe_join(&home, relative_path)?;
                write_file(&destination, decoded_content.as_bytes(), true)?;
                written += 1;
            }
            continue;
        }
        if let Some(file_array) = files.as_array() {
            for item in file_array {
                let Some(relative_path) = item
                    .get("relativePath")
                    .or_else(|| item.get("relative_path"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                require_allowed_agent_auth_file(provider, relative_path)?;
                let Some(content_base64) = item
                    .get("contentBase64")
                    .or_else(|| item.get("content_base64"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                let destination = safe_join(&home, relative_path)?;
                let bytes = decode_base64(content_base64)?;
                write_file(&destination, &bytes, true)?;
                written += 1;
            }
            continue;
        }
        return Err(materialization_error(format!(
            "credential files for provider {provider} must be an object or array"
        )));
    }
    Ok(written)
}

fn write_manifest(
    workspace_root: &Path,
    plan: &TargetConfigMaterializationPlan,
) -> Result<(), WorkerError> {
    let manifest = json!({
        "targetConfigId": plan.target_config_id,
        "targetId": plan.target_id,
        "configVersion": plan.config_version,
        "repo": {
            "provider": plan.repo.provider,
            "owner": plan.repo.owner,
            "name": plan.repo.name,
        },
        "setupScript": plan.setup_script,
        "runCommand": plan.run_command,
        "runtimeConfig": plan.runtime_config.as_ref().map(|fragment| fragment.summary()),
        "readinessRequirements": plan.readiness_requirements,
    });
    let contents = serde_json::to_vec_pretty(&manifest)?;
    let path = safe_join(workspace_root, ".proliferate/target-config.json")?;
    write_file(&path, &contents, true)
}

fn prepare_workspace_root(
    allowed_root: Option<&Path>,
    workspace_root: &str,
) -> Result<PathBuf, WorkerError> {
    let allowed_root = allowed_root
        .map(Path::to_path_buf)
        .unwrap_or_else(default_materialization_root);
    let allowed_root = expand_path(&allowed_root);
    std::fs::create_dir_all(&allowed_root).map_err(|source| WorkerError::CreateParent {
        path: allowed_root.clone(),
        source,
    })?;
    let allowed_root = allowed_root
        .canonicalize()
        .map_err(|source| WorkerError::CreateParent {
            path: allowed_root.clone(),
            source,
        })?;

    let workspace_root = expand_home(workspace_root);
    std::fs::create_dir_all(&workspace_root).map_err(|source| WorkerError::CreateParent {
        path: workspace_root.clone(),
        source,
    })?;
    let workspace_root =
        workspace_root
            .canonicalize()
            .map_err(|source| WorkerError::CreateParent {
                path: workspace_root.clone(),
                source,
            })?;
    if !workspace_root.starts_with(&allowed_root) {
        return Err(materialization_error(format!(
            "workspace root {} is outside materialization root {}",
            workspace_root.display(),
            allowed_root.display()
        )));
    }
    Ok(workspace_root)
}

fn default_materialization_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("proliferate-workspaces")
}

fn expand_path(path: &Path) -> PathBuf {
    path.to_str()
        .map(expand_home)
        .unwrap_or_else(|| path.to_path_buf())
}

fn require_allowed_agent_auth_file(provider: &str, relative_path: &str) -> Result<(), WorkerError> {
    let allowed = match provider {
        "claude" => CLAUDE_ALLOWED_AUTH_FILES,
        "codex" => CODEX_ALLOWED_AUTH_FILES,
        "gemini" => GEMINI_ALLOWED_AUTH_FILES,
        _ => {
            return Err(materialization_error(format!(
                "unsupported file credential provider: {provider}"
            )));
        }
    };
    if allowed.contains(&relative_path) {
        return Ok(());
    }
    Err(materialization_error(format!(
        "credential file path {relative_path} is not allowed for provider {provider}"
    )))
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs};

    use anyharness_contract::v1::RuntimeConfigManifest;
    use serde_json::json;
    use sha2::{Digest, Sha256};

    use super::{
        materialize_plan, parse_materialize_environment_payload, GitCredential,
        TargetConfigMaterializationPlan, TargetConfigRepo, TargetConfigTrackedFile,
    };

    #[test]
    fn materializes_repo_env_git_mcp_and_files() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-materialization-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let mut env_vars = BTreeMap::new();
        env_vars.insert("APP_ENV".to_string(), "test".to_string());
        let tracked_file_content = "HELLO=world\n";
        let plan = TargetConfigMaterializationPlan {
            target_config_id: "cfg_1".to_string(),
            target_id: "target_1".to_string(),
            config_version: 2,
            workspace_root: root.to_string_lossy().to_string(),
            repo: TargetConfigRepo {
                provider: "github".to_string(),
                owner: "proliferate-ai".to_string(),
                name: "proliferate".to_string(),
            },
            env_vars,
            tracked_files: vec![TargetConfigTrackedFile {
                relative_path: ".env.example".to_string(),
                content: tracked_file_content.to_string(),
                content_sha256: format!("{:x}", Sha256::digest(tracked_file_content.as_bytes())),
                byte_size: tracked_file_content.len() as u64,
            }],
            setup_script: "".to_string(),
            run_command: "".to_string(),
            git_credential: Some(GitCredential {
                provider: "github".to_string(),
                access_token: "gh-token".to_string(),
                username: Some("Pablo".to_string()),
                email: Some("pablo@example.com".to_string()),
            }),
            agent_credentials: BTreeMap::new(),
            runtime_config: None,
            mcp: Some(json!({"mcpServers": []})),
            skills: vec![],
            readiness_requirements: BTreeMap::new(),
        };

        let outcome = materialize_plan(Some(&root), 2, &plan).expect("materialization succeeds");

        assert_eq!(outcome.env_var_count, 1);
        assert_eq!(
            fs::read_to_string(root.join(".env.example")).unwrap(),
            "HELLO=world\n"
        );
        assert!(
            fs::read_to_string(root.join(".proliferate/env/session.env"))
                .unwrap()
                .contains("APP_ENV")
        );
        assert!(root.join(".proliferate/git/gitconfig").exists());
        assert!(root.join(".proliferate/mcp/materialization.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unknown_materialize_environment_payload_fields() {
        let payload = json!({
            "targetConfigId": "cfg_1",
            "configVersion": 2,
            "unexpected": true,
        });
        assert!(parse_materialize_environment_payload(&payload).is_err());
    }

    #[test]
    fn runtime_config_fragment_skips_legacy_mcp_and_skill_files() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-runtime-config-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let plan = TargetConfigMaterializationPlan {
            target_config_id: "cfg_1".to_string(),
            target_id: "target_1".to_string(),
            config_version: 3,
            workspace_root: root.to_string_lossy().to_string(),
            repo: TargetConfigRepo {
                provider: "github".to_string(),
                owner: "proliferate-ai".to_string(),
                name: "proliferate".to_string(),
            },
            env_vars: BTreeMap::new(),
            tracked_files: vec![],
            setup_script: "".to_string(),
            run_command: "".to_string(),
            git_credential: None,
            agent_credentials: BTreeMap::new(),
            runtime_config: Some(
                super::runtime_config::RuntimeConfigMaterializationFragment {
                    revision_id: "rev_1".to_string(),
                    sandbox_profile_id: "profile_1".to_string(),
                    target_id: Some("target_1".to_string()),
                    sequence: 7,
                    content_hash: "sha256:test".to_string(),
                    manifest: serde_json::from_value::<RuntimeConfigManifest>(json!({
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
                            "requiredMcpServerIds": [],
                            "credentialRefs": []
                        }],
                        "artifacts": [],
                        "warnings": []
                    }))
                    .expect("runtime config manifest"),
                    artifact_refs: vec![],
                    credential_refs: vec![],
                },
            ),
            mcp: Some(json!({"legacy": true})),
            skills: vec![json!({"legacy": true})],
            readiness_requirements: BTreeMap::new(),
        };

        let outcome = materialize_plan(Some(&root), 3, &plan).expect("materialization succeeds");

        assert!(outcome.mcp_configured);
        assert!(outcome.skills_configured);
        assert_eq!(
            outcome
                .runtime_config
                .as_ref()
                .map(|summary| summary.sequence),
            Some(7)
        );
        assert!(root
            .join(".proliferate/runtime-config/manifest.json")
            .exists());
        assert!(!root.join(".proliferate/mcp/materialization.json").exists());
        assert!(!root.join(".proliferate/skills/refs.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_tracked_files_that_escape_workspace() {
        let root = std::env::temp_dir().join(format!(
            "proliferate-worker-materialization-escape-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let file_content = "SECRET=1\n";
        let plan = TargetConfigMaterializationPlan {
            target_config_id: "cfg_1".to_string(),
            target_id: "target_1".to_string(),
            config_version: 2,
            workspace_root: root.to_string_lossy().to_string(),
            repo: TargetConfigRepo {
                provider: "github".to_string(),
                owner: "proliferate-ai".to_string(),
                name: "proliferate".to_string(),
            },
            env_vars: BTreeMap::new(),
            tracked_files: vec![TargetConfigTrackedFile {
                relative_path: "../secret.env".to_string(),
                content: file_content.to_string(),
                content_sha256: format!("{:x}", Sha256::digest(file_content.as_bytes())),
                byte_size: file_content.len() as u64,
            }],
            setup_script: "".to_string(),
            run_command: "".to_string(),
            git_credential: None,
            agent_credentials: BTreeMap::new(),
            runtime_config: None,
            mcp: None,
            skills: vec![],
            readiness_requirements: BTreeMap::new(),
        };

        assert!(materialize_plan(Some(&root), 2, &plan).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
