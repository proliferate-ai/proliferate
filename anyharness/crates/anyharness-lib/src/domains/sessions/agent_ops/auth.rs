use std::path::PathBuf;

use crate::integrations::mcp::capability_token::McpCapabilityTokenSignature;
use crate::integrations::mcp::product_server::{
    ProductMcpAuth, ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
};

// Renaming this file would rotate the HMAC secret and 401 every session that
// baked a token in before the restart.
const SECRET_FILE_NAME: &str = "subagent-mcp-token.key";

#[derive(Clone)]
pub struct AgentOpsMcpAuth {
    inner: ProductMcpAuth,
}

impl AgentOpsMcpAuth {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self {
            inner: ProductMcpAuth::new(
                runtime_home,
                SECRET_FILE_NAME,
                McpCapabilityTokenSignature::HmacSha256,
                super::definition::DEFINITION.id,
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

#[cfg(test)]
mod tests {
    use super::SECRET_FILE_NAME;

    #[test]
    fn secret_file_name_stays_frozen_for_already_launched_sessions() {
        // Renaming this rotates the HMAC secret and 401s every session that
        // baked a token in before the restart. See the comment above the
        // const.
        assert_eq!(SECRET_FILE_NAME, "subagent-mcp-token.key");
    }
}
