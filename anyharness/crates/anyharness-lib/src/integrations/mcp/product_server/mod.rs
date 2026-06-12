pub mod auth;
pub mod definition;
pub mod endpoint;
pub mod server;

pub use auth::ProductMcpAuth;
pub use definition::{ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility};
pub use endpoint::ProductMcpEndpointOperation;
pub use server::{
    dispatch_product_mcp_request, initialize_response, ProductMcpAuthHeader,
    ProductMcpContextError, ProductMcpDispatchError, ProductMcpRequestContext, ProductMcpServer,
    ProductMcpTokenValidation, JSON_RPC_INVALID_PARAMS, JSON_RPC_INVALID_REQUEST,
    JSON_RPC_METHOD_NOT_FOUND, JSON_RPC_PARSE_ERROR, PRODUCT_MCP_TOKEN_HEADER_NAME,
};
