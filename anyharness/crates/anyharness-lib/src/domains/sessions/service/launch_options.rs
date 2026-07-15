//! The launch-options menu: which agents this workspace can launch right
//! now, and which models their menus show. Derived per request by joining
//! the ACTIVE catalog (the menu source), agent readiness (is it launchable),
//! and classified auth contexts (which models are unlocked) — the same
//! classification create_session applies, so the menu never advertises a
//! selection that create would reject.

use std::collections::BTreeMap;
use std::path::Path;

use super::SessionService;
use crate::domains::agents::auth::context::{classify, ActiveAuthContexts};
use crate::domains::agents::auth::launch_facts::collect_launch_env_facts;
use crate::domains::agents::catalog::gateway_resolver;
use crate::domains::agents::catalog::schema::{
    AgentCatalogModelControl, AgentCatalogSessionControl,
};
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedLiveModelEffortCandidate,
    ResolvedModelEffort, ResolvedWorkspaceLaunchOptions,
};
use crate::domains::agents::readiness::service::resolve_launch_agent;
use crate::domains::agents::registry;
use crate::domains::workspaces::env::read_materialized_launch_env;

fn projected_model_effort(
    model_controls: &BTreeMap<String, AgentCatalogModelControl>,
) -> Option<ResolvedModelEffort> {
    model_controls
        .get("effort")
        .or_else(|| model_controls.get("reasoning_effort"))
        .map(|control| ResolvedModelEffort {
            values: control.values.clone(),
            default: control.observed_value.clone(),
        })
}

fn live_model_effort_candidates(
    model_controls: &BTreeMap<String, AgentCatalogModelControl>,
    session_controls: &[AgentCatalogSessionControl],
) -> Vec<ResolvedLiveModelEffortCandidate> {
    ["effort", "reasoning_effort"]
        .iter()
        .filter_map(|key| {
            let control = model_controls.get(*key)?;
            let live_config_id = session_controls
                .iter()
                .find(|candidate| candidate.key == *key)
                .and_then(|candidate| candidate.mapping.as_ref())
                .and_then(|mapping| mapping.live_config_id.clone())?;
            Some(ResolvedLiveModelEffortCandidate {
                control_key: (*key).to_string(),
                values: control.values.clone(),
                live_config_id,
            })
        })
        .collect()
}

impl SessionService {
    /// Is `value` a model this session may switch to? The current catalog
    /// authorizes an id, alias, or variant only when it is available under the
    /// auth contexts recorded at session creation. Sessions without recorded
    /// contexts authorize nothing extra; advertised options still govern.
    pub fn live_model_switch_authorized(
        &self,
        record: &crate::domains::sessions::model::SessionRecord,
        value: &str,
    ) -> bool {
        let Some(context_ids) = record
            .agent_auth_contexts
            .as_deref()
            .and_then(|json| serde_json::from_str::<Vec<String>>(json).ok())
        else {
            return false;
        };
        let contexts = ActiveAuthContexts::from_ids(context_ids);
        self.catalog_service
            .active_catalog()
            .validate_launch(&record.agent_kind, &contexts, Some(value), None)
            .is_ok()
    }

    pub fn resolved_workspace_launch_options(
        &self,
        workspace_id: Option<&str>,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        let workspace_env = match workspace_id {
            Some(workspace_id) => {
                let workspace = self
                    .workspace_store
                    .find_by_id(workspace_id)?
                    .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
                read_materialized_launch_env(&self.runtime_home, Path::new(&workspace.path))
                    .unwrap_or_default()
            }
            None => BTreeMap::new(),
        };

        let catalog = self.catalog_service.active_catalog();
        let mut agents = Vec::new();
        for agent in catalog.agents() {
            let Some(descriptor) = registry::descriptor(&agent.kind) else {
                continue;
            };

            // Same env composition as create_session.
            let readiness_env = workspace_env.clone();

            // Launch-time readiness: the menu must agree with create_session,
            // so it uses the same route-aware readiness (issue #1106) — a
            // gateway/api_key-routed agent is launchable and stays in the menu.
            let resolved = resolve_launch_agent(&descriptor, &self.runtime_home, &readiness_env);
            if resolved.status != ResolvedAgentStatus::Ready {
                continue;
            }

            let facts = collect_launch_env_facts(&agent.kind, &readiness_env, &self.runtime_home);
            let active = classify(&descriptor, &agent.auth_contexts, &facts);
            let default_model_id = catalog
                .validate_launch(&agent.kind, &active, None, None)
                .ok()
                .and_then(|selection| selection.model_id);

            agents.push(ResolvedLaunchAgentOption {
                kind: agent.kind.clone(),
                display_name: agent.display_name.clone(),
                default_model_id: default_model_id.clone(),
                models: catalog
                    .visible_models(&agent.kind, &active)
                    .into_iter()
                    .map(|model| ResolvedLaunchModelOption {
                        id: model.id.clone(),
                        display_name: model.display_name.clone(),
                        aliases: model.aliases.clone(),
                        is_default: default_model_id.as_deref() == Some(model.id.as_str()),
                        default_opt_in: None,
                        description: model.description.clone(),
                        provider: gateway_resolver::provider_for_model(&model.id)
                            .map(str::to_string),
                        status: Some(model.status),
                        effort: projected_model_effort(&model.controls),
                        live_effort_candidates: live_model_effort_candidates(
                            &model.controls,
                            &agent.session.controls,
                        ),
                        fast_mode: model.controls.contains_key("fast_mode"),
                        modes: model
                            .controls
                            .get("mode")
                            .map(|control| control.values.clone()),
                    })
                    .collect(),
            });
        }

        Ok(ResolvedWorkspaceLaunchOptions { agents })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::catalog::schema::AgentCatalogControlMapping;

    fn model_control(value: &str) -> AgentCatalogModelControl {
        AgentCatalogModelControl {
            values: vec![value.to_string()],
            default: None,
            observed_value: Some(value.to_string()),
        }
    }

    fn session_control(key: &str, live_config_id: Option<&str>) -> AgentCatalogSessionControl {
        AgentCatalogSessionControl {
            key: key.to_string(),
            label: None,
            values: Vec::new(),
            mapping: Some(AgentCatalogControlMapping {
                create_field: None,
                live_config_id: live_config_id.map(str::to_string),
                switch_via: None,
                variant_syntax: None,
                missing_live_config_policy: None,
            }),
        }
    }

    #[test]
    fn public_effort_projection_is_unchanged_while_live_candidates_skip_unmapped_keys() {
        let model_controls = BTreeMap::from([
            ("effort".to_string(), model_control("high")),
            ("reasoning_effort".to_string(), model_control("xhigh")),
        ]);
        let mut session_controls = vec![
            session_control("effort", None),
            session_control("reasoning_effort", Some("reasoning_effort")),
        ];

        let projected = projected_model_effort(&model_controls).expect("public projection");
        assert_eq!(projected.values, vec!["high"]);
        assert_eq!(projected.default.as_deref(), Some("high"));

        let candidates = live_model_effort_candidates(&model_controls, &session_controls);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].control_key, "reasoning_effort");
        assert_eq!(candidates[0].values, vec!["xhigh"]);
        assert_eq!(candidates[0].live_config_id, "reasoning_effort");

        session_controls[1].mapping = None;
        assert!(live_model_effort_candidates(&model_controls, &session_controls).is_empty());
        assert_eq!(
            projected_model_effort(&model_controls)
                .expect("public projection remains")
                .values,
            vec!["high"]
        );
    }
}
