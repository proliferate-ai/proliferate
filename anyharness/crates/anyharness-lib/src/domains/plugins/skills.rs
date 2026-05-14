use anyharness_contract::v1::{
    SessionPlugin, SessionPluginBundle, SessionPluginSkill, SessionPluginSkillResource,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub const SKILLS_MCP_SERVER_NAME: &str = "proliferate_skills";
pub const SKILLS_MCP_CONNECTION_ID: &str = "proliferate-skills";
pub const PRODUCT_SKILLS_PLUGIN_ID: &str = "proliferate.product.skills";
pub const SUBAGENTS_WORKFLOW_SKILL_ID: &str = "proliferate.subagents.workflow";

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

pub fn effective_bundle_with_product_skills(
    mut bundle: SessionPluginBundle,
    product_skills: Vec<SessionPluginSkill>,
) -> SessionPluginBundle {
    if !product_skills.is_empty() {
        bundle.plugins.push(SessionPlugin {
            plugin_id: PRODUCT_SKILLS_PLUGIN_ID.to_string(),
            version: Some("1".to_string()),
            mcp_servers: Vec::new(),
            mcp_binding_summaries: Vec::new(),
            credential_bindings: Vec::new(),
            skills: product_skills,
        });
    }
    bundle
}

pub fn product_skills_for_session(subagents_enabled: bool) -> Vec<SessionPluginSkill> {
    let mut skills = Vec::new();
    if subagents_enabled {
        skills.push(subagents_workflow_skill());
    }
    skills
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

fn subagents_workflow_skill() -> SessionPluginSkill {
    SessionPluginSkill {
        skill_id: SUBAGENTS_WORKFLOW_SKILL_ID.to_string(),
        display_name: "Subagent workflow".to_string(),
        description:
            "Delegate bounded work to same-workspace subagents and read their results safely."
                .to_string(),
        instructions: SUBAGENTS_WORKFLOW_INSTRUCTIONS.to_string(),
        resources: vec![SessionPluginSkillResource {
            resource_id: "tool-flow".to_string(),
            display_name: Some("Subagent tool flow".to_string()),
            content_type: "text/markdown".to_string(),
            content: SUBAGENTS_WORKFLOW_TOOL_FLOW.to_string(),
        }],
        required_mcp_servers: vec!["subagents".to_string()],
        credential_binding_ids: Vec::new(),
    }
}

const SUBAGENTS_WORKFLOW_INSTRUCTIONS: &str = r#"# Subagent Workflow

Use subagents for bounded, parallel work where the child can produce a concrete result without needing your immediate next decision.

Default flow:

1. Call `get_subagent_launch_options` before choosing a non-default `harnessId` or `initialConfig`.
2. Call `create_subagent` with a short `label`, the full authored `prompt`, and `wakeOnCompletion: true` when you want to be prompted after the next child completion.
3. Use the returned `subagentId` as the handle for later calls. Legacy `childSessionId` fields are compatibility details.
4. Prefer `read_subagent_latest_turns` for normal result reads.
5. Use `search_subagent_transcript` when you need to find a specific mention.
6. Use `read_subagent_events` only for bounded debugging.
7. Call `close_subagent` when the child is no longer useful.

Keep delegated tasks narrow. Do not send a subagent work that depends on hidden context it cannot access. When reporting a child result, read it first and cite the child label or `subagentId`.
"#;

const SUBAGENTS_WORKFLOW_TOOL_FLOW: &str = r#"# Subagent Tool Flow

`create_subagent` starts a same-workspace child session and returns `subagentId`, `label`, applied config, prompt status, wake status, and a recommended read cursor.

`send_subagent_message` sends or queues follow-up work. `wakeOnCompletion` is next-completion scoped: it prevents missed wakes after arming, but it is not a per-prompt completion guarantee if the child is already running.

`read_subagent_latest_turns` is the normal result reader. `search_subagent_transcript` is the grep path. `read_subagent_events` is the raw bounded debug path.
"#;

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
