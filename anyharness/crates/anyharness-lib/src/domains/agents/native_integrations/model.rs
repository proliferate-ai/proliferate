//! The domain shape of one native integration: what the wire shape carries
//! plus the spawn spec and skill text that must never leave the runtime.
//! Spec: `specs/systems/harnesses/native-integrations.md`, "Discovery".

pub use anyharness_contract::v1::{NativeIntegrationKind, NativeIntegrationRisk};

use crate::domains::agents::model::AgentKind;

/// Id prefix for curated bundles.
pub const BUNDLE_ID_PREFIX: &str = "bundle:";
/// Id prefix for raw native MCP config entries.
pub const MCP_ID_PREFIX: &str = "mcp:";

/// How to start a native integration's MCP server when it is selected for a
/// session. Env values and header values may hold user tokens: they are
/// materialized into session MCP bindings and never logged or persisted.
#[derive(Clone, PartialEq, Eq)]
pub enum NativeSpawn {
    Stdio {
        command: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
    },
    Http {
        url: String,
        headers: Vec<(String, String)>,
    },
}

impl std::fmt::Debug for NativeSpawn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stdio { command, args, env } => f
                .debug_struct("Stdio")
                .field("command", command)
                .field("args", args)
                .field("env_names", &names_of(env))
                .finish(),
            Self::Http { url: _, headers } => f
                .debug_struct("Http")
                .field("url", &"<redacted>")
                .field("header_names", &names_of(headers))
                .finish(),
        }
    }
}

fn names_of(pairs: &[(String, String)]) -> Vec<&str> {
    pairs.iter().map(|(name, _)| name.as_str()).collect()
}

/// One integration as discovery reports it. `enabled` is not here: discovery
/// is derived from disk and knows nothing about selections; the service merges
/// the two.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeIntegration {
    /// `bundle:<name>` or `mcp:<server-name>`.
    pub id: String,
    pub agent_kind: AgentKind,
    pub kind: NativeIntegrationKind,
    pub display_name: String,
    pub description: Option<String>,
    /// Human-readable origin, e.g. `~/.codex/config.toml · mcp_servers.linear`.
    pub source: Option<String>,
    /// Required artifacts present on disk (pure file check).
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub risk: NativeIntegrationRisk,
    /// The server to materialize when selected. `None` for a listing-only
    /// entry (for example a malformed config entry reported with a reason).
    pub spawn: Option<NativeSpawn>,
    /// Bundle skill text appended to the session's first prompt.
    pub skill_text: Option<String>,
}
