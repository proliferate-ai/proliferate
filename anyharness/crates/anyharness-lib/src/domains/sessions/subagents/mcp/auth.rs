use std::path::PathBuf;

use crate::integrations::mcp::capability_token::McpCapabilityTokenSignature;
use crate::integrations::mcp::product_server::{
    ProductMcpAuth, ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
};

const SECRET_FILE_NAME: &str = "subagent-mcp-token.key";
pub const LEGACY_CAPABILITY_HEADER_NAME: &str = "x-subagent-session-token";

#[derive(Clone)]
pub struct SubagentMcpAuth {
    inner: ProductMcpAuth,
}

impl SubagentMcpAuth {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self {
            // Fresh generic-header tokens use the shared product HMAC envelope.
            // The legacy header still validates old SHA256-dot workspace/session
            // tokens for already-running sessions.
            inner: ProductMcpAuth::new(
                runtime_home,
                SECRET_FILE_NAME,
                McpCapabilityTokenSignature::HmacSha256,
                McpCapabilityTokenSignature::LegacySha256Dot,
                super::definition::DEFINITION.id,
                LEGACY_CAPABILITY_HEADER_NAME,
            ),
        }
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self.inner.mint_capability_token(workspace_id, session_id)
    }

    pub fn validate_capability_header(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        self.inner.validate_capability_header(header, request)
    }
}
