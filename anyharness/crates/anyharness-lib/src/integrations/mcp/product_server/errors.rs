pub const JSON_RPC_PARSE_ERROR: i64 = -32700;
pub const JSON_RPC_INVALID_REQUEST: i64 = -32600;
pub const JSON_RPC_METHOD_NOT_FOUND: i64 = -32601;
pub const JSON_RPC_INVALID_PARAMS: i64 = -32602;

#[derive(Debug, thiserror::Error)]
pub enum ProductMcpContextError {
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl ProductMcpContextError {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProductMcpDispatchError {
    #[error(transparent)]
    Context(#[from] ProductMcpContextError),
    #[error(transparent)]
    Request(#[from] anyhow::Error),
}
