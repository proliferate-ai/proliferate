use std::path::PathBuf;

use crate::integrations::mcp::capability_token::McpCapabilityTokenSignature;
use crate::integrations::mcp::product_server::{
    ProductMcpAuth, ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
};

pub(crate) const SECRET_FILE_NAME: &str = "cowork-mcp-token.key";

#[derive(Clone)]
pub struct CoworkMcpAuth {
    inner: ProductMcpAuth,
}

impl CoworkMcpAuth {
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
    use super::*;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-cowork-mcp-auth-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn validates_product_token_and_rejects_wrong_scope() {
        let home = runtime_home("scope");
        let auth = CoworkMcpAuth::new(home.clone());
        let request = ProductMcpRequestContext::new("workspace-1", "session-1", "cowork");
        let product_token = auth
            .mint_capability_token("workspace-1", "session-1")
            .expect("mint product token");

        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Product {
                    value: &product_token,
                },
                &request,
            )
            .expect("validate product token"),
            ProductMcpTokenValidation::Valid,
        );

        let wrong_scope = ProductMcpRequestContext::new("workspace-1", "session-1", "subagents");
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Product {
                    value: &product_token,
                },
                &wrong_scope,
            )
            .expect("reject wrong scope"),
            ProductMcpTokenValidation::Invalid,
        );

        let _ = std::fs::remove_dir_all(home);
    }
}
