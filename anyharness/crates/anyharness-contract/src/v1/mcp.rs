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
        let header_names: Vec<&str> = self.headers.iter().map(|header| header.name.as_str()).collect();
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
#[serde(rename_all = "snake_case", tag = "transport")]
pub enum SessionMcpServer {
    Http(SessionMcpHttpServer),
}

impl fmt::Debug for SessionMcpServer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(server) => f.debug_tuple("Http").field(server).finish(),
        }
    }
}
