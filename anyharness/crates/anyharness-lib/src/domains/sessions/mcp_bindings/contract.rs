use anyharness_contract::v1::SessionMcpServer as ContractSessionMcpServer;

use super::model::{
    SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    SessionMcpStdioServer,
};

pub fn bindings_from_contract(bindings: Vec<ContractSessionMcpServer>) -> Vec<SessionMcpServer> {
    bindings
        .into_iter()
        .map(|binding| match binding {
            ContractSessionMcpServer::Http(server) => {
                SessionMcpServer::Http(SessionMcpHttpServer {
                    connection_id: server.connection_id,
                    catalog_entry_id: server.catalog_entry_id,
                    server_name: server.server_name,
                    url: server.url,
                    headers: server
                        .headers
                        .into_iter()
                        .map(|header| SessionMcpHeader {
                            name: header.name,
                            value: header.value,
                        })
                        .collect(),
                })
            }
            ContractSessionMcpServer::Stdio(server) => {
                SessionMcpServer::Stdio(SessionMcpStdioServer {
                    connection_id: server.connection_id,
                    catalog_entry_id: server.catalog_entry_id,
                    server_name: server.server_name,
                    command: server.command,
                    args: server.args,
                    env: server
                        .env
                        .into_iter()
                        .map(|env_var| SessionMcpEnvVar {
                            name: env_var.name,
                            value: env_var.value,
                        })
                        .collect(),
                })
            }
        })
        .collect()
}
