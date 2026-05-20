use std::collections::{HashMap, HashSet};

use anyharness_contract::v1::{SessionMcpBindingOutcome, SessionMcpTransport};

use crate::domains::plugins::{
    SessionPlugin, SessionPluginBundle, SessionPluginCredentialBindingStatus,
};
use crate::sessions::mcp_bindings::model::SessionMcpServer;
use crate::sessions::mcp_bindings::summaries::validate_binding_summaries;

#[derive(Debug, thiserror::Error)]
pub enum SessionPluginBundleValidationError {
    #[error("{0}")]
    Invalid(String),
}

const MAX_PLUGINS: usize = 64;
const MAX_PLUGIN_ID_LEN: usize = 160;
const MAX_SKILLS: usize = 256;
const MAX_SKILL_ID_LEN: usize = 220;
const MAX_DISPLAY_NAME_LEN: usize = 160;
const MAX_DESCRIPTION_LEN: usize = 1_000;
const MAX_INSTRUCTIONS_LEN: usize = 64_000;
const MAX_RESOURCES_PER_SKILL: usize = 32;
const MAX_RESOURCE_ID_LEN: usize = 160;
const MAX_RESOURCE_CONTENT_TYPE_LEN: usize = 160;
const MAX_RESOURCE_CONTENT_LEN: usize = 128_000;
const MAX_CREDENTIAL_BINDINGS_PER_PLUGIN: usize = 32;
const MAX_CREDENTIAL_BINDING_ID_LEN: usize = 160;
const MAX_MCP_SERVERS_PER_PLUGIN: usize = 64;
const MAX_MCP_CONNECTION_ID_LEN: usize = 160;
const MAX_MCP_SERVER_NAME_LEN: usize = 160;
const MAX_MCP_URL_LEN: usize = 4_096;
const MAX_MCP_HEADERS: usize = 64;
const MAX_MCP_HEADER_NAME_LEN: usize = 160;
const MAX_MCP_HEADER_VALUE_LEN: usize = 8_192;
const MAX_MCP_COMMAND_LEN: usize = 1_024;
const MAX_MCP_ARGS: usize = 128;
const MAX_MCP_ARG_LEN: usize = 4_096;
const MAX_MCP_ENV: usize = 128;
const MAX_MCP_ENV_NAME_LEN: usize = 160;
const MAX_MCP_ENV_VALUE_LEN: usize = 8_192;
const RESERVED_MCP_SERVER_NAMES: &[&str] = &[
    "cowork",
    "proliferate_skills",
    "reviews",
    "subagents",
    "workspace_naming",
];

pub fn validate_session_plugin_bundle(
    bundle: &SessionPluginBundle,
) -> Result<(), SessionPluginBundleValidationError> {
    if bundle.plugins.len() > MAX_PLUGINS {
        return Err(invalid(format!(
            "plugin bundle has too many plugins: {}",
            bundle.plugins.len()
        )));
    }

    let mut plugin_ids = HashSet::new();
    let mut skill_ids = HashSet::new();
    let mut bundle_mcp_server_names = HashSet::new();
    let mut total_skills = 0usize;

    for plugin in &bundle.plugins {
        let plugin_id = plugin.plugin_id.trim();
        if plugin_id.is_empty() {
            return Err(invalid("plugin id is required"));
        }
        validate_len("plugin id", plugin_id, MAX_PLUGIN_ID_LEN)?;
        if !plugin_ids.insert(plugin_id.to_string()) {
            return Err(invalid(format!("duplicate plugin id: {plugin_id}")));
        }
        if plugin.mcp_servers.len() > MAX_MCP_SERVERS_PER_PLUGIN {
            return Err(invalid(format!(
                "plugin {plugin_id} has too many MCP servers: {}",
                plugin.mcp_servers.len()
            )));
        }
        validate_binding_summaries(&plugin.mcp_binding_summaries).map_err(|error| {
            invalid(format!(
                "invalid MCP binding summary for plugin {plugin_id}: {error}"
            ))
        })?;
        let mcp_server_names = validate_mcp_servers(plugin_id, &plugin.mcp_servers)?;
        validate_mcp_binding_summary_consistency(plugin_id, plugin, &mcp_server_names)?;
        for server_name in &mcp_server_names {
            if RESERVED_MCP_SERVER_NAMES.contains(&server_name.as_str()) {
                return Err(invalid(format!(
                    "plugin {plugin_id} uses reserved MCP server name: {server_name}"
                )));
            }
            if !bundle_mcp_server_names.insert(server_name.clone()) {
                return Err(invalid(format!(
                    "duplicate MCP server name across plugin bundle: {server_name}"
                )));
            }
        }
        let credential_binding_ids = validate_credential_bindings(plugin_id, plugin)?;

        for skill in &plugin.skills {
            total_skills += 1;
            if total_skills > MAX_SKILLS {
                return Err(invalid(format!(
                    "plugin bundle has too many skills: {total_skills}"
                )));
            }
            let skill_id = skill.skill_id.trim();
            if skill_id.is_empty() {
                return Err(invalid(format!(
                    "skill id is required for plugin {plugin_id}"
                )));
            }
            validate_len("skill id", skill_id, MAX_SKILL_ID_LEN)?;
            if !skill_ids.insert(skill_id.to_string()) {
                return Err(invalid(format!("duplicate skill id: {skill_id}")));
            }
            if skill.display_name.trim().is_empty() {
                return Err(invalid(format!(
                    "skill display name is required for {skill_id}"
                )));
            }
            validate_len(
                "skill display name",
                skill.display_name.trim(),
                MAX_DISPLAY_NAME_LEN,
            )?;
            if skill.description.trim().is_empty() {
                return Err(invalid(format!(
                    "skill description is required for {skill_id}"
                )));
            }
            validate_len(
                "skill description",
                skill.description.trim(),
                MAX_DESCRIPTION_LEN,
            )?;
            if skill.instructions.trim().is_empty() {
                return Err(invalid(format!(
                    "skill instructions are required for {skill_id}"
                )));
            }
            validate_len(
                "skill instructions",
                skill.instructions.trim(),
                MAX_INSTRUCTIONS_LEN,
            )?;
            validate_skill_references(
                plugin_id,
                skill_id,
                &skill.required_mcp_servers,
                &mcp_server_names,
                &skill.credential_binding_ids,
                &credential_binding_ids,
            )?;
            if skill.resources.len() > MAX_RESOURCES_PER_SKILL {
                return Err(invalid(format!(
                    "skill {skill_id} has too many resources: {}",
                    skill.resources.len()
                )));
            }
            let mut resource_ids = HashSet::new();
            for resource in &skill.resources {
                let resource_id = resource.resource_id.trim();
                if resource_id.is_empty() {
                    return Err(invalid(format!(
                        "resource id is required for skill {skill_id}"
                    )));
                }
                validate_len("resource id", resource_id, MAX_RESOURCE_ID_LEN)?;
                if !resource_ids.insert(resource_id.to_string()) {
                    return Err(invalid(format!(
                        "duplicate resource id {resource_id} for skill {skill_id}"
                    )));
                }
                if resource.content_type.trim().is_empty() {
                    return Err(invalid(format!(
                        "resource content type is required for {skill_id}/{resource_id}"
                    )));
                }
                validate_len(
                    "resource content type",
                    resource.content_type.trim(),
                    MAX_RESOURCE_CONTENT_TYPE_LEN,
                )?;
                validate_len(
                    "resource content",
                    resource.content.as_str(),
                    MAX_RESOURCE_CONTENT_LEN,
                )?;
            }
        }
    }

    Ok(())
}

fn validate_mcp_servers(
    plugin_id: &str,
    mcp_servers: &[SessionMcpServer],
) -> Result<HashSet<String>, SessionPluginBundleValidationError> {
    let mut connection_ids = HashSet::new();
    let mut names = HashSet::new();
    for server in mcp_servers {
        let connection_id = session_mcp_connection_id(server).trim();
        if connection_id.is_empty() {
            return Err(invalid(format!(
                "MCP connection id is required for plugin {plugin_id}"
            )));
        }
        validate_text_field(
            "MCP connection id",
            connection_id,
            MAX_MCP_CONNECTION_ID_LEN,
        )?;
        if !connection_ids.insert(connection_id.to_string()) {
            return Err(invalid(format!(
                "duplicate MCP connection id {connection_id} for plugin {plugin_id}"
            )));
        }
        let server_name = session_mcp_server_name(server).trim();
        if server_name.is_empty() {
            return Err(invalid(format!(
                "MCP server name is required for plugin {plugin_id}"
            )));
        }
        validate_text_field("MCP server name", server_name, MAX_MCP_SERVER_NAME_LEN)?;
        if !names.insert(server_name.to_string()) {
            return Err(invalid(format!(
                "duplicate MCP server name {server_name} for plugin {plugin_id}"
            )));
        }
        match server {
            SessionMcpServer::Http(server) => {
                let url = server.url.trim();
                if !(url.starts_with("https://") || url.starts_with("http://")) {
                    return Err(invalid(format!(
                        "HTTP MCP server URL must use http or https for plugin {plugin_id}"
                    )));
                }
                validate_text_field("HTTP MCP server URL", url, MAX_MCP_URL_LEN)?;
                if server.headers.len() > MAX_MCP_HEADERS {
                    return Err(invalid(format!(
                        "MCP server {server_name} has too many headers: {}",
                        server.headers.len()
                    )));
                }
                for header in &server.headers {
                    let name = header.name.trim();
                    if name.is_empty() {
                        return Err(invalid(format!(
                            "MCP header name is required for server {server_name}"
                        )));
                    }
                    validate_text_field("MCP header name", name, MAX_MCP_HEADER_NAME_LEN)?;
                    validate_len(
                        "MCP header value",
                        header.value.as_str(),
                        MAX_MCP_HEADER_VALUE_LEN,
                    )?;
                }
            }
            SessionMcpServer::Stdio(server) => {
                let command = server.command.trim();
                if command.is_empty() {
                    return Err(invalid(format!(
                        "stdio MCP command is required for plugin {plugin_id}"
                    )));
                }
                validate_text_field("stdio MCP command", command, MAX_MCP_COMMAND_LEN)?;
                if server.args.len() > MAX_MCP_ARGS {
                    return Err(invalid(format!(
                        "MCP server {server_name} has too many args: {}",
                        server.args.len()
                    )));
                }
                for arg in &server.args {
                    validate_text_field("stdio MCP arg", arg.as_str(), MAX_MCP_ARG_LEN)?;
                }
                if server.env.len() > MAX_MCP_ENV {
                    return Err(invalid(format!(
                        "MCP server {server_name} has too many env vars: {}",
                        server.env.len()
                    )));
                }
                for variable in &server.env {
                    let name = variable.name.trim();
                    if name.is_empty() {
                        return Err(invalid(format!(
                            "MCP env name is required for server {server_name}"
                        )));
                    }
                    validate_text_field("MCP env name", name, MAX_MCP_ENV_NAME_LEN)?;
                    validate_len(
                        "MCP env value",
                        variable.value.as_str(),
                        MAX_MCP_ENV_VALUE_LEN,
                    )?;
                }
            }
        }
    }
    Ok(names)
}

fn validate_mcp_binding_summary_consistency(
    plugin_id: &str,
    plugin: &SessionPlugin,
    mcp_server_names: &HashSet<String>,
) -> Result<(), SessionPluginBundleValidationError> {
    if plugin.mcp_binding_summaries.len() != plugin.mcp_servers.len() {
        return Err(invalid(format!(
            "plugin {plugin_id} must include one applied MCP binding summary per MCP server"
        )));
    }
    let mcp_servers_by_connection_id: HashMap<String, (&str, SessionMcpTransport)> = plugin
        .mcp_servers
        .iter()
        .map(|server| {
            (
                session_mcp_connection_id(server).trim().to_string(),
                (
                    session_mcp_server_name(server).trim(),
                    session_mcp_transport(server),
                ),
            )
        })
        .collect();
    let mut summary_ids = HashSet::new();
    for summary in &plugin.mcp_binding_summaries {
        if summary.outcome != SessionMcpBindingOutcome::Applied {
            return Err(invalid(format!(
                "plugin {plugin_id} contains non-applied MCP binding summary {}",
                summary.id
            )));
        }
        let summary_id = summary.id.trim();
        if !summary_ids.insert(summary_id.to_string()) {
            return Err(invalid(format!(
                "duplicate MCP binding summary id {summary_id} for plugin {plugin_id}"
            )));
        }
        let Some((server_name, transport)) = mcp_servers_by_connection_id.get(summary_id) else {
            return Err(invalid(format!(
                "plugin {plugin_id} summary references unknown MCP connection {summary_id}"
            )));
        };
        let summary_server_name = summary.server_name.trim();
        if !mcp_server_names.contains(summary_server_name) {
            return Err(invalid(format!(
                "plugin {plugin_id} summary references unknown MCP server {summary_server_name}"
            )));
        }
        if summary_server_name != *server_name {
            return Err(invalid(format!(
                "plugin {plugin_id} summary server name does not match mounted MCP server {summary_id}"
            )));
        }
        if summary.transport != *transport {
            return Err(invalid(format!(
                "plugin {plugin_id} summary transport does not match mounted MCP server {summary_id}"
            )));
        }
    }
    Ok(())
}

fn validate_credential_bindings(
    plugin_id: &str,
    plugin: &SessionPlugin,
) -> Result<HashSet<String>, SessionPluginBundleValidationError> {
    if plugin.credential_bindings.len() > MAX_CREDENTIAL_BINDINGS_PER_PLUGIN {
        return Err(invalid(format!(
            "plugin {plugin_id} has too many credential bindings: {}",
            plugin.credential_bindings.len()
        )));
    }
    let mut ids = HashSet::new();
    for binding in &plugin.credential_bindings {
        let id = binding.id.trim();
        if id.is_empty() {
            return Err(invalid(format!(
                "credential binding id is required for plugin {plugin_id}"
            )));
        }
        validate_len("credential binding id", id, MAX_CREDENTIAL_BINDING_ID_LEN)?;
        if binding.status != SessionPluginCredentialBindingStatus::Ready {
            return Err(invalid(format!(
                "credential binding {id} for plugin {plugin_id} is not ready"
            )));
        }
        if !ids.insert(id.to_string()) {
            return Err(invalid(format!(
                "duplicate credential binding id {id} for plugin {plugin_id}"
            )));
        }
        if let Some(display_name) = binding.display_name.as_deref() {
            validate_len(
                "credential binding display name",
                display_name.trim(),
                MAX_DISPLAY_NAME_LEN,
            )?;
        }
    }
    Ok(ids)
}

fn validate_skill_references(
    plugin_id: &str,
    skill_id: &str,
    required_mcp_servers: &[String],
    mcp_server_names: &HashSet<String>,
    credential_binding_ids: &[String],
    available_credential_binding_ids: &HashSet<String>,
) -> Result<(), SessionPluginBundleValidationError> {
    for server_name in required_mcp_servers {
        let server_name = server_name.trim();
        if server_name.is_empty() {
            return Err(invalid(format!(
                "required MCP server name is blank for skill {skill_id}"
            )));
        }
        if !mcp_server_names.contains(server_name) {
            return Err(invalid(format!(
                "skill {skill_id} references unknown MCP server {server_name} in plugin {plugin_id}"
            )));
        }
    }
    for binding_id in credential_binding_ids {
        let binding_id = binding_id.trim();
        if binding_id.is_empty() {
            return Err(invalid(format!(
                "credential binding reference is blank for skill {skill_id}"
            )));
        }
        if !available_credential_binding_ids.contains(binding_id) {
            return Err(invalid(format!(
                "skill {skill_id} references unknown credential binding {binding_id} in plugin {plugin_id}"
            )));
        }
    }
    Ok(())
}

fn session_mcp_server_name(server: &SessionMcpServer) -> &str {
    match server {
        SessionMcpServer::Http(server) => &server.server_name,
        SessionMcpServer::Stdio(server) => &server.server_name,
    }
}

fn session_mcp_connection_id(server: &SessionMcpServer) -> &str {
    match server {
        SessionMcpServer::Http(server) => &server.connection_id,
        SessionMcpServer::Stdio(server) => &server.connection_id,
    }
}

fn session_mcp_transport(server: &SessionMcpServer) -> SessionMcpTransport {
    match server {
        SessionMcpServer::Http(_) => SessionMcpTransport::Http,
        SessionMcpServer::Stdio(_) => SessionMcpTransport::Stdio,
    }
}

fn validate_text_field(
    field: &str,
    value: &str,
    max: usize,
) -> Result<(), SessionPluginBundleValidationError> {
    validate_len(field, value, max)?;
    if value.chars().any(char::is_control) {
        return Err(invalid(format!("{field} contains control characters")));
    }
    Ok(())
}

fn validate_len(
    field: &str,
    value: &str,
    max: usize,
) -> Result<(), SessionPluginBundleValidationError> {
    if value.len() > max {
        return Err(invalid(format!(
            "{field} is too long: {} > {max}",
            value.len()
        )));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> SessionPluginBundleValidationError {
    SessionPluginBundleValidationError::Invalid(message.into())
}

#[cfg(test)]
#[path = "validation_tests.rs"]
mod tests;
