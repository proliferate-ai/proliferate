use std::path::PathBuf;

use crate::integrations::mcp::capability_token::McpCapabilityTokenSignature;
use crate::integrations::mcp::product_server::{
    ProductMcpAuth, ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
};

const SECRET_FILE_NAME: &str = "cowork-mcp-token.key";
pub const LEGACY_CAPABILITY_HEADER_NAME: &str = "x-cowork-session-token";

#[derive(Clone)]
pub struct CoworkMcpAuth {
    inner: ProductMcpAuth,
}

impl CoworkMcpAuth {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self {
            // Fresh generic-header tokens use the shared product HMAC envelope.
            // The legacy cowork route still validates old SHA256-dot
            // workspace/session tokens for already-running sessions.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::mcp::capability_token::McpCapabilityTokenIssuer;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-cowork-mcp-auth-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn validates_product_and_legacy_tokens_without_cross_accepting_scopes() {
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
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Legacy {
                    name: LEGACY_CAPABILITY_HEADER_NAME,
                    value: &product_token,
                },
                &request,
            )
            .expect("reject product token in legacy header"),
            ProductMcpTokenValidation::Invalid,
        );

        let legacy_issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            SECRET_FILE_NAME,
            McpCapabilityTokenSignature::LegacySha256Dot,
            60,
        );
        let legacy_token = legacy_issuer
            .mint_workspace_session_token("workspace-1", "session-1")
            .expect("mint legacy token");
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Legacy {
                    name: LEGACY_CAPABILITY_HEADER_NAME,
                    value: &legacy_token,
                },
                &request,
            )
            .expect("validate legacy token"),
            ProductMcpTokenValidation::Valid,
        );
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Product {
                    value: &legacy_token,
                },
                &request,
            )
            .expect("reject legacy token in product header"),
            ProductMcpTokenValidation::Invalid,
        );

        let _ = std::fs::remove_dir_all(home);
    }
}
