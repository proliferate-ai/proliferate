use std::{io, path::PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkerError {
    #[error("failed to read worker config at {path}")]
    ReadConfig { path: PathBuf, source: io::Error },
    #[error("failed to parse worker config at {path}")]
    ParseConfig {
        path: PathBuf,
        source: toml::de::Error,
    },
    #[error("failed to serialize worker config at {path}")]
    SerializeConfig {
        path: PathBuf,
        source: toml::ser::Error,
    },
    #[error("worker database error")]
    Store(#[from] rusqlite::Error),
    #[error("worker JSON serialization error")]
    Json(#[from] serde_json::Error),
    #[error("cloud request failed")]
    Http(#[from] reqwest::Error),
    #[error("failed to build http client")]
    BuildHttpClient(reqwest::Error),
    #[error("cloud rejected request: {status}")]
    Cloud {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("worker enrollment token is missing")]
    MissingEnrollmentToken,
    #[error("failed to create parent directory for {path}")]
    CreateParent { path: PathBuf, source: io::Error },
    #[error("another proliferate worker already owns {path}")]
    AlreadyRunning { path: PathBuf },
    #[error("failed to acquire worker process lock at {path}")]
    AcquireProcessLock { path: PathBuf, source: io::Error },
    #[error("failed to write worker config at {path}")]
    WriteConfig { path: PathBuf, source: io::Error },
    #[error("failed to set private permissions on {path}")]
    SetPrivatePermissions { path: PathBuf, source: io::Error },
    #[error("failed to write integration-gateway dotfile at {path}")]
    WriteIntegrationGateway { path: PathBuf, source: io::Error },
}
