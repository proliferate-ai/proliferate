mod claude;
mod codex;
mod gemini;
mod types;
mod util;

use std::path::Path;

pub use types::{
    ConfigMarkerKind, LocalAuthSource, LocalAuthState, PortableAuthExport, PortableAuthFile,
    PortableRelativePath, ProviderId,
};

#[derive(Debug, thiserror::Error)]
pub enum DiscoveryError {
    #[error("failed to read credential file: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to encode credential JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("failed to read credential from macOS keychain: {0}")]
    Keychain(String),
}

pub fn detect_local_auth_state(
    provider: ProviderId,
    home_dir: &Path,
) -> Result<LocalAuthState, DiscoveryError> {
    match provider {
        ProviderId::Claude => claude::detect_local_auth_state(home_dir),
        ProviderId::Codex => codex::detect_local_auth_state(home_dir),
        ProviderId::Gemini => gemini::detect_local_auth_state(home_dir),
    }
}

pub fn export_portable_auth(
    provider: ProviderId,
    home_dir: &Path,
) -> Result<Option<PortableAuthExport>, DiscoveryError> {
    match provider {
        ProviderId::Claude => claude::export_portable_auth(home_dir),
        ProviderId::Codex => codex::export_portable_auth(home_dir),
        ProviderId::Gemini => gemini::export_portable_auth(home_dir),
    }
}

#[cfg(test)]
mod tests {
    use super::PortableRelativePath;

    #[test]
    fn rejects_non_portable_relative_paths() {
        assert!(PortableRelativePath::new("").is_none());
        assert!(PortableRelativePath::new("/tmp/foo").is_none());
        assert!(PortableRelativePath::new("../foo").is_none());
        assert!(PortableRelativePath::new(".foo").is_some());
        assert!(PortableRelativePath::new(".codex/auth.json").is_some());
    }
}
