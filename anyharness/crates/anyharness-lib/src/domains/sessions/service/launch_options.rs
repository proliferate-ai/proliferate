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
use crate::domains::agents::model::ResolvedAgentStatus;
use crate::domains::agents::catalog::gateway_resolver;
use crate::domains::agents::readiness::launch_options::{
    ResolvedLaunchAgentOption, ResolvedLaunchModelOption, ResolvedModelEffort,
    ResolvedWorkspaceLaunchOptions,
};
use crate::domains::agents::readiness::service::resolve_agent_with_env;
use crate::domains::agents::registry;
use crate::domains::workspaces::env::read_materialized_launch_env;

impl SessionService {
    /// Is `value` a model this SESSION may switch to live? The catalog is
    /// the switch authority (decision 10: same-harness switch never
    /// recreates): a value validates iff the catalog resolves it (id, alias,
    /// or variant) as available under the contexts CLASSIFIED AT CREATE
    /// (recorded provenance). Sessions without recorded contexts (pre-v2
    /// records) authorize nothing extra — the harness-advertised list keeps
    /// governing them.
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

            let resolved = resolve_agent_with_env(&descriptor, &self.runtime_home, &readiness_env);
            if resolved.status != ResolvedAgentStatus::Ready {
                continue;
            }

            let facts = collect_launch_env_facts(&agent.kind, &readiness_env);
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
                        effort: model
                            .controls
                            .get("effort")
                            .or_else(|| model.controls.get("reasoning_effort"))
                            .map(|control| ResolvedModelEffort {
                                values: control.values.clone(),
                                default: control.observed_value.clone(),
                            }),
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
