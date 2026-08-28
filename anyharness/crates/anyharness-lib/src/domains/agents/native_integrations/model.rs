//! The domain shape of one native integration: what the wire shape carries
//! plus the spawn spec and skill text that must never leave the runtime.
//! Spec: `specs/systems/harnesses/native-integrations.md`, "Discovery".

use std::collections::BTreeMap;

use crate::domains::agents::model::AgentKind;

/// How a native integration reaches the session once selected. Domain twin of
/// the contract enum of the same name (AH-CONTRACT-1: domain code never names
/// wire types; the api layer maps this to the wire shape at its boundary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeIntegrationKind {
    /// A raw stdio MCP server from the user's native harness config.
    McpStdio,
    /// A raw HTTP MCP server from the user's native harness config.
    McpHttp,
    /// A Proliferate-curated bundle over vendor-provisioned artifacts
    /// (Codex Computer Use, Codex Chrome).
    Bundle,
}

/// What a native integration can reach once it is running. Domain twin of the
/// contract enum of the same name (AH-CONTRACT-1: domain code never names wire
/// types; the api layer maps this to the wire shape at its boundary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeIntegrationRisk {
    None,
    DesktopControl,
    BrowserControl,
}

/// Id prefix for curated bundles.
pub const BUNDLE_ID_PREFIX: &str = "bundle:";
/// Id prefix for raw native MCP config entries.
pub const MCP_ID_PREFIX: &str = "mcp:";

/// How a native integration reaches the session when it is selected. Env
/// values and header values may hold user tokens: they are materialized into
/// session MCP bindings and never logged or persisted.
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
    /// Not a server of Proliferate's to spawn: harness launch arguments in
    /// the Agent SDK's `extraArgs` shape (`{"chrome": ""}` renders
    /// `--chrome`), for a capability whose server the harness starts itself
    /// once the flag is present (spec "Curated bundles", the Claude row).
    /// Values are flags, never secrets.
    HarnessArgs { args: BTreeMap<String, String> },
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
            Self::HarnessArgs { args } => {
                f.debug_struct("HarnessArgs").field("args", args).finish()
            }
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

/// One discovered integration merged with the user's selection — the merge the
/// service performs over [`NativeIntegration`], which deliberately carries no
/// `enabled` of its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListedNativeIntegration {
    pub integration: NativeIntegration,
    /// Whether a selection row exists for this integration.
    pub enabled: bool,
}

/// Everything the service knows about one harness's integrations: the domain
/// answer the api layer maps to the wire response (AH-CONTRACT-1: the mapping
/// lives there, so this listing never names a wire type).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeIntegrationListing {
    pub agent_kind: AgentKind,
    pub integrations: Vec<ListedNativeIntegration>,
    /// Enabled integration ids that discovery no longer finds — a config entry
    /// the user removed natively. Surfaced so the user sees what to fix.
    pub stale_selections: Vec<String>,
}
