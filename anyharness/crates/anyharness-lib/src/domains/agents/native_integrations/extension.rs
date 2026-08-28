//! Delivery: the `SessionExtension` that turns this harness kind's selections
//! into session launch extras. Spec: "Delivery" — native servers reach a
//! session as ordinary MCP bindings, alongside the product extras, with no
//! change to the sessions-owned assembly.

use std::path::PathBuf;

use super::launch_extras::resolve_native_launch_extras;
use super::store::NativeIntegrationSelectionStore;
use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::extensions::{
    SessionExtension, SessionLaunchContext, SessionLaunchExtras,
};

#[derive(Clone)]
pub struct NativeIntegrationsSessionExtension {
    store: NativeIntegrationSelectionStore,
    /// The home directory discovery reads native config from (`~`).
    home: PathBuf,
}

impl NativeIntegrationsSessionExtension {
    pub fn new(store: NativeIntegrationSelectionStore, home: PathBuf) -> Self {
        Self { store, home }
    }
}

impl SessionExtension for NativeIntegrationsSessionExtension {
    fn resolve_launch_extras(
        &self,
        ctx: &SessionLaunchContext<'_>,
    ) -> anyhow::Result<SessionLaunchExtras> {
        // An unregistered kind has no native config to discover from.
        let Some(kind) = AgentKind::parse(&ctx.session.agent_kind) else {
            return Ok(SessionLaunchExtras::default());
        };
        resolve_native_launch_extras(&self.store, &self.home, &kind)
    }
}
