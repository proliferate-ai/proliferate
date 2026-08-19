//! Canonical launch-option reads shared by internal product surfaces.

use super::SessionService;
use crate::domains::agents::launch_options::HarnessLaunchOptionsResponse;
use crate::domains::agents::model::AgentKind;

impl SessionService {
    pub fn active_agent_catalog(&self) -> crate::domains::agents::catalog::service::ActiveCatalog {
        self.catalog_service.active_catalog()
    }

    /// An active model mutation is authorized only by this exact session's
    /// latest live statement. Target launch options and the distribution
    /// catalog cannot authorize a running session.
    pub fn live_model_switch_authorized(
        &self,
        record: &crate::domains::sessions::model::SessionRecord,
        value: &str,
    ) -> bool {
        self.get_live_config_snapshot(&record.id)
            .ok()
            .flatten()
            .is_some_and(|snapshot| snapshot.models.iter().any(|model| model.id == value))
    }

    /// Returns the same target-observed envelopes used by the public
    /// launch-options API. Workspace identity is intentionally absent: a
    /// workspace cannot change a target harness's executable universe.
    pub fn harness_launch_options(&self) -> anyhow::Result<Vec<HarnessLaunchOptionsResponse>> {
        let mut responses = Vec::new();

        for kind in AgentKind::all() {
            let kind_id = kind.as_str();
            let Some(observed) = self.launch_options_service.read(kind_id)? else {
                continue;
            };
            responses.push(observed);
        }

        Ok(responses)
    }
}
