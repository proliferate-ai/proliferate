use std::fmt;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpHeader {
    pub name: String,
    pub value: String,
}

impl fmt::Debug for SessionMcpHeader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionMcpHeader")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpEnvVar {
    pub name: String,
    pub value: String,
}

impl fmt::Debug for SessionMcpEnvVar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionMcpEnvVar")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpHttpServer {
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<SessionMcpHeader>,
}

impl fmt::Debug for SessionMcpHttpServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let header_names: Vec<&str> = self
            .headers
            .iter()
            .map(|header| header.name.as_str())
            .collect();
        f.debug_struct("SessionMcpHttpServer")
            .field("connection_id", &self.connection_id)
            .field("catalog_entry_id", &self.catalog_entry_id)
            .field("server_name", &self.server_name)
            .field("url", &"<redacted>")
            .field("header_names", &header_names)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpStdioServer {
    pub connection_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_entry_id: Option<String>,
    pub server_name: String,
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub env: Vec<SessionMcpEnvVar>,
}

impl fmt::Debug for SessionMcpStdioServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let env_names: Vec<&str> = self
            .env
            .iter()
            .map(|variable| variable.name.as_str())
            .collect();
        f.debug_struct("SessionMcpStdioServer")
            .field("connection_id", &self.connection_id)
            .field("catalog_entry_id", &self.catalog_entry_id)
            .field("server_name", &self.server_name)
            .field("command", &self.command)
            .field("arg_count", &self.args.len())
            .field("env_names", &env_names)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case", tag = "transport")]
pub enum SessionMcpServer {
    Http(SessionMcpHttpServer),
    Stdio(SessionMcpStdioServer),
}

impl fmt::Debug for SessionMcpServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(server) => f.debug_tuple("Http").field(server).finish(),
            Self::Stdio(server) => f.debug_tuple("Stdio").field(server).finish(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionMcpTransport {
    Http,
    Stdio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionMcpBindingOutcome {
    Applied,
    NotApplied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SessionMcpBindingNotAppliedReason {
    MissingSecret,
    NeedsReconnect,
    UnsupportedTarget,
    WorkspacePathUnresolved,
    PolicyDisabled,
    ResolverError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpBindingSummary {
    pub id: String,
    pub server_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub transport: SessionMcpTransport,
    pub outcome: SessionMcpBindingOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SessionMcpBindingNotAppliedReason>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdio_debug_redacts_env_values() {
        let env_var = SessionMcpEnvVar {
            name: "TAVILY_API_KEY".to_string(),
            value: "tvly-secret".to_string(),
        };

        let env_debug = format!("{env_var:?}");
        assert!(!env_debug.contains("tvly-secret"));
        assert!(env_debug.contains("<redacted>"));

        let server = SessionMcpStdioServer {
            connection_id: "connection-1".to_string(),
            catalog_entry_id: Some("tavily".to_string()),
            server_name: "tavily".to_string(),
            command: "tavily-mcp".to_string(),
            args: vec!["--stdio".to_string()],
            env: vec![env_var],
        };

        let server_debug = format!("{server:?}");
        assert!(!server_debug.contains("tvly-secret"));
        assert!(server_debug.contains("TAVILY_API_KEY"));
    }
}
