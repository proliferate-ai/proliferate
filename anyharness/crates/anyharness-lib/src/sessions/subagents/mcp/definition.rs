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

pub const INSTRUCTIONS: &str = "Use get_subagent_launch_options to inspect defaults, limits, and supported agent/model choices. Use subagent tools to create and manage same-workspace child agent sessions. Child completions are passive by default. After creating or messaging a child, call schedule_subagent_wake if you want AnyHarness to prompt you after the child's next completed turn. Inspect child output with read_subagent_events before continuing.";

pub const SYSTEM_PROMPT_APPEND: &str = "You can use the subagents MCP tools to delegate bounded work to same-workspace child sessions. Call get_subagent_launch_options before choosing a non-default agentKind, modelId, or modeId. Child sessions are normal agent sessions linked back to you. Child completions are passive by default: after creating or messaging a child, call schedule_subagent_wake when you want AnyHarness to prompt you after that child's next completed turn. Use read_subagent_events before relying on a child result.";

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

pub fn system_prompt_append() -> Vec<String> {
    vec![SYSTEM_PROMPT_APPEND.to_string()]
}

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
