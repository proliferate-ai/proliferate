use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub const ID: &str = "workspace_naming";
pub const ROUTE_SLUG: &str = ID;
pub const ACP_SERVER_NAME: &str = "workspace_naming";
pub const BINDING_SUMMARY_ID: &str = "internal:workspace_naming";

pub const INSTRUCTIONS: &str = "Your first action in this first turn MUST be a direct call to set_workspace_display_name with a concise task title for the workspace. Use the exact argument shape {\"displayName\":\"<concise title>\"}. If MCP tools are namespaced, the exact tool name is mcp__workspace_naming__set_workspace_display_name. This tool is already available in the active tool list; do not use ToolSearch, subagents, or any other tool to find or invoke it. Do not send a user-visible response, clarification, plan, or other tool call before naming the workspace. After the workspace is named, continue with the user's request. Do not rename the git branch for naming.";

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-workspace-naming",
    display_name: "Workspace Naming",
    description: "Set a concise display name for a new workspace.",
    visibility: ProductMcpVisibility::Internal,
    instructions: INSTRUCTIONS,
    unauthorized_code: "WORKSPACE_NAMING_MCP_UNAUTHORIZED",
    request_invalid_code: "WORKSPACE_NAMING_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::SystemAndFirstPrompt,
};

pub fn system_prompt_append() -> Vec<String> {
    vec![INSTRUCTIONS.to_string()]
}

pub fn binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: BINDING_SUMMARY_ID.to_string(),
        server_name: ACP_SERVER_NAME.to_string(),
        display_name: Some("Workspace Naming".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
