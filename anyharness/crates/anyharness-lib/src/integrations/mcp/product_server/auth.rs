use std::path::PathBuf;

use crate::integrations::mcp::capability_token::{
    McpCapabilityTokenIssuer, McpCapabilityTokenSignature, ProductMcpCapabilityScope,
};
use crate::integrations::mcp::product_server::{
    ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
};

const TOKEN_TTL_SECONDS: i64 = 60 * 60 * 12;

#[derive(Clone)]
pub struct ProductMcpAuth {
    product_issuer: McpCapabilityTokenIssuer,
    product_mcp_id: &'static str,
}

impl ProductMcpAuth {
    pub fn new(
        runtime_home: PathBuf,
        secret_file_name: &'static str,
        product_signature: McpCapabilityTokenSignature,
        product_mcp_id: &'static str,
    ) -> Self {
        Self {
            product_issuer: McpCapabilityTokenIssuer::new(
                runtime_home,
                secret_file_name,
                product_signature,
                TOKEN_TTL_SECONDS,
            ),
            product_mcp_id,
        }
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self.product_issuer
            .mint_product_mcp_token(ProductMcpCapabilityScope {
                workspace_id,
                session_id,
                product_mcp_id: self.product_mcp_id,
            })
    }

    pub fn validate_capability_header(
        &self,
        header: ProductMcpAuthHeader<'_>,
        request: &ProductMcpRequestContext,
    ) -> anyhow::Result<ProductMcpTokenValidation> {
        let valid = match header {
            ProductMcpAuthHeader::Product { value } => {
                self.product_issuer.validate_product_mcp_token(
                    value,
                    ProductMcpCapabilityScope {
                        workspace_id: &request.workspace_id,
                        session_id: &request.session_id,
                        product_mcp_id: &request.product_mcp_id,
                    },
                )?
            }
        };
        Ok(if valid {
            ProductMcpTokenValidation::Valid
        } else {
            ProductMcpTokenValidation::Invalid
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-product-mcp-auth-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn validates_product_token_and_rejects_wrong_scope() {
        let home = runtime_home("scope");
        let auth = ProductMcpAuth::new(
            home.clone(),
            "test-product.key",
            McpCapabilityTokenSignature::HmacSha256,
            "reviews",
        );
        let request = ProductMcpRequestContext::new("workspace-1", "session-1", "reviews");
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
            .expect("validate product header"),
            ProductMcpTokenValidation::Valid,
        );

        let wrong_scope_request =
            ProductMcpRequestContext::new("workspace-1", "session-1", "subagents");
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Product {
                    value: &product_token,
                },
                &wrong_scope_request,
            )
            .expect("reject wrong scope"),
            ProductMcpTokenValidation::Invalid,
        );

        let _ = std::fs::remove_dir_all(home);
    }
}
