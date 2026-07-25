//! Header-safe launch injection for the trusted local workflow broker.
//!
//! Remote gateway URLs, bearers, callbacks, and activation identifiers never
//! enter this module. A platform isolation broker issues a
//! session/execution/broker-generation-bound local capability after validating
//! the immutable delivery identity. The
//! capability is agent-visible but authenticates only the local broker and is
//! never a remote integration credential.

use crate::domains::sessions::mcp_bindings::model::{
    SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
};
use crate::integrations::integration_gateway::INTEGRATION_GATEWAY_ID;
use crate::live::workflows::isolation::{
    TrustedLocalGatewayBinding, LOCAL_BROKER_CAPABILITY_HEADER,
};
use std::collections::HashMap;
use std::sync::RwLock;

pub fn workflow_gateway_server(binding: &TrustedLocalGatewayBinding) -> SessionMcpServer {
    SessionMcpServer::Http(SessionMcpHttpServer {
        connection_id: INTEGRATION_GATEWAY_ID.to_string(),
        catalog_entry_id: None,
        server_name: INTEGRATION_GATEWAY_ID.to_string(),
        url: binding.endpoint().to_string(),
        headers: vec![SessionMcpHeader {
            name: LOCAL_BROKER_CAPABILITY_HEADER.to_string(),
            value: binding.capability().to_string(),
        }],
    })
}

/// Ephemeral local-broker bindings keyed by session id. Values are never
/// written to SQLite and are removed when the run releases the session.
#[derive(Default)]
pub struct WorkflowGatewaySessions {
    servers: RwLock<HashMap<String, SessionMcpServer>>,
}

impl WorkflowGatewaySessions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&self, session_id: &str, server: SessionMcpServer) -> bool {
        if !is_exact_local_workflow_server(&server) {
            return false;
        }
        self.servers
            .write()
            .unwrap()
            .insert(session_id.to_string(), server);
        true
    }

    pub fn get(&self, session_id: &str) -> Option<SessionMcpServer> {
        self.servers.read().unwrap().get(session_id).cloned()
    }

    pub fn get_exact_local(&self, session_id: &str) -> Option<SessionMcpServer> {
        self.get(session_id).filter(is_exact_local_workflow_server)
    }

    pub fn remove(&self, session_id: &str) -> bool {
        self.servers.write().unwrap().remove(session_id).is_some()
    }
}

fn is_exact_local_workflow_server(server: &SessionMcpServer) -> bool {
    let SessionMcpServer::Http(server) = server else {
        return false;
    };
    let Ok(url) = url::Url::parse(&server.url) else {
        return false;
    };
    server.connection_id == INTEGRATION_GATEWAY_ID
        && server.server_name == INTEGRATION_GATEWAY_ID
        && server.catalog_entry_id.is_none()
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "::1"))
        && url.port().is_some_and(|port| port != 0)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/mcp"
        && url.query().is_none()
        && url.fragment().is_none()
        && server.headers.len() == 1
        && server.headers[0].name == LOCAL_BROKER_CAPABILITY_HEADER
        && !server.headers[0].value.trim().is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding() -> TrustedLocalGatewayBinding {
        TrustedLocalGatewayBinding::try_new(
            "http://127.0.0.1:43891/mcp",
            "session-1",
            7,
            11,
            "local-only-capability",
        )
        .expect("binding")
    }

    #[test]
    fn acp_binding_has_only_local_broker_capability() {
        let SessionMcpServer::Http(server) = workflow_gateway_server(&binding()) else {
            panic!("expected HTTP server");
        };
        assert_eq!(server.url, "http://127.0.0.1:43891/mcp");
        assert_eq!(server.headers.len(), 1);
        assert_eq!(server.headers[0].name, LOCAL_BROKER_CAPABILITY_HEADER);
        assert_eq!(server.headers[0].value, "local-only-capability");
        assert!(server
            .headers
            .iter()
            .all(|header| !header.name.eq_ignore_ascii_case("authorization")));
    }

    #[test]
    fn registry_is_session_scoped_and_ephemeral() {
        let registry = WorkflowGatewaySessions::new();
        assert!(registry.set("session-1", workflow_gateway_server(&binding())));
        assert!(registry.get("session-1").is_some());
        assert!(registry.get("session-2").is_none());
        assert!(registry.remove("session-1"));
        assert!(registry.get("session-1").is_none());
    }

    #[test]
    fn registry_rejects_generic_or_userinfo_bearing_servers() {
        let registry = WorkflowGatewaySessions::new();
        let mut generic = workflow_gateway_server(&binding());
        let SessionMcpServer::Http(server) = &mut generic else {
            unreachable!()
        };
        server.url = "http://user:pass@127.0.0.1:43891/mcp".to_string();
        assert!(!registry.set("session-1", generic));
        assert!(registry.get("session-1").is_none());

        let mut authorization = workflow_gateway_server(&binding());
        let SessionMcpServer::Http(server) = &mut authorization else {
            unreachable!()
        };
        server.headers[0].name = "Authorization".to_string();
        assert!(!registry.set("session-1", authorization));
        assert!(registry.get("session-1").is_none());
    }
}
