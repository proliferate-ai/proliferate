pub mod auth;
pub mod definition;
pub mod tools;

use std::sync::Arc;

use anyharness_contract::v1::SessionPluginBundle;
use async_trait::async_trait;
use serde_json::Value;

use self::auth::SkillsMcpAuth;
use crate::domains::plugins::registry::PluginBundleRegistry;
use crate::domains::plugins::skills::{
    activate_skill, get_skill_resource, iter_skills, list_available_skills, ActivateSkillArgs,
    GetSkillResourceArgs,
};
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpContextError, ProductMcpDefinition, ProductMcpRequestContext,
    ProductMcpServer, ProductMcpTokenValidation,
};

#[derive(Clone)]
pub struct SkillsProductMcpServer {
    registry: PluginBundleRegistry,
    auth: Arc<SkillsMcpAuth>,
}

impl SkillsProductMcpServer {
    pub fn new(registry: PluginBundleRegistry, auth: Arc<SkillsMcpAuth>) -> Self {
        Self { registry, auth }
    }
}

#[async_trait]
impl ProductMcpServer for SkillsProductMcpServer {
    type Context = SessionPluginBundle;

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
        let bundle = self
            .registry
            .get_session_bundle(&request.session_id)
            .ok_or_else(|| {
                tracing::warn!(
                    session_id = %request.session_id,
                    workspace_id = %request.workspace_id,
                    "skills MCP context missing plugin bundle"
                );
                ProductMcpContextError::not_found("no plugin bundle for session")
            })?;
        tracing::debug!(
            session_id = %request.session_id,
            workspace_id = %request.workspace_id,
            plugin_count = bundle.plugins.len(),
            skill_count = iter_skills(&bundle).count(),
            "skills MCP context resolved"
        );
        Ok(bundle)
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
            "list_available_skills" => {
                tracing::info!(
                    skill_count = iter_skills(ctx).count(),
                    "skills MCP listed available skills"
                );
                Ok(list_available_skills(ctx))
            }
            "activate_skill" => {
                let args: ActivateSkillArgs =
                    serde_json::from_value(arguments.unwrap_or_else(|| serde_json::json!({})))?;
                tracing::info!(
                    skill_id = %args.skill_id,
                    "skills MCP activating skill"
                );
                activate_skill(ctx, &args.skill_id)
            }
            "get_skill_resource" => {
                let args: GetSkillResourceArgs =
                    serde_json::from_value(arguments.unwrap_or_else(|| serde_json::json!({})))?;
                tracing::info!(
                    skill_id = %args.skill_id,
                    resource_id = %args.resource_id,
                    "skills MCP loading skill resource"
                );
                get_skill_resource(ctx, &args.skill_id, &args.resource_id)
            }
            _ => Err(anyhow::anyhow!("unknown skills tool: {name}")),
        }
    }
}
