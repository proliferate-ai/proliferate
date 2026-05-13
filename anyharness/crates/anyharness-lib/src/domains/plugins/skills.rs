use anyharness_contract::v1::{SessionPluginBundle, SessionPluginSkill};
use serde::Deserialize;
use serde_json::{json, Value};

pub const SKILLS_MCP_SERVER_NAME: &str = "proliferate_skills";
pub const SKILLS_MCP_CONNECTION_ID: &str = "proliferate-skills";

pub fn bundle_has_skills(bundle: &SessionPluginBundle) -> bool {
    bundle
        .plugins
        .iter()
        .any(|plugin| !plugin.skills.is_empty())
}

pub fn iter_skills(bundle: &SessionPluginBundle) -> impl Iterator<Item = &SessionPluginSkill> {
    bundle
        .plugins
        .iter()
        .flat_map(|plugin| plugin.skills.iter())
}

pub fn render_skill_index(bundle: &SessionPluginBundle) -> Option<String> {
    let skills = iter_skills(bundle).collect::<Vec<_>>();
    if skills.is_empty() {
        return None;
    }

    let mut lines = vec![
        "Proliferate session skills are available through the `proliferate_skills` MCP server."
            .to_string(),
        "Use `list_available_skills` to inspect them and `activate_skill` before relying on a skill's full instructions.".to_string(),
        "Available skills:".to_string(),
    ];
    for skill in skills {
        lines.push(format!(
            "- `{}` ({}) — {}",
            skill.skill_id,
            skill.display_name.trim(),
            skill.description.trim()
        ));
    }
    Some(lines.join("\n"))
}

pub fn list_available_skills(bundle: &SessionPluginBundle) -> Value {
    let skills = iter_skills(bundle)
        .map(|skill| {
            json!({
                "skillId": skill.skill_id,
                "displayName": skill.display_name,
                "description": skill.description,
                "requiredMcpServers": skill.required_mcp_servers,
                "credentialBindingIds": skill.credential_binding_ids,
                "resourceCount": skill.resources.len(),
            })
        })
        .collect::<Vec<_>>();
    json!({ "skills": skills })
}

pub fn activate_skill(bundle: &SessionPluginBundle, skill_id: &str) -> anyhow::Result<Value> {
    let skill =
        find_skill(bundle, skill_id).ok_or_else(|| anyhow::anyhow!("unknown skill: {skill_id}"))?;
    Ok(json!({
        "skillId": skill.skill_id,
        "displayName": skill.display_name,
        "description": skill.description,
        "instructions": skill.instructions,
        "requiredMcpServers": skill.required_mcp_servers,
        "credentialBindingIds": skill.credential_binding_ids,
        "resources": skill.resources.iter().map(|resource| json!({
            "resourceId": resource.resource_id,
            "displayName": resource.display_name,
            "contentType": resource.content_type,
        })).collect::<Vec<_>>(),
    }))
}

pub fn get_skill_resource(
    bundle: &SessionPluginBundle,
    skill_id: &str,
    resource_id: &str,
) -> anyhow::Result<Value> {
    let skill =
        find_skill(bundle, skill_id).ok_or_else(|| anyhow::anyhow!("unknown skill: {skill_id}"))?;
    let resource = skill
        .resources
        .iter()
        .find(|candidate| candidate.resource_id == resource_id)
        .ok_or_else(|| anyhow::anyhow!("unknown resource: {skill_id}/{resource_id}"))?;
    Ok(json!({
        "skillId": skill.skill_id,
        "resourceId": resource.resource_id,
        "displayName": resource.display_name,
        "contentType": resource.content_type,
        "content": resource.content,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateSkillArgs {
    pub skill_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSkillResourceArgs {
    pub skill_id: String,
    pub resource_id: String,
}

fn find_skill<'a>(
    bundle: &'a SessionPluginBundle,
    skill_id: &str,
) -> Option<&'a SessionPluginSkill> {
    iter_skills(bundle).find(|skill| skill.skill_id == skill_id)
}

#[cfg(test)]
mod tests {
    use anyharness_contract::v1::{
        SessionPlugin, SessionPluginBundle, SessionPluginSkill, SessionPluginSkillResource,
    };

    use super::{activate_skill, get_skill_resource, list_available_skills, render_skill_index};

    #[test]
    fn renders_skill_index_and_lists_skills() {
        let bundle = bundle();

        let index = render_skill_index(&bundle).expect("index should render");
        assert!(index.contains("connector.conn_github.triage"));

        let listed = list_available_skills(&bundle);
        assert_eq!(
            listed["skills"][0]["skillId"],
            "connector.conn_github.triage"
        );
    }

    #[test]
    fn activates_skill_without_resource_content() {
        let activated = activate_skill(&bundle(), "connector.conn_github.triage")
            .expect("skill should activate");

        assert_eq!(activated["instructions"], "# GitHub triage");
        assert_eq!(activated["resources"][0]["resourceId"], "guide");
        assert!(activated["resources"][0].get("content").is_none());
    }

    #[test]
    fn loads_skill_resource_content() {
        let resource = get_skill_resource(&bundle(), "connector.conn_github.triage", "guide")
            .expect("resource should load");

        assert_eq!(resource["content"], "Use narrow queries.");
    }

    #[test]
    fn fails_closed_for_unknown_skill_or_resource() {
        assert!(activate_skill(&bundle(), "missing").is_err());
        assert!(get_skill_resource(&bundle(), "connector.conn_github.triage", "missing").is_err());
    }

    fn bundle() -> SessionPluginBundle {
        SessionPluginBundle {
            plugins: vec![SessionPlugin {
                plugin_id: "connector.conn_github".to_string(),
                version: Some("1".to_string()),
                mcp_servers: Vec::new(),
                mcp_binding_summaries: Vec::new(),
                credential_bindings: Vec::new(),
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
            }],
        }
    }
}
