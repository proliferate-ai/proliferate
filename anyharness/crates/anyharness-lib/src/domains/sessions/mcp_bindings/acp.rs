use agent_client_protocol as acp;

use super::model::SessionMcpServer;

pub fn to_acp_servers(bindings: &[SessionMcpServer]) -> Vec<acp::schema::McpServer> {
    bindings
        .iter()
        .map(|binding| match binding {
            SessionMcpServer::Http(server) => acp::schema::McpServer::Http(
                acp::schema::McpServerHttp::new(server.server_name.clone(), server.url.clone())
                    .headers(
                        server
                            .headers
                            .iter()
                            .map(|header| {
                                acp::schema::HttpHeader::new(
                                    header.name.clone(),
                                    header.value.clone(),
                                )
                            })
                            .collect(),
                    ),
            ),
            SessionMcpServer::Stdio(server) => acp::schema::McpServer::Stdio(
                acp::schema::McpServerStdio::new(
                    server.server_name.clone(),
                    server.command.clone(),
                )
                .args(server.args.clone())
                .env(
                    server
                        .env
                        .iter()
                        .map(|env_var| {
                            acp::schema::EnvVariable::new(
                                env_var.name.clone(),
                                env_var.value.clone(),
                            )
                        })
                        .collect(),
                ),
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::mcp_bindings::model::{
        SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
        SessionMcpStdioServer,
    };

    #[test]
    fn to_acp_servers_preserves_workspace_http_namespace_and_route() {
        let bindings = vec![SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: "workspace".to_string(),
            catalog_entry_id: None,
            server_name: "proliferate_workspace".to_string(),
            url: "http://127.0.0.1:4317/v1/workspaces/w/sessions/s/mcp/workspace".to_string(),
            headers: vec![SessionMcpHeader {
                name: "x-anyharness-product-mcp-token".to_string(),
                value: "secret".to_string(),
            }],
        })];

        let servers = to_acp_servers(&bindings);
        let [acp::schema::McpServer::Http(server)] = servers.as_slice() else {
            panic!("one Workspace HTTP ACP server");
        };

        assert_eq!(server.name, "proliferate_workspace");
        assert!(server.url.ends_with("/mcp/workspace"));
        assert_eq!(server.headers.len(), 1);
    }

    #[test]
    fn to_acp_servers_maps_stdio_transport() {
        let bindings = vec![SessionMcpServer::Stdio(SessionMcpStdioServer {
            connection_id: "connection-2".to_string(),
            catalog_entry_id: Some("filesystem".to_string()),
            server_name: "filesystem".to_string(),
            command: "mcp-server-filesystem".to_string(),
            args: vec!["/workspace".to_string()],
            env: vec![SessionMcpEnvVar {
                name: "API_KEY".to_string(),
                value: "secret".to_string(),
            }],
        })];

        let mapped = to_acp_servers(&bindings);

        assert_eq!(mapped.len(), 1);
        assert!(matches!(mapped[0], acp::schema::McpServer::Stdio(_)));
    }
}
