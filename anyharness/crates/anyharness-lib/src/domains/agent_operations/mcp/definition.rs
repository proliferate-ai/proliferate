use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub const ID: &str = "workspace";
pub const ROUTE_SLUG: &str = "workspace";
pub const ACP_SERVER_NAME: &str = "workspace";
pub const LAUNCH_GUIDANCE: &str = concat!(
    "Use Workspace tools to inspect and operate workspaces and agents. ",
    "Prefer send_message for concise agent updates; use get_task_output only when you need a bounded view of recent visible output. ",
    "Authorization and role are evaluated from current durable state on every call."
);

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-workspace",
    display_name: "Workspace",
    description: "Inspect and operate this Proliferate runtime.",
    visibility: ProductMcpVisibility::Internal,
    instructions: "Use Workspace tools to inspect runtime identity, workspaces, agents, and delegated subagents. Authorization is evaluated on every call.",
    unauthorized_code: "WORKSPACE_MCP_UNAUTHORIZED",
    request_invalid_code: "WORKSPACE_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::System,
};

pub fn system_prompt_append() -> Vec<String> {
    vec![LAUNCH_GUIDANCE.to_string()]
}

pub fn first_prompt_system_prompt_append() -> Vec<String> {
    vec![LAUNCH_GUIDANCE.to_string()]
}
