//! The two operations the native-integrations API exposes: list one harness's
//! integrations with the user's selections merged in, and flip one selection.
//! Spec: "Settings surface" (what a list carries) and "Owned state".

use std::path::PathBuf;

use anyharness_contract::v1::{
    NativeIntegration as WireNativeIntegration, NativeIntegrationsResponse,
};

use super::discovery::discover;
use super::model::NativeIntegration;
use super::store::NativeIntegrationSelectionStore;
use crate::domains::agents::model::AgentKind;

#[derive(Clone)]
pub struct NativeIntegrationsService {
    store: NativeIntegrationSelectionStore,
    /// The home directory discovery reads native config from (`~`).
    home: PathBuf,
}

impl NativeIntegrationsService {
    pub fn new(store: NativeIntegrationSelectionStore, home: PathBuf) -> Self {
        Self { store, home }
    }

    pub fn store(&self) -> &NativeIntegrationSelectionStore {
        &self.store
    }

    /// Fresh discovery merged with the stored selections. An enabled id that
    /// discovery no longer reports lands in `stale_selections`.
    pub fn list(&self, kind: &AgentKind) -> anyhow::Result<NativeIntegrationsResponse> {
        let enabled = self.store.list_enabled(kind.as_str())?;
        let discovered = discover(kind, &self.home);
        let stale_selections = enabled
            .iter()
            .filter(|id| !discovered.iter().any(|integration| &integration.id == *id))
            .cloned()
            .collect();
        let integrations = discovered
            .into_iter()
            .map(|integration| {
                let is_enabled = enabled.contains(&integration.id);
                to_wire(integration, is_enabled)
            })
            .collect();
        Ok(NativeIntegrationsResponse {
            agent_kind: kind.as_str().to_string(),
            integrations,
            stale_selections,
        })
    }

    /// Flip one selection and return the refreshed listing. Disabling an id
    /// that discovery no longer reports is how a stale selection is cleared,
    /// so ids are not validated against discovery here.
    pub fn set_enabled(
        &self,
        kind: &AgentKind,
        integration_id: &str,
        enabled: bool,
    ) -> anyhow::Result<NativeIntegrationsResponse> {
        self.store
            .set_enabled(kind.as_str(), integration_id, enabled)?;
        self.list(kind)
    }
}

/// Wire projection: everything but the spawn spec and skill text, which never
/// leave the runtime.
fn to_wire(integration: NativeIntegration, enabled: bool) -> WireNativeIntegration {
    WireNativeIntegration {
        id: integration.id,
        agent_kind: integration.agent_kind.as_str().to_string(),
        kind: integration.kind,
        display_name: integration.display_name,
        description: integration.description,
        source: integration.source,
        available: integration.available,
        unavailable_reason: integration.unavailable_reason,
        risk: integration.risk,
        enabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    fn service() -> NativeIntegrationsService {
        NativeIntegrationsService::new(
            NativeIntegrationSelectionStore::new(Db::open_in_memory().unwrap()),
            std::env::temp_dir(),
        )
    }

    #[test]
    fn a_selection_that_discovery_does_not_report_is_listed_as_stale() {
        let service = service();
        let response = service
            .set_enabled(&AgentKind::Codex, "mcp:vanished", true)
            .unwrap();
        assert_eq!(response.agent_kind, "codex");
        assert_eq!(response.stale_selections, vec!["mcp:vanished".to_string()]);
    }

    #[test]
    fn disabling_a_stale_selection_clears_it_from_the_listing() {
        let service = service();
        service
            .set_enabled(&AgentKind::Codex, "mcp:vanished", true)
            .unwrap();
        let response = service
            .set_enabled(&AgentKind::Codex, "mcp:vanished", false)
            .unwrap();
        assert!(response.stale_selections.is_empty());
        assert!(response.integrations.is_empty());
    }
}
