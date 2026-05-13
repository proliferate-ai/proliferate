#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMcpVisibility {
    Internal,
    UserSelectable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMcpPromptPolicy {
    None,
    System,
    FirstPromptOnly,
    SystemAndFirstPrompt,
}

#[derive(Debug)]
pub struct ProductMcpDefinition {
    // Keep this intentionally narrower than the full Product MCP spec while
    // the first internal MCPs migrate. Add owner/capability/catalog fields
    // when user-selectable product MCPs land; see docs/anyharness/specs/product-mcps.md.
    pub id: &'static str,
    pub route_slug: &'static str,
    pub acp_server_name: &'static str,
    pub server_info_name: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub visibility: ProductMcpVisibility,
    pub instructions: &'static str,
    pub unauthorized_code: &'static str,
    pub request_invalid_code: &'static str,
    pub prompt_policy: ProductMcpPromptPolicy,
}
