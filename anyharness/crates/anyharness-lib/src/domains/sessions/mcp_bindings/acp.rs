use agent_client_protocol as acp;

use super::model::SessionMcpServer;

pub fn to_acp_servers(bindings: &[SessionMcpServer]) -> Vec<acp::schema::McpServer> {
    bindings
        .iter()
        .map(|binding| match binding {
            SessionMcpServer::Http(server) => acp::schema::McpServer::Http(
                acp::schema::McpServerHttp::new(server.server_name.clone(), server.url.clone()).headers(
                    server
                        .headers
                        .iter()
                        .map(|header| {
                            acp::schema::HttpHeader::new(header.name.clone(), header.value.clone())
                        })
                        .collect(),
                ),
            ),
            SessionMcpServer::Stdio(server) => acp::schema::McpServer::Stdio(
                acp::schema::McpServerStdio::new(server.server_name.clone(), server.command.clone())
                    .args(server.args.clone())
                    .env(
                        server
                            .env
                            .iter()
                            .map(|env_var| {
                                acp::schema::EnvVariable::new(env_var.name.clone(), env_var.value.clone())
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
        SessionMcpEnvVar, SessionMcpServer, SessionMcpStdioServer,
    };

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
