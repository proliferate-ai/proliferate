//! Selections × discovery → what a session launch injects. Spec: "Delivery".
//!
//! Barrier stub: lane L2 implements the delivery flow here (materialize
//! available selections into `SessionMcpServer`s and skill-text prompt
//! appends; report unavailable and stale selections as binding summaries with
//! `NativeUnavailable` / `NativeStale`). Until then every launch gets no
//! native extras, which is exactly today's launch.

use std::path::Path;

use super::store::NativeIntegrationSelectionStore;
use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::extensions::SessionLaunchExtras;

/// Resolve the native launch extras for one session of `kind`, reading the
/// selection rows from `store` and discovering fresh from `home`.
pub fn resolve_native_launch_extras(
    store: &NativeIntegrationSelectionStore,
    home: &Path,
    kind: &AgentKind,
) -> anyhow::Result<SessionLaunchExtras> {
    let _ = (store, home, kind);
    Ok(SessionLaunchExtras::default())
}
