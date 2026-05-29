pub mod auth;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use self::auth::SkillsMcpAuth;
use crate::domains::plugins::skills::{
    activate_skill, get_skill_resource, list_available_skills, ActivateSkillArgs,
    GetSkillResourceArgs,
};
use crate::domains::runtime_config::model::RuntimeConfigSessionContext;
use crate::domains::runtime_config::service::RuntimeConfigService;
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct SkillsProductMcpServer {
    runtime_config_service: Arc<RuntimeConfigService>,
    auth: Arc<SkillsMcpAuth>,
}

impl SkillsProductMcpServer {
    pub fn new(
        runtime_config_service: Arc<RuntimeConfigService>,
        auth: Arc<SkillsMcpAuth>,
    ) -> Self {
        Self {
            runtime_config_service,
            auth,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use anyharness_contract::v1::{
        RuntimeArtifactPayload, RuntimeArtifactRef, RuntimeConfigExternalScope,
        RuntimeConfigManifest, RuntimeConfigRevision, RuntimeConfigRevisionExpectation,
        RuntimeSkill, RuntimeSkillSourceKind,
    };
    use sha2::{Digest, Sha256};

    use super::auth::SkillsMcpAuth;
    use super::SkillsProductMcpServer;
    use crate::domains::runtime_config::model::RuntimeConfigApplyInput;
    use crate::domains::runtime_config::service::RuntimeConfigService;
    use crate::domains::runtime_config::store::RuntimeConfigStore;
    use crate::integrations::mcp::product_server::{ProductMcpRequestContext, ProductMcpServer};
    use crate::persistence::Db;

    #[tokio::test]
    async fn skills_mcp_context_comes_from_bound_runtime_config() {
        let service = Arc::new(RuntimeConfigService::new(RuntimeConfigStore::new(
            Db::open_in_memory().expect("db"),
        )));
        let request = apply_request();
        service.apply_config(request.clone()).expect("apply");
        service
            .bind_session_to_expected("session-1", &expectation(&request.revision))
            .expect("bind session");
        let server = SkillsProductMcpServer::new(
            service,
            Arc::new(SkillsMcpAuth::new(std::env::temp_dir())),
        );

        let context = server
            .resolve_context(&ProductMcpRequestContext::new(
                "workspace-1",
                "session-1",
                "proliferate_skills",
            ))
            .expect("runtime config skill context");
        let activated = server
            .call_tool(
                &context,
                "activate_skill",
                Some(serde_json::json!({ "skillId": "plugin:github:triage" })),
            )
            .await
            .expect("activate skill");

        assert_eq!(activated["instructions"], "# Runtime config skill\n");
        assert_eq!(activated["resources"][0]["resourceId"], "triage-guide");
    }

    #[test]
    fn skills_mcp_rejects_sessions_without_bound_runtime_config() {
        let service = Arc::new(RuntimeConfigService::new(RuntimeConfigStore::new(
            Db::open_in_memory().expect("db"),
        )));
        let server = SkillsProductMcpServer::new(
            service,
            Arc::new(SkillsMcpAuth::new(std::env::temp_dir())),
        );

        let error = server
            .resolve_context(&ProductMcpRequestContext::new(
                "workspace-1",
                "session-1",
                "proliferate_skills",
            ))
            .expect_err("missing runtime config context should fail closed");

        assert!(error.to_string().contains("no runtime config skills"));
    }

    fn apply_request() -> RuntimeConfigApplyInput {
        let instruction_content = "# Runtime config skill\n";
        let instruction_hash = runtime_artifact_hash(instruction_content);
        let guide_content = "Use issues.";
        let guide_hash = runtime_artifact_hash(guide_content);
        let instruction = RuntimeArtifactRef {
            hash: instruction_hash.clone(),
            content_type: "text/markdown".to_string(),
            byte_size: instruction_content.as_bytes().len() as i64,
            source_ref: Some("plugin:github:triage:instructions".to_string()),
            resource_id: None,
            display_name: None,
        };
        let resource = RuntimeArtifactRef {
            hash: guide_hash.clone(),
            content_type: "text/markdown".to_string(),
            byte_size: guide_content.as_bytes().len() as i64,
            source_ref: Some("plugin:github:triage:resource:triage-guide".to_string()),
            resource_id: Some("triage-guide".to_string()),
            display_name: Some("Triage guide".to_string()),
        };
        RuntimeConfigApplyInput {
            revision: RuntimeConfigRevision {
                id: "rev-1".to_string(),
                sequence: 1,
                content_hash: "sha256:manifest".to_string(),
                external_scope: Some(RuntimeConfigExternalScope {
                    provider: "proliferate-cloud".to_string(),
                    id: "profile-1".to_string(),
                    target_id: Some("target-1".to_string()),
                }),
            },
            manifest: RuntimeConfigManifest {
                mcp_servers: Vec::new(),
                mcp_binding_summaries: Vec::new(),
                skills: vec![RuntimeSkill {
                    id: "plugin:github:triage".to_string(),
                    source_kind: RuntimeSkillSourceKind::Plugin,
                    display_name: "Triage".to_string(),
                    description: "Inspect GitHub issues.".to_string(),
                    instruction_artifact: instruction.clone(),
                    resources: vec![resource.clone()],
                    required_mcp_server_ids: Vec::new(),
                    credential_refs: Vec::new(),
                }],
                artifacts: vec![instruction, resource],
                direct_attach_auth: None,
                warnings: Vec::new(),
            },
            artifact_payloads: vec![
                RuntimeArtifactPayload {
                    hash: instruction_hash,
                    content_type: "text/markdown".to_string(),
                    byte_size: instruction_content.as_bytes().len() as i64,
                    source_ref: Some("plugin:github:triage:instructions".to_string()),
                    resource_id: None,
                    display_name: None,
                    content: instruction_content.to_string(),
                },
                RuntimeArtifactPayload {
                    hash: guide_hash,
                    content_type: "text/markdown".to_string(),
                    byte_size: guide_content.as_bytes().len() as i64,
                    source_ref: Some("plugin:github:triage:resource:triage-guide".to_string()),
                    resource_id: Some("triage-guide".to_string()),
                    display_name: Some("Triage guide".to_string()),
                    content: guide_content.to_string(),
                },
            ],
            credential_values: Vec::new(),
            source: "worker".to_string(),
        }
    }

    fn runtime_artifact_hash(content: &str) -> String {
        format!("sha256:{:x}", Sha256::digest(content.as_bytes()))
    }

    fn expectation(revision: &RuntimeConfigRevision) -> RuntimeConfigRevisionExpectation {
        RuntimeConfigRevisionExpectation {
            revision_id: revision.id.clone(),
            sequence: Some(revision.sequence),
            content_hash: revision.content_hash.clone(),
            external_scope: revision.external_scope.clone(),
        }
    }
}

#[async_trait]
impl ProductMcpServer for SkillsProductMcpServer {
    type Context = RuntimeConfigSessionContext;

    fn definition(&self) -> &'static ProductMcpDefinition {
        &definition::DEFINITION
    }

    fn validate_capability_token(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        self.auth.validate_capability_header(header, request)
    }

    fn resolve_context(
        &self,
        request: &ProductMcpRequestContext,
    ) -> Result<Self::Context, ProductMcpContextError> {
        self.runtime_config_service
            .session_context(&request.session_id)
            .map_err(|error| ProductMcpContextError::Internal(anyhow::anyhow!(error)))?
            .filter(|context| !context.skills.is_empty())
            .ok_or_else(|| {
                ProductMcpContextError::not_found("no runtime config skills for session")
            })
    }

    fn tools(&self, _ctx: &Self::Context) -> Vec<Value> {
        tools::build_tool_list()
    }

    async fn call_tool(
        &self,
        ctx: &Self::Context,
        name: &str,
        arguments: Option<Value>,
    ) -> anyhow::Result<Value> {
        match name {
            "list_available_skills" => Ok(list_available_skills(ctx)),
            "activate_skill" => {
                let args: ActivateSkillArgs =
                    serde_json::from_value(arguments.unwrap_or_else(|| serde_json::json!({})))?;
                activate_skill(ctx, &args.skill_id)
            }
            "get_skill_resource" => {
                let args: GetSkillResourceArgs =
                    serde_json::from_value(arguments.unwrap_or_else(|| serde_json::json!({})))?;
                get_skill_resource(ctx, &args.skill_id, &args.resource_id)
            }
            _ => Err(anyhow::anyhow!("unknown skills tool: {name}")),
        }
    }
}
