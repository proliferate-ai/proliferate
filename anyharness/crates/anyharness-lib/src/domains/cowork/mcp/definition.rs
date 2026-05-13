use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub const ID: &str = "cowork";
pub const ROUTE_SLUG: &str = ID;
pub const ACP_SERVER_NAME: &str = "cowork";

pub const INSTRUCTIONS: &str = "Use cowork artifact tools to manage cowork artifacts for this workspace. When workspace delegation is available, use get_coding_workspace_launch_options to choose a source workspace, then create_coding_workspace to provision a normal coding worktree. create_coding_workspace does not start agent work. Use get_coding_session_launch_options for that managed workspace, then create_coding_session to start a linked coding session with a prompt. Set wakeOnCompletion or call schedule_coding_wake when you want this cowork thread prompted after the coding session's next completed turn. Inspect coding work with get_coding_status and read_coding_events.";

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-cowork",
    display_name: "Cowork",
    description: "Manage cowork artifacts and cowork-managed coding workspaces.",
    visibility: ProductMcpVisibility::Internal,
    instructions: INSTRUCTIONS,
    unauthorized_code: "COWORK_MCP_UNAUTHORIZED",
    request_invalid_code: "COWORK_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::System,
};

pub fn launch_disabled() -> bool {
    std::env::var("ANYHARNESS_DISABLE_COWORK_LAUNCH_EXTRAS")
        .ok()
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}

pub fn system_prompt_append() -> Vec<String> {
    vec![
        "You are operating in Proliferate Cowork mode.".to_string(),
        "This session belongs to a managed cowork thread workspace.".to_string(),
        "Continue work in this thread unless the user explicitly asks to start a new thread."
            .to_string(),
        "Use create_artifact, update_artifact, and delete_artifact for user-visible artifacts."
            .to_string(),
        "Never edit .proliferate/artifacts.json directly.".to_string(),
        "Do not use generic file writes on artifact-backed paths.".to_string(),
        "Use normal file tools only for supporting non-artifact files.".to_string(),
        "JSX artifacts must default-export a React component with no required props.".to_string(),
        "JSX artifacts may only import allowlisted libraries.".to_string(),
    ]
}

pub fn binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: "internal:cowork".to_string(),
        server_name: ACP_SERVER_NAME.to_string(),
        display_name: Some("Cowork".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
