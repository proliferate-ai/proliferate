pub const PRODUCT_MCP_TOKEN_HEADER_NAME: &str = "x-anyharness-product-mcp-token";

#[derive(Debug, Clone)]
pub struct ProductMcpRequestContext {
    pub workspace_id: String,
    pub session_id: String,
    pub product_mcp_id: String,
}

impl ProductMcpRequestContext {
    pub fn new(
        workspace_id: impl Into<String>,
        session_id: impl Into<String>,
        product_mcp_id: impl Into<String>,
    ) -> Self {
        Self {
            workspace_id: workspace_id.into(),
            session_id: session_id.into(),
            product_mcp_id: product_mcp_id.into(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ProductMcpAuthHeader<'a> {
    Product { value: &'a str },
    Legacy { name: &'static str, value: &'a str },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMcpTokenValidation {
    Valid,
    Invalid,
}

impl ProductMcpTokenValidation {
    pub fn is_valid(self) -> bool {
        matches!(self, Self::Valid)
    }
}
