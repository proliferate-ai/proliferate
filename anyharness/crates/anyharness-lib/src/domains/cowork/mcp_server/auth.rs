use std::path::PathBuf;

use crate::integrations::mcp::capability_token::{
    McpCapabilityTokenIssuer, McpCapabilityTokenSignature,
};

const SECRET_FILE_NAME: &str = "cowork-mcp-token.key";
const CAPABILITY_HEADER_NAME: &str = "x-cowork-session-token";
const TOKEN_TTL_SECONDS: i64 = 60 * 60 * 12;

#[derive(Clone)]
pub struct CoworkMcpAuth {
    issuer: McpCapabilityTokenIssuer,
}

impl CoworkMcpAuth {
    pub fn new(runtime_home: PathBuf) -> Self {
        Self {
            issuer: McpCapabilityTokenIssuer::new(
                runtime_home,
                SECRET_FILE_NAME,
                McpCapabilityTokenSignature::LegacySha256Dot,
                TOKEN_TTL_SECONDS,
            ),
        }
    }

    pub fn capability_header_name(&self) -> &'static str {
        CAPABILITY_HEADER_NAME
    }

    pub fn mint_capability_token(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<String> {
        self.issuer
            .mint_workspace_session_token(workspace_id, session_id)
    }

    pub fn validate_capability_token(
        &self,
        token: &str,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<bool> {
        self.issuer
            .validate_workspace_session_token(token, workspace_id, session_id)
    }
}
