use super::SessionService;
use crate::domains::agents::readiness::launch_options::{
    workspace_session_launch_options_with_dynamic_registry, ResolvedWorkspaceLaunchOptions,
};

impl SessionService {
    pub fn resolved_workspace_launch_options(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<ResolvedWorkspaceLaunchOptions> {
        self.workspace_store
            .find_by_id(workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;

        workspace_session_launch_options_with_dynamic_registry(
            &self.runtime_home,
            &self.dynamic_model_registry_store,
            Some(workspace_id),
        )
    }
}
