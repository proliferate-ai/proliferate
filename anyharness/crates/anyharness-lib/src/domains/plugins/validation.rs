use std::collections::HashSet;

use anyharness_contract::v1::{SessionMcpServer, SessionPluginBundle};

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
    let mut names = HashSet::new();
    for server in mcp_servers {
        let server_name = session_mcp_server_name(server).trim();
        if server_name.is_empty() {
            return Err(invalid(format!(
                "MCP server name is required for plugin {plugin_id}"
            )));
        }
        if !names.insert(server_name.to_string()) {
            return Err(invalid(format!(
                "duplicate MCP server name {server_name} for plugin {plugin_id}"
            )));
        }
    }
    Ok(names)
}

fn validate_credential_bindings(
    plugin_id: &str,
    plugin: &anyharness_contract::v1::SessionPlugin,
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
mod tests {
    use anyharness_contract::v1::{
        SessionMcpBindingOutcome, SessionMcpBindingSummary, SessionMcpHttpServer, SessionMcpServer,
        SessionMcpTransport, SessionPlugin, SessionPluginBundle, SessionPluginCredentialBinding,
        SessionPluginCredentialBindingStatus, SessionPluginSkill, SessionPluginSkillResource,
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
}
