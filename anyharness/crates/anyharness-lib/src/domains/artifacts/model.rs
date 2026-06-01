use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ArtifactType {
    #[serde(rename = "text/markdown")]
    TextMarkdown,
    #[serde(rename = "text/html")]
    TextHtml,
    #[serde(rename = "image/svg+xml")]
    ImageSvgXml,
    #[serde(rename = "application/vnd.proliferate.react")]
    ApplicationVndProliferateReact,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactSummary {
    pub id: String,
    pub path: String,
    pub r#type: ArtifactType,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateArtifactInput {
    pub path: String,
    pub content: String,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone)]
pub struct UpdateArtifactInput {
    pub id: String,
    pub content: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifest {
    pub version: u32,
    pub artifacts: Vec<ArtifactSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDetail {
    pub artifact: ArtifactSummary,
    pub content: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ArtifactError {
    #[error("workspace is not a cowork workspace")]
    WorkspaceNotCowork,
    #[error("artifact manifest is invalid: {0}")]
    ManifestInvalid(String),
    #[error("artifact path is invalid: {0}")]
    InvalidPath(String),
    #[error("artifact type is unsupported for path: {0}")]
    UnsupportedType(String),
    #[error("artifact already exists for path: {0}")]
    PathAlreadyRegistered(String),
    #[error("artifact not found: {0}")]
    ArtifactNotFound(String),
    #[error("artifact file is invalid: {0}")]
    ArtifactFileInvalid(String),
    #[error("artifact path is protected: {0}")]
    ProtectedPath(String),
    #[error("{0}")]
    Io(String),
}
