//! Pure target resolution for schema-v2 workflow intent. Live launch options
//! are fetched by the runtime; this module makes the workflow-owned model,
//! mode, and effort decision without IO or session side effects.

use crate::domains::agents::readiness::launch_options::ResolvedWorkspaceLaunchOptions;
use crate::domains::workflows::model::{
    WorkflowHarnessConfigV2, WorkflowModelSelection, WorkflowResolvedEffortConfig,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowResolutionError {
    AgentUnavailable,
    ModelUnavailable,
    ModeUnavailable,
    EffortUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowResolvedTargetV2 {
    pub agent_kind: String,
    pub model_id: String,
    pub mode_id: String,
    pub effort_config: Option<WorkflowResolvedEffortConfig>,
}

pub fn resolve_workflow_target(
    options: &ResolvedWorkspaceLaunchOptions,
    harness: &WorkflowHarnessConfigV2,
) -> Result<WorkflowResolvedTargetV2, WorkflowResolutionError> {
    let agent = options
        .agents
        .iter()
        .find(|candidate| candidate.kind == harness.agent_kind)
        .ok_or(WorkflowResolutionError::AgentUnavailable)?;

    let model_id = match &harness.model_selection {
        WorkflowModelSelection::Exact { model_id } => model_id.clone(),
        WorkflowModelSelection::TargetDefault => agent
            .default_model_id
            .clone()
            .ok_or(WorkflowResolutionError::ModelUnavailable)?,
    };
    let model = agent
        .models
        .iter()
        .find(|candidate| candidate.id == model_id)
        .ok_or(WorkflowResolutionError::ModelUnavailable)?;

    let mode_id = match harness.agent_kind.as_str() {
        "claude" => "bypassPermissions",
        "codex" => "full-access",
        _ => return Err(WorkflowResolutionError::ModeUnavailable),
    };
    if !model
        .modes
        .as_ref()
        .is_some_and(|modes| modes.iter().any(|mode| mode == mode_id))
    {
        return Err(WorkflowResolutionError::ModeUnavailable);
    }

    let effort_config = match &harness.effort {
        None => None,
        Some(value) => {
            if !matches!(
                harness.model_selection,
                WorkflowModelSelection::Exact { .. }
            ) {
                return Err(WorkflowResolutionError::EffortUnavailable);
            }
            let effort = ["effort", "reasoning_effort"]
                .iter()
                .find_map(|key| {
                    model
                        .live_effort_candidates
                        .iter()
                        .find(|candidate| candidate.control_key == *key)
                })
                .filter(|effort| effort.values.iter().any(|candidate| candidate == value))
                .ok_or(WorkflowResolutionError::EffortUnavailable)?;
            Some(WorkflowResolvedEffortConfig {
                config_id: effort.live_config_id.clone(),
                value: value.clone(),
            })
        }
    };

    Ok(WorkflowResolvedTargetV2 {
        agent_kind: harness.agent_kind.clone(),
        model_id,
        mode_id: mode_id.to_string(),
        effort_config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::readiness::launch_options::{
        ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedLiveModelEffortCandidate,
        ResolvedModelEffort,
    };
    use crate::domains::workflows::model::WorkflowPermissionPolicy;

    fn model(
        id: &str,
        modes: &[&str],
        effort: Option<(&[&str], Option<&str>)>,
    ) -> ResolvedLaunchModelOption {
        ResolvedLaunchModelOption {
            id: id.to_string(),
            display_name: id.to_string(),
            aliases: Vec::new(),
            is_default: false,
            default_opt_in: None,
            description: None,
            provider: None,
            status: None,
            effort: effort.map(|(values, _)| ResolvedModelEffort {
                values: values.iter().map(|value| (*value).to_string()).collect(),
                default: None,
            }),
            live_effort_candidates: effort
                .and_then(|(values, config_id)| {
                    config_id.map(|config_id| ResolvedLiveModelEffortCandidate {
                        control_key: "effort".to_string(),
                        values: values.iter().map(|value| (*value).to_string()).collect(),
                        live_config_id: config_id.to_string(),
                    })
                })
                .into_iter()
                .collect(),
            fast_mode: false,
            modes: Some(modes.iter().map(|mode| (*mode).to_string()).collect()),
        }
    }

    fn options() -> ResolvedWorkspaceLaunchOptions {
        ResolvedWorkspaceLaunchOptions {
            agents: vec![
                ResolvedLaunchAgentOption {
                    kind: "claude".to_string(),
                    display_name: "Claude".to_string(),
                    default_model_id: Some("sonnet".to_string()),
                    models: vec![model(
                        "sonnet",
                        &["bypassPermissions"],
                        Some((&["low", "high"], Some("effort"))),
                    )],
                },
                ResolvedLaunchAgentOption {
                    kind: "codex".to_string(),
                    display_name: "Codex".to_string(),
                    default_model_id: Some("gpt".to_string()),
                    models: vec![model("gpt", &["full-access"], None)],
                },
            ],
        }
    }

    fn harness(
        agent_kind: &str,
        model_selection: WorkflowModelSelection,
    ) -> WorkflowHarnessConfigV2 {
        WorkflowHarnessConfigV2 {
            agent_kind: agent_kind.to_string(),
            model_selection,
            effort: None,
            permission_policy: WorkflowPermissionPolicy::WorkflowDefault,
        }
    }

    #[test]
    fn resolves_target_default_and_workflow_modes() {
        let claude = resolve_workflow_target(
            &options(),
            &harness("claude", WorkflowModelSelection::TargetDefault),
        )
        .expect("claude target");
        assert_eq!(claude.model_id, "sonnet");
        assert_eq!(claude.mode_id, "bypassPermissions");

        let codex = resolve_workflow_target(
            &options(),
            &harness("codex", WorkflowModelSelection::TargetDefault),
        )
        .expect("codex target");
        assert_eq!(codex.model_id, "gpt");
        assert_eq!(codex.mode_id, "full-access");
    }

    #[test]
    fn effort_requires_exact_value_and_same_key_live_mapping() {
        let mut valid = harness(
            "claude",
            WorkflowModelSelection::Exact {
                model_id: "sonnet".to_string(),
            },
        );
        valid.effort = Some("high".to_string());
        let resolved = resolve_workflow_target(&options(), &valid).expect("resolve effort");
        assert_eq!(
            resolved.effort_config,
            Some(WorkflowResolvedEffortConfig {
                config_id: "effort".to_string(),
                value: "high".to_string(),
            })
        );

        let mut no_mapping = options();
        no_mapping.agents[0].models[0]
            .live_effort_candidates
            .clear();
        assert_eq!(
            resolve_workflow_target(&no_mapping, &valid),
            Err(WorkflowResolutionError::EffortUnavailable)
        );
    }

    #[test]
    fn workflow_effort_uses_mapped_fallback_without_changing_public_projection() {
        let mut options = options();
        let model = &mut options.agents[0].models[0];
        model.effort = Some(ResolvedModelEffort {
            values: vec!["high".to_string()],
            default: Some("high".to_string()),
        });
        model.live_effort_candidates = vec![ResolvedLiveModelEffortCandidate {
            control_key: "reasoning_effort".to_string(),
            values: vec!["xhigh".to_string()],
            live_config_id: "reasoning_effort".to_string(),
        }];
        assert_eq!(
            model.effort.as_ref().expect("public effort").values,
            vec!["high"]
        );
        let mut request = harness(
            "claude",
            WorkflowModelSelection::Exact {
                model_id: "sonnet".to_string(),
            },
        );
        request.effort = Some("xhigh".to_string());

        let resolved = resolve_workflow_target(&options, &request).expect("mapped fallback");
        assert_eq!(
            resolved.effort_config,
            Some(WorkflowResolvedEffortConfig {
                config_id: "reasoning_effort".to_string(),
                value: "xhigh".to_string(),
            })
        );

        options.agents[0].models[0].live_effort_candidates.clear();
        assert_eq!(
            resolve_workflow_target(&options, &request),
            Err(WorkflowResolutionError::EffortUnavailable)
        );
    }

    #[test]
    fn rejects_unknown_agent_model_and_missing_mode() {
        assert_eq!(
            resolve_workflow_target(
                &options(),
                &harness("other", WorkflowModelSelection::TargetDefault)
            ),
            Err(WorkflowResolutionError::AgentUnavailable)
        );
        assert_eq!(
            resolve_workflow_target(
                &options(),
                &harness(
                    "claude",
                    WorkflowModelSelection::Exact {
                        model_id: "missing".to_string()
                    }
                )
            ),
            Err(WorkflowResolutionError::ModelUnavailable)
        );

        let mut no_mode = options();
        no_mode.agents[0].models[0].modes = Some(vec!["default".to_string()]);
        assert_eq!(
            resolve_workflow_target(
                &no_mode,
                &harness("claude", WorkflowModelSelection::TargetDefault)
            ),
            Err(WorkflowResolutionError::ModeUnavailable)
        );
    }
}
