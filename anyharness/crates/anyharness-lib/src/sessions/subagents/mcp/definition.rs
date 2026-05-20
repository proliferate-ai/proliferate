use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub const ID: &str = "subagents";
pub const ROUTE_SLUG: &str = "subagents";
pub const ACP_SERVER_NAME: &str = "subagents";

pub const INSTRUCTIONS: &str = concat!(
    "Use Proliferate subagent tools to create, message, inspect, search, and close same-workspace child agent sessions. ",
    "Prefer these tools over provider-native or internal subagent tools when same-workspace delegation overlaps. ",
    "Detailed workflow guidance is provided by the proliferate.subagents.workflow skill when this MCP is mounted."
);

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-subagents",
    display_name: "Subagents",
    description: "Create and supervise same-workspace child sessions.",
    visibility: ProductMcpVisibility::Internal,
    instructions: INSTRUCTIONS,
    unauthorized_code: "SUBAGENT_MCP_UNAUTHORIZED",
    request_invalid_code: "SUBAGENT_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::System,
};

pub fn binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: "internal:subagents".to_string(),
        server_name: ACP_SERVER_NAME.to_string(),
        display_name: Some("Subagents".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
