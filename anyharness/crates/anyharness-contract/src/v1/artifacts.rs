use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactRenderer {
    Text,
    Markdown,
    Code,
    Html,
    Svg,
    Mermaid,
    React,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifactSummary {
    pub id: String,
    pub title: String,
    pub renderer: ArtifactRenderer,
    pub entry: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceArtifactDetail {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub renderer: ArtifactRenderer,
    pub entry: String,
    pub created_at: String,
    pub updated_at: String,
}
