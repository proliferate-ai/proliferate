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
    issuer: McpCapabilityTokenIssuer,
    product_mcp_id: &'static str,
    legacy_header_name: &'static str,
}

impl ProductMcpAuth {
    pub fn new(
        runtime_home: PathBuf,
        secret_file_name: &'static str,
        signature: McpCapabilityTokenSignature,
        product_mcp_id: &'static str,
        legacy_header_name: &'static str,
    ) -> Self {
        Self {
            issuer: McpCapabilityTokenIssuer::new(
                runtime_home,
                secret_file_name,
                signature,
                TOKEN_TTL_SECONDS,
            ),
            product_mcp_id,
            legacy_header_name,
        }
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self.issuer
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
            ProductMcpAuthHeader::Product { value } => self.issuer.validate_product_mcp_token(
                value,
                ProductMcpCapabilityScope {
                    workspace_id: &request.workspace_id,
                    session_id: &request.session_id,
                    product_mcp_id: &request.product_mcp_id,
                },
            )?,
            ProductMcpAuthHeader::Legacy { name, value }
                if name.eq_ignore_ascii_case(self.legacy_header_name) =>
            {
                self.issuer.validate_workspace_session_token(
                    value,
                    &request.workspace_id,
                    &request.session_id,
                )?
            }
            ProductMcpAuthHeader::Legacy { .. } => false,
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
    use crate::integrations::mcp::capability_token::McpCapabilityTokenIssuer;

    fn runtime_home(test_name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "anyharness-product-mcp-auth-{test_name}-{}",
            uuid::Uuid::new_v4()
        ));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn validates_product_and_legacy_headers_without_cross_accepting_scopes() {
        let home = runtime_home("scope");
        let auth = ProductMcpAuth::new(
            home.clone(),
            "test-product.key",
            McpCapabilityTokenSignature::HmacSha256,
            "reviews",
            "x-review-session-token",
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
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Legacy {
                    name: "x-review-session-token",
                    value: &product_token,
                },
                &request,
            )
            .expect("reject product token in legacy header"),
            ProductMcpTokenValidation::Invalid,
        );

        let legacy_issuer = McpCapabilityTokenIssuer::new(
            home.clone(),
            "test-product.key",
            McpCapabilityTokenSignature::HmacSha256,
            60,
        );
        let legacy_token = legacy_issuer
            .mint_workspace_session_token("workspace-1", "session-1")
            .expect("mint legacy token");
        assert_eq!(
            auth.validate_capability_header(
                ProductMcpAuthHeader::Legacy {
                    name: "x-review-session-token",
                    value: &legacy_token,
                },
                &request,
            )
            .expect("validate legacy header"),
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
