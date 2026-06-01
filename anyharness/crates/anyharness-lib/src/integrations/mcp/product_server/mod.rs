pub mod auth;
pub mod definition;
pub mod dispatcher;
pub mod endpoint;
pub mod errors;
pub mod request;
pub mod response;

pub use auth::ProductMcpAuth;
pub use definition::{ProductMcpDefinition, ProductMcpPromptPolicy, ProductMcpVisibility};
pub use dispatcher::{ProductMcpServer, dispatch_product_mcp_request};
pub use endpoint::ProductMcpEndpointOperation;
pub use errors::{ProductMcpContextError, ProductMcpDispatchError};
pub use request::{
    PRODUCT_MCP_TOKEN_HEADER_NAME, ProductMcpAuthHeader, ProductMcpRequestContext,
    ProductMcpTokenValidation,
};
