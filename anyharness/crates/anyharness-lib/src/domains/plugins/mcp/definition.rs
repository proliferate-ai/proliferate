use crate::integrations::mcp::product_server::{
    ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility,
};

pub static DEFINITION: ProductMcpDefinition = ProductMcpDefinition {
    id: "proliferate_skills",
    route_slug: "skills",
    acp_server_name: "proliferate_skills",
    server_info_name: "proliferate-skills",
    display_name: "Proliferate Skills",
    description: "Lists and activates plugin-provided skills for this session.",
    visibility: ProductMcpVisibility::Internal,
    instructions: "Use this MCP server to list available Proliferate skills and activate full skill instructions when they are relevant.",
    unauthorized_code: "skills_mcp_unauthorized",
    request_invalid_code: "skills_mcp_invalid_request",
    prompt_policy: ProductMcpPromptPolicy::None,
};
