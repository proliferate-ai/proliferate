use anyharness_contract::v1::{
    WorkspaceSessionLaunchControl, WorkspaceSessionLaunchControlKey,
    WorkspaceSessionLaunchControlPhase, WorkspaceSessionLaunchControlValue,
};

use crate::domains::agents::model::{ResolvedAgentStatus, SessionDefaultControlMetadata};
use crate::domains::agents::registry::built_in_registry;
use crate::domains::agents::resolver::resolve_agent;

use super::SessionService;

const EFFECTIVE_SESSION_LAUNCH_WORKSPACE_ID: &str = "";

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchModelData {
    pub id: String,
    pub display_name: String,
    pub is_default: bool,
    pub launch_controls: Vec<WorkspaceSessionLaunchControl>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchAgentData {
    pub kind: String,
    pub display_name: String,
    pub default_model_id: Option<String>,
    pub launch_controls: Vec<WorkspaceSessionLaunchControl>,
    pub models: Vec<WorkspaceSessionLaunchModelData>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceSessionLaunchCatalogData {
    pub workspace_id: String,
    pub catalog_version: String,
    pub agents: Vec<WorkspaceSessionLaunchAgentData>,
}

impl SessionService {
    pub fn get_workspace_session_launch_catalog(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceSessionLaunchCatalogData> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;

        self.session_launch_catalog_data(workspace_id)
    }

    pub fn get_effective_session_launch_catalog(
        &self,
    ) -> anyhow::Result<WorkspaceSessionLaunchCatalogData> {
        self.session_launch_catalog_data(EFFECTIVE_SESSION_LAUNCH_WORKSPACE_ID)
    }

    fn session_launch_catalog_data(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<WorkspaceSessionLaunchCatalogData> {
        let registry = built_in_registry();
        let launch_catalog = self.launch_catalog_service.snapshot();
        let agents = self
            .model_catalog_service
            .registries()
            .into_iter()
            .filter_map(|model_registry| {
                let descriptor = registry
                    .iter()
                    .find(|d| d.kind.as_str() == model_registry.kind)?;
                let resolved = resolve_agent(descriptor, &self.runtime_home);
                if resolved.status != ResolvedAgentStatus::Ready {
                    return None;
                }
                let launch_agent = launch_catalog
                    .agents
                    .iter()
                    .find(|agent| agent.kind == model_registry.kind);

                Some(WorkspaceSessionLaunchAgentData {
                    kind: model_registry.kind.clone(),
                    display_name: model_registry.display_name.clone(),
                    default_model_id: model_registry.default_model_id.clone(),
                    launch_controls: launch_agent
                        .map(|agent| agent.launch_controls.clone())
                        .unwrap_or_else(|| launch_controls_for_agent(model_registry.kind.as_str())),
                    models: model_registry
                        .models
                        .into_iter()
                        .map(|model| {
                            let catalog_controls = launch_agent
                                .and_then(|agent| {
                                    agent
                                        .models
                                        .iter()
                                        .find(|candidate| candidate.id == model.id)
                                })
                                .map(|model| model.launch_controls.clone())
                                .unwrap_or_default();
                            WorkspaceSessionLaunchModelData {
                                launch_controls: merge_launch_controls(
                                    catalog_controls,
                                    model_session_default_controls_to_launch_controls(
                                        model.session_default_controls,
                                    ),
                                ),
                                id: model.id,
                                display_name: model.display_name,
                                is_default: model.is_default,
                            }
                        })
                        .collect(),
                })
            })
            .collect();

        Ok(WorkspaceSessionLaunchCatalogData {
            workspace_id: workspace_id.to_string(),
            catalog_version: launch_catalog.catalog_version,
            agents,
        })
    }
}

fn launch_controls_for_agent(agent_kind: &str) -> Vec<WorkspaceSessionLaunchControl> {
    match agent_kind {
        "claude" => vec![mode_control(
            "Permissions",
            vec![
                control_value("default", "Default", Some("Ask before each action."), true),
                control_value(
                    "acceptEdits",
                    "Accept Edits",
                    Some("Auto-approve file edits."),
                    false,
                ),
                control_value("plan", "Plan", Some("Plan without execution."), false),
                control_value(
                    "dontAsk",
                    "Don't Ask",
                    Some("Auto-approve most actions."),
                    false,
                ),
                control_value(
                    "bypassPermissions",
                    "Bypass",
                    Some("Skip permission checks."),
                    false,
                ),
            ],
        )],
        "codex" => vec![
            mode_control(
                "Permissions",
                vec![
                    control_value(
                        "read-only",
                        "Read Only",
                        Some("Inspect and plan without editing."),
                        true,
                    ),
                    control_value("auto", "Auto", Some("Auto-approve standard edits."), false),
                    control_value(
                        "full-access",
                        "Full Access",
                        Some("Allow unrestricted changes."),
                        false,
                    ),
                ],
            ),
            WorkspaceSessionLaunchControl {
                key: WorkspaceSessionLaunchControlKey::CollaborationMode,
                label: "Mode".to_string(),
                control_type: "select".to_string(),
                default_value: Some("default".to_string()),
                values: vec![
                    control_value(
                        "default",
                        "Default",
                        Some("Standard collaboration behavior."),
                        true,
                    ),
                    control_value("plan", "Plan", Some("Plan before applying changes."), false),
                ],
                phase: WorkspaceSessionLaunchControlPhase::LiveDefault,
                create_field: None,
            },
        ],
        "gemini" => vec![mode_control(
            "Permissions",
            vec![
                control_value("default", "Default", Some("Ask before each action."), true),
                control_value("autoEdit", "Auto Edit", Some("Auto-approve edits."), false),
                control_value("yolo", "YOLO", Some("Skip permission checks."), false),
                control_value("plan", "Plan", Some("Plan without execution."), false),
            ],
        )],
        _ => vec![],
    }
}

fn mode_control(
    label: &str,
    values: Vec<WorkspaceSessionLaunchControlValue>,
) -> WorkspaceSessionLaunchControl {
    let default_value = values
        .iter()
        .find(|value| value.is_default)
        .map(|value| value.value.clone());
    WorkspaceSessionLaunchControl {
        key: WorkspaceSessionLaunchControlKey::Mode,
        label: label.to_string(),
        control_type: "select".to_string(),
        default_value,
        values,
        phase: WorkspaceSessionLaunchControlPhase::CreateSession,
        create_field: Some("modeId".to_string()),
    }
}

fn control_value(
    value: &str,
    label: &str,
    description: Option<&str>,
    is_default: bool,
) -> WorkspaceSessionLaunchControlValue {
    WorkspaceSessionLaunchControlValue {
        value: value.to_string(),
        label: label.to_string(),
        description: description.map(str::to_string),
        is_default,
    }
}

fn model_session_default_controls_to_launch_controls(
    controls: Vec<SessionDefaultControlMetadata>,
) -> Vec<WorkspaceSessionLaunchControl> {
    controls
        .into_iter()
        .map(|control| {
            let key = match control.key {
                crate::domains::agents::model::SessionDefaultControlKey::Reasoning => {
                    WorkspaceSessionLaunchControlKey::Reasoning
                }
                crate::domains::agents::model::SessionDefaultControlKey::Effort => {
                    WorkspaceSessionLaunchControlKey::Effort
                }
                crate::domains::agents::model::SessionDefaultControlKey::FastMode => {
                    WorkspaceSessionLaunchControlKey::FastMode
                }
            };
            WorkspaceSessionLaunchControl {
                key,
                label: control.label,
                control_type: "select".to_string(),
                default_value: control.default_value,
                values: control
                    .values
                    .into_iter()
                    .map(|value| WorkspaceSessionLaunchControlValue {
                        value: value.value,
                        label: value.label,
                        description: value.description,
                        is_default: value.is_default,
                    })
                    .collect(),
                phase: WorkspaceSessionLaunchControlPhase::LiveDefault,
                create_field: None,
            }
        })
        .collect()
}

fn merge_launch_controls(
    mut primary: Vec<WorkspaceSessionLaunchControl>,
    fallback: Vec<WorkspaceSessionLaunchControl>,
) -> Vec<WorkspaceSessionLaunchControl> {
    for control in fallback {
        if primary.iter().any(|existing| existing.key == control.key) {
            continue;
        }
        primary.push(control);
    }
    primary
}
