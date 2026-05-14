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
    #[error("failed to read update artifact at {path}")]
    ReadUpdateArtifact { path: PathBuf, source: io::Error },
    #[error("failed to write staged update artifact at {path}")]
    WriteUpdateArtifact { path: PathBuf, source: io::Error },
    #[error("failed to set private permissions on {path}")]
    SetPrivatePermissions { path: PathBuf, source: io::Error },
    #[error("failed to create update staging directory at {path}")]
    CreateUpdateStagingDir { path: PathBuf, source: io::Error },
    #[error("failed to parse update manifest")]
    ParseUpdateManifest(serde_json::Error),
    #[error("unsupported update manifest version {version}")]
    UnsupportedUpdateManifestVersion { version: u32 },
    #[error("invalid update artifact {field}: {value}")]
    InvalidUpdateArtifactField { field: String, value: String },
    #[error("update artifact size mismatch for {component} {version}")]
    UpdateArtifactSizeMismatch {
        component: String,
        version: String,
        expected: u64,
        actual: usize,
    },
    #[error("update artifact checksum mismatch for {component} {version}")]
    UpdateChecksumMismatch {
        component: String,
        version: String,
        expected: String,
        actual: String,
    },
    #[error("update manifest does not include {component} {version}")]
    UpdateArtifactMissing { component: String, version: String },
}
