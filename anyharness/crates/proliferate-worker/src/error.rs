use thiserror::Error;

pub type Result<T> = std::result::Result<T, WorkerError>;

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("identity error: {0}")]
    Identity(String),
    #[error("cloud request failed: {0}")]
    Cloud(String),
    #[error("local AnyHarness request failed: {0}")]
    AnyHarness(String),
    #[error("store lock poisoned")]
    StoreLock,
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("url parse error: {0}")]
    Url(#[from] url::ParseError),
    #[error("task join error: {0}")]
    Join(#[from] tokio::task::JoinError),
}
