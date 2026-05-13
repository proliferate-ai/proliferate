use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpEnvVar, SessionMcpHeader, SessionMcpHttpServer, SessionMcpServer,
    SessionMcpStdioServer, SessionMcpTransport, SessionPlugin, SessionPluginBundle,
    SessionPluginCredentialBinding, SessionPluginCredentialBindingStatus, SessionPluginSkill,
    SessionPluginSkillResource,
};

use super::validate_session_plugin_bundle;

#[test]
fn accepts_valid_bundle() {
    assert!(validate_session_plugin_bundle(&valid_bundle()).is_ok());
}

#[test]
fn rejects_duplicate_credential_binding_ids() {
    let mut bundle = valid_bundle();
    bundle.plugins[0]
        .credential_bindings
        .push(SessionPluginCredentialBinding {
            id: "conn_github".to_string(),
            display_name: Some("Duplicate".to_string()),
            status: SessionPluginCredentialBindingStatus::Ready,
        });

    assert_error_contains(&bundle, "duplicate credential binding id");
}

#[test]
fn rejects_non_ready_credential_bindings() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].credential_bindings[0].status =
        SessionPluginCredentialBindingStatus::NeedsReconnect;

    assert_error_contains(&bundle, "is not ready");
}

#[test]
fn rejects_unknown_skill_credential_binding_refs() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].skills[0].credential_binding_ids = vec!["missing".to_string()];

    assert_error_contains(&bundle, "unknown credential binding");
}

#[test]
fn rejects_unknown_skill_mcp_refs() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].skills[0].required_mcp_servers = vec!["missing".to_string()];

    assert_error_contains(&bundle, "unknown MCP server");
}

#[test]
fn rejects_blank_required_mcp_refs() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].skills[0].required_mcp_servers = vec![" ".to_string()];

    assert_error_contains(&bundle, "required MCP server name is blank");
}

#[test]
fn rejects_oversized_skill_instructions() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].skills[0].instructions = "a".repeat(super::MAX_INSTRUCTIONS_LEN + 1);

    assert_error_contains(&bundle, "skill instructions is too long");
}

#[test]
fn rejects_reserved_mcp_server_names() {
    let mut bundle = valid_bundle();
    if let SessionMcpServer::Http(server) = &mut bundle.plugins[0].mcp_servers[0] {
        server.server_name = "proliferate_skills".to_string();
    }
    bundle.plugins[0].mcp_binding_summaries[0].server_name = "proliferate_skills".to_string();

    assert_error_contains(&bundle, "reserved MCP server name");
}

#[test]
fn rejects_duplicate_mcp_server_names_across_plugins() {
    let mut bundle = valid_bundle();
    let mut second = bundle.plugins[0].clone();
    second.plugin_id = "connector.conn_other".to_string();
    if let SessionMcpServer::Http(server) = &mut second.mcp_servers[0] {
        server.connection_id = "conn_other".to_string();
    }
    second.credential_bindings[0].id = "conn_other".to_string();
    second.mcp_binding_summaries[0].id = "conn_other".to_string();
    second.skills[0].skill_id = "connector.conn_other.triage".to_string();
    second.skills[0].credential_binding_ids = vec!["conn_other".to_string()];
    bundle.plugins.push(second);

    assert_error_contains(&bundle, "duplicate MCP server name across plugin bundle");
}

#[test]
fn rejects_non_applied_mcp_binding_summaries() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_binding_summaries[0].outcome = SessionMcpBindingOutcome::NotApplied;
    bundle.plugins[0].mcp_binding_summaries[0].reason =
        Some(SessionMcpBindingNotAppliedReason::MissingSecret);

    assert_error_contains(&bundle, "non-applied MCP binding summary");
}

#[test]
fn rejects_summary_for_unknown_mcp_connection() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_binding_summaries[0].id = "missing".to_string();

    assert_error_contains(&bundle, "summary references unknown MCP connection");
}

#[test]
fn rejects_missing_mcp_binding_summary_for_server() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_binding_summaries.clear();

    assert_error_contains(&bundle, "one applied MCP binding summary per MCP server");
}

#[test]
fn rejects_mismatched_mcp_binding_summary_transport() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_binding_summaries[0].transport = SessionMcpTransport::Stdio;

    assert_error_contains(&bundle, "summary transport does not match");
}

#[test]
fn rejects_mismatched_mcp_binding_summary_server_name() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_binding_summaries[0].server_name = "other".to_string();

    assert_error_contains(&bundle, "summary references unknown MCP server");
}

#[test]
fn rejects_duplicate_mcp_connection_ids() {
    let mut bundle = valid_bundle();
    bundle.plugins[0]
        .mcp_servers
        .push(SessionMcpServer::Http(SessionMcpHttpServer {
            connection_id: "conn_github".to_string(),
            catalog_entry_id: Some("github".to_string()),
            server_name: "github_extra".to_string(),
            url: "https://example.com/extra-mcp".to_string(),
            headers: Vec::new(),
        }));

    assert_error_contains(&bundle, "duplicate MCP connection id");
}

#[test]
fn rejects_blank_mcp_connection_id() {
    let mut bundle = valid_bundle();
    if let SessionMcpServer::Http(server) = &mut bundle.plugins[0].mcp_servers[0] {
        server.connection_id = " ".to_string();
    }

    assert_error_contains(&bundle, "MCP connection id is required");
}

#[test]
fn rejects_invalid_http_mcp_url() {
    let mut bundle = valid_bundle();
    if let SessionMcpServer::Http(server) = &mut bundle.plugins[0].mcp_servers[0] {
        server.url = "file:///tmp/server".to_string();
    }

    assert_error_contains(&bundle, "URL must use http or https");
}

#[test]
fn rejects_blank_stdio_mcp_command() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_servers[0] = SessionMcpServer::Stdio(SessionMcpStdioServer {
        connection_id: "conn_github".to_string(),
        catalog_entry_id: Some("github".to_string()),
        server_name: "github".to_string(),
        command: " ".to_string(),
        args: Vec::new(),
        env: Vec::new(),
    });

    assert_error_contains(&bundle, "stdio MCP command is required");
}

#[test]
fn rejects_blank_http_header_name() {
    let mut bundle = valid_bundle();
    if let SessionMcpServer::Http(server) = &mut bundle.plugins[0].mcp_servers[0] {
        server.headers.push(SessionMcpHeader {
            name: " ".to_string(),
            value: "secret".to_string(),
        });
    }

    assert_error_contains(&bundle, "MCP header name is required");
}

#[test]
fn rejects_blank_stdio_env_name() {
    let mut bundle = valid_bundle();
    bundle.plugins[0].mcp_servers[0] = SessionMcpServer::Stdio(SessionMcpStdioServer {
        connection_id: "conn_github".to_string(),
        catalog_entry_id: Some("github".to_string()),
        server_name: "github".to_string(),
        command: "github-mcp".to_string(),
        args: Vec::new(),
        env: vec![SessionMcpEnvVar {
            name: " ".to_string(),
            value: "secret".to_string(),
        }],
    });

    assert_error_contains(&bundle, "MCP env name is required");
}

fn assert_error_contains(bundle: &SessionPluginBundle, expected: &str) {
    let error = validate_session_plugin_bundle(bundle).expect_err("bundle should be invalid");
    assert!(
        error.to_string().contains(expected),
        "expected error to contain {expected:?}, got {error}"
    );
}

fn valid_bundle() -> SessionPluginBundle {
    SessionPluginBundle {
        plugins: vec![SessionPlugin {
            plugin_id: "connector.conn_github".to_string(),
            version: Some("1".to_string()),
            skills: vec![SessionPluginSkill {
                skill_id: "connector.conn_github.triage".to_string(),
                display_name: "GitHub triage".to_string(),
                description: "Inspect GitHub state.".to_string(),
                instructions: "# GitHub triage".to_string(),
                resources: vec![SessionPluginSkillResource {
                    resource_id: "guide".to_string(),
                    display_name: Some("Guide".to_string()),
                    content_type: "text/markdown".to_string(),
                    content: "Use narrow queries.".to_string(),
                }],
                required_mcp_servers: vec!["github".to_string()],
                credential_binding_ids: vec!["conn_github".to_string()],
            }],
            mcp_servers: vec![SessionMcpServer::Http(SessionMcpHttpServer {
                connection_id: "conn_github".to_string(),
                catalog_entry_id: Some("github".to_string()),
                server_name: "github".to_string(),
                url: "https://example.com/mcp".to_string(),
                headers: Vec::new(),
            })],
            mcp_binding_summaries: vec![SessionMcpBindingSummary {
                id: "conn_github".to_string(),
                server_name: "github".to_string(),
                display_name: Some("GitHub".to_string()),
                transport: SessionMcpTransport::Http,
                outcome: SessionMcpBindingOutcome::Applied,
                reason: None,
            }],
            credential_bindings: vec![SessionPluginCredentialBinding {
                id: "conn_github".to_string(),
                display_name: Some("GitHub".to_string()),
                status: SessionPluginCredentialBindingStatus::Ready,
            }],
        }],
    }
}
