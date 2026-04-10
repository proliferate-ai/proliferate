use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderId {
    Claude,
    Codex,
    Gemini,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalAuthState {
    Present(LocalAuthSource),
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalAuthSource {
    File {
        path: PathBuf,
    },
    MacOsKeychain {
        service: String,
        account: String,
    },
    ConfigMarker {
        path: PathBuf,
        marker: ConfigMarkerKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigMarkerKind {
    ClaudeOauthAccount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableAuthExport {
    pub files: Vec<PortableAuthFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableAuthFile {
    pub relative_path: PortableRelativePath,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableRelativePath(String);

impl PortableRelativePath {
    pub fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        if value.is_empty()
            || value.starts_with('/')
            || value.contains('\\')
            || value
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return None;
        }
        Some(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}
