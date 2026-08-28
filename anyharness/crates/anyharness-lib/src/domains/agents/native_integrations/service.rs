//! The two operations the native-integrations API exposes: list one harness's
//! integrations with the user's selections merged in, and flip one selection.
//! Both return the domain [`NativeIntegrationListing`]; the api layer maps it
//! to the wire response (AH-CONTRACT-1: no wire type is named down here).
//! Spec: "Settings surface" (what a list carries) and "Owned state".

use std::path::PathBuf;

use super::auth_posture::claude_auth_posture;
use super::discovery::{discover, DiscoveryContext};
use super::model::{ListedNativeIntegration, NativeIntegration, NativeIntegrationListing};
use super::store::NativeIntegrationSelectionStore;
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::runtime::RuntimeSurface;

/// Law "Local surface only" (the same check `launch_extras` applies at
/// launch): native integrations are facts about this machine's harness
/// setup, which a cloud sandbox does not have, so the cloud listing reports
/// every integration unavailable with this reason.
const CLOUD_UNAVAILABLE_REASON: &str =
    "not available on the cloud surface: native integrations come from this machine's own \
     harness setup";

#[derive(Clone)]
pub struct NativeIntegrationsService {
    store: NativeIntegrationSelectionStore,
    /// The home directory discovery reads native config from (`~`).
    home: PathBuf,
    /// The runtime home the enrolled agent-auth state lives under — the
    /// Claude in Chrome bundle's auth posture is read from there.
    runtime_home: PathBuf,
}

impl NativeIntegrationsService {
    pub fn new(
        store: NativeIntegrationSelectionStore,
        home: PathBuf,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            store,
            home,
            runtime_home,
        }
    }

    pub fn store(&self) -> &NativeIntegrationSelectionStore {
        &self.store
    }

    /// Fresh discovery merged with the stored selections. An enabled id that
    /// discovery no longer reports lands in `stale_selections`.
    pub fn list(&self, kind: &AgentKind) -> anyhow::Result<NativeIntegrationListing> {
        self.list_on_surface(RuntimeSurface::from_env(), kind)
    }

    /// The same listing with the surface explicit, so the cloud law is
    /// testable without mutating process env (the seam `launch_extras` uses
    /// for the same check).
    fn list_on_surface(
        &self,
        surface: RuntimeSurface,
        kind: &AgentKind,
    ) -> anyhow::Result<NativeIntegrationListing> {
        let enabled = self.store.list_enabled(kind.as_str())?;
        let ctx = DiscoveryContext::new(
            &self.home,
            claude_auth_posture(&self.runtime_home, &self.home),
        );
        let discovered = discover(kind, &ctx);
        let stale_selections = enabled
            .iter()
            .filter(|id| !discovered.iter().any(|integration| &integration.id == *id))
            .cloned()
            .collect();
        let integrations = discovered
            .into_iter()
            .map(|integration| {
                let integration = match surface {
                    RuntimeSurface::Local => integration,
                    RuntimeSurface::Cloud => cloud_unavailable(integration),
                };
                let enabled = enabled.contains(&integration.id);
                ListedNativeIntegration {
                    integration,
                    enabled,
                }
            })
            .collect();
        Ok(NativeIntegrationListing {
            agent_kind: kind.clone(),
            integrations,
            stale_selections,
        })
    }

    /// Flip one selection and return the refreshed listing. Disabling an id
    /// that discovery no longer reports is how a stale selection is cleared,
    /// so ids are not validated against discovery here. The refreshed listing
    /// goes through [`Self::list`], so on the cloud surface the flipped row
    /// still comes back unavailable.
    pub fn set_enabled(
        &self,
        kind: &AgentKind,
        integration_id: &str,
        enabled: bool,
    ) -> anyhow::Result<NativeIntegrationListing> {
        self.store
            .set_enabled(kind.as_str(), integration_id, enabled)?;
        self.list(kind)
    }
}

/// One integration as the cloud surface reports it: unavailable by law, with
/// the spawn dropped so nothing cloud-side ever holds a launchable spec.
fn cloud_unavailable(mut integration: NativeIntegration) -> NativeIntegration {
    integration.available = false;
    integration.unavailable_reason = Some(CLOUD_UNAVAILABLE_REASON.to_string());
    integration.spawn = None;
    integration
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::Db;

    fn service() -> NativeIntegrationsService {
        NativeIntegrationsService::new(
            NativeIntegrationSelectionStore::new(Db::open_in_memory().unwrap()),
            std::env::temp_dir(),
            std::env::temp_dir(),
        )
    }

    // These tests run against a harness kind with no discovery parser
    // (cursor), so the listing itself stays empty and only the selection
    // mechanics are under test. Codex is no longer suitable here: its
    // discovery always lists the two curated bundles, unavailable when the
    // fixture home holds no vendor artifacts.
    #[test]
    fn a_selection_that_discovery_does_not_report_is_listed_as_stale() {
        let service = service();
        let listing = service
            .set_enabled(&AgentKind::Cursor, "mcp:vanished", true)
            .unwrap();
        assert_eq!(listing.agent_kind, AgentKind::Cursor);
        assert_eq!(listing.stale_selections, vec!["mcp:vanished".to_string()]);
    }

    #[test]
    fn the_cloud_surface_lists_every_integration_unavailable_with_the_cloud_reason() {
        let service = service();
        // Codex always lists its two curated bundles, so the cloud listing
        // has rows to demote.
        let listing = service
            .list_on_surface(RuntimeSurface::Cloud, &AgentKind::Codex)
            .unwrap();
        assert_eq!(listing.integrations.len(), 2);
        for listed in &listing.integrations {
            assert!(
                !listed.integration.available,
                "{} must be unavailable",
                listed.integration.id
            );
            assert_eq!(
                listed.integration.unavailable_reason.as_deref(),
                Some(CLOUD_UNAVAILABLE_REASON)
            );
        }
    }

    #[test]
    fn disabling_a_stale_selection_clears_it_from_the_listing() {
        let service = service();
        service
            .set_enabled(&AgentKind::Cursor, "mcp:vanished", true)
            .unwrap();
        let listing = service
            .set_enabled(&AgentKind::Cursor, "mcp:vanished", false)
            .unwrap();
        assert!(listing.stale_selections.is_empty());
        assert!(listing.integrations.is_empty());
    }
}
