use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactRendererKind {
    Text,
    Markdown,
    Code,
    Html,
    Svg,
    Mermaid,
    React,
}

impl ArtifactRendererKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "markdown" => Some(Self::Markdown),
            "code" => Some(Self::Code),
            "html" => Some(Self::Html),
            "svg" => Some(Self::Svg),
            "mermaid" => Some(Self::Mermaid),
            "react" => Some(Self::React),
            _ => None,
        }
    }

    pub fn to_contract(&self) -> anyharness_contract::v1::ArtifactRenderer {
        match self {
            Self::Text => anyharness_contract::v1::ArtifactRenderer::Text,
            Self::Markdown => anyharness_contract::v1::ArtifactRenderer::Markdown,
            Self::Code => anyharness_contract::v1::ArtifactRenderer::Code,
            Self::Html => anyharness_contract::v1::ArtifactRenderer::Html,
            Self::Svg => anyharness_contract::v1::ArtifactRenderer::Svg,
            Self::Mermaid => anyharness_contract::v1::ArtifactRenderer::Mermaid,
            Self::React => anyharness_contract::v1::ArtifactRenderer::React,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactManifest {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub kind: String,
    pub renderer: ArtifactRendererKind,
    pub entry: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifactSummaryData {
    pub id: String,
    pub title: String,
    pub renderer: ArtifactRendererKind,
    pub entry: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifactDetailData {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub renderer: ArtifactRendererKind,
    pub entry: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ArtifactContentData {
    pub content_type: String,
    pub bytes: Vec<u8>,
}
