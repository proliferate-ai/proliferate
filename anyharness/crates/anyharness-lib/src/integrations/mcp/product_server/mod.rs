pub mod auth;
pub mod definition;
pub mod dispatcher;
pub mod errors;
pub mod request;
pub mod response;

pub use auth::ProductMcpAuth;
pub use definition::{ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility};
pub use dispatcher::{dispatch_product_mcp_request, ProductMcpServer};
pub use errors::{ProductMcpContextError, ProductMcpDispatchError};
pub use request::{
    ProductMcpAuthHeader, ProductMcpRequestContext, ProductMcpTokenValidation,
    PRODUCT_MCP_TOKEN_HEADER_NAME,
};
