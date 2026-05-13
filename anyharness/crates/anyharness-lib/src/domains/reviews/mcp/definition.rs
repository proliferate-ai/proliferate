use anyharness_contract::v1::{
    SessionMcpBindingNotAppliedReason, SessionMcpBindingOutcome, SessionMcpBindingSummary,
    SessionMcpTransport,
};

use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub const ID: &str = "reviews";
pub const ROUTE_SLUG: &str = "reviews";
pub const ACP_SERVER_NAME: &str = "reviews";

pub const INSTRUCTIONS: &str = "Review tools are role-scoped by AnyHarness. Reviewers must submit submit_review_result. Parent sessions may use get_review_status. mark_review_revision_ready is only available for manual fallback states when a revised target is ready and another review round is expected.";

pub const SYSTEM_PROMPT_APPEND: &str = "AnyHarness may run structured review loops for plans and code. If you receive review feedback, address the feedback you agree with and explicitly justify feedback you ignore. Only call mark_review_revision_ready when the feedback prompt explicitly asks for manual revision signaling and the tool is available. If the feedback says auto iterate is enabled, all reviewers approved, or it is the final configured round, do not call mark_review_revision_ready; follow the feedback instructions instead. For plan review, that can mean presenting the final plan. Reviewer sessions must submit their verdict with submit_review_result instead of only writing prose.";

pub const DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: ID,
    route_slug: ROUTE_SLUG,
    acp_server_name: ACP_SERVER_NAME,
    server_info_name: "proliferate-reviews",
    display_name: "Reviews",
    description: "Submit and inspect structured review workflow state.",
    visibility: ProductMcpVisibility::Internal,
    instructions: INSTRUCTIONS,
    unauthorized_code: "REVIEW_MCP_UNAUTHORIZED",
    request_invalid_code: "REVIEW_MCP_REQUEST_INVALID",
    prompt_policy: ProductMcpPromptPolicy::System,
};

pub fn system_prompt_append() -> Vec<String> {
    vec![SYSTEM_PROMPT_APPEND.to_string()]
}

pub fn binding_summary() -> SessionMcpBindingSummary {
    SessionMcpBindingSummary {
        id: "internal:reviews".to_string(),
        server_name: ACP_SERVER_NAME.to_string(),
        display_name: Some("Reviews".to_string()),
        transport: SessionMcpTransport::Http,
        outcome: SessionMcpBindingOutcome::Applied,
        reason: None::<SessionMcpBindingNotAppliedReason>,
    }
}
