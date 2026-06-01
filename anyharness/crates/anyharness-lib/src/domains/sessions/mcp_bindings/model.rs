use std::fmt;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpHttpServer {
    pub connection_id: String,
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMcpStdioServer {
    pub connection_id: String,
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

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdio_debug_redacts_env_values() {
        let binding = SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: "connection-2".to_string(),
            catalog_entry_id: Some("filesystem".to_string()),
            server_name: "filesystem".to_string(),
            command: "mcp-server-filesystem".to_string(),
            args: vec!["/workspace".to_string()],
            env: vec![SessionMcpEnvVar {
                name: "API_KEY".to_string(),
                value: "secret".to_string(),
            }],
        });

        let debug_output = format!("{binding:?}");

        assert!(!debug_output.contains("secret"));
        assert!(debug_output.contains("API_KEY"));
    }
}
