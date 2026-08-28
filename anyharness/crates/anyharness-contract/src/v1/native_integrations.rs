//! Native integrations — the wire half of "which pieces of the user's own
//! harness installation has the user re-admitted into Proliferate sessions?"
//!
//! Owned by `specs/systems/harnesses/native-integrations.md`. Discovery is
//! derived from the harness's native config on every read; only the selection
//! (`enabled`) is stored. Nothing here ever carries a user's env values or
//! headers — those stay on the runtime side and reach a session only as MCP
//! bindings.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// How a native integration reaches the session once selected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NativeIntegrationKind {
    /// A raw stdio MCP server from the user's native harness config.
    McpStdio,
    /// A raw HTTP MCP server from the user's native harness config.
    McpHttp,
    /// A Proliferate-curated bundle over vendor-provisioned artifacts
    /// (Codex Computer Use, Codex Chrome).
    Bundle,
}

/// What a native integration can reach once it is running. Drives the consent
/// dialog a settings surface shows before enabling it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NativeIntegrationRisk {
    None,
    DesktopControl,
    BrowserControl,
}

/// One discovered integration, merged with whether the user has enabled it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeIntegration {
    /// `bundle:<name>` for a curated bundle, `mcp:<server-name>` for a raw
    /// config entry. Stable across reads so selections can reference it.
    pub id: String,
    pub agent_kind: String,
    pub kind: NativeIntegrationKind,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Human-readable origin of the entry, e.g.
    /// `~/.codex/config.toml · mcp_servers.linear`. Never an env value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Whether the artifacts the integration needs are present on disk. A
    /// pure file check — discovery never spawns or probes.
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    pub risk: NativeIntegrationRisk,
    /// Whether a selection row exists for this integration.
    pub enabled: bool,
}

/// Everything a settings surface needs to render one harness's section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeIntegrationsResponse {
    pub agent_kind: String,
    pub integrations: Vec<NativeIntegration>,
    /// Enabled integration ids that discovery no longer finds — a config entry
    /// the user removed natively. Surfaced so the user sees what to fix.
    pub stale_selections: Vec<String>,
}

/// Body of `PUT /v1/agents/{kind}/native-integrations/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeIntegrationSelectionRequest {
    pub enabled: bool,
}
