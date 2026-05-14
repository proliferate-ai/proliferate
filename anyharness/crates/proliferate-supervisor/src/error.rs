use std::{io, path::PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error("failed to read supervisor config at {path}")]
    ReadConfig { path: PathBuf, source: io::Error },
    #[error("failed to parse supervisor config at {path}")]
    ParseConfig {
        path: PathBuf,
        source: toml::de::Error,
    },
    #[error("failed to spawn {program}")]
    Spawn { program: String, source: io::Error },
}
