//! Native integrations: which pieces of the user's own harness installation
//! (its native MCP servers, the vendor's bundled capability plugins) has the
//! user explicitly re-admitted into Proliferate sessions?
//!
//! Owner spec: `specs/systems/harnesses/native-integrations.md`. This module
//! discovers and selects; delivery into a session rides the ordinary session
//! MCP pipeline through [`extension::NativeIntegrationsSessionExtension`].
//!
//! Module map (spec "Code map"):
//! - `model`         — the domain `NativeIntegration`, ids, risk, spawn spec
//! - `discovery`     — read-only discovery per harness kind (never spawns)
//! - `bundles`       — compiled-in curated bundle recipes
//! - `store`         — the `native_integration_selections` table
//! - `service`       — list + select, the two operations the API exposes
//! - `launch_extras` — selections × discovery → session launch extras
//! - `extension`     — the `SessionExtension` that delivers those extras

mod bundles;
mod discover_claude;
mod discover_codex;
pub mod discovery;
mod extension;
pub mod launch_extras;
pub mod model;
mod service;
mod store;

pub use extension::NativeIntegrationsSessionExtension;
pub use model::{
    ListedNativeIntegration, NativeIntegration, NativeIntegrationListing, NativeSpawn,
};
pub use service::NativeIntegrationsService;
pub use store::NativeIntegrationSelectionStore;
