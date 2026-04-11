use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::v1::{Session, Workspace};

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkRoot {
    pub id: String,
    pub repo_root_id: String,
    pub repo_root_path: String,
    pub default_branch: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkStatus {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<CoworkRoot>,
    pub thread_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum CoworkArtifactType {
    #[serde(rename = "text/markdown")]
    TextMarkdown,
    #[serde(rename = "text/html")]
    TextHtml,
    #[serde(rename = "image/svg+xml")]
    ImageSvgXml,
    #[serde(rename = "application/vnd.proliferate.react")]
    ApplicationVndProliferateReact,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkArtifactSummary {
    pub id: String,
    pub path: String,
    #[schema(value_type = String)]
    pub r#type: CoworkArtifactType,
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

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkArtifactManifestResponse {
    pub version: u32,
    pub artifacts: Vec<CoworkArtifactSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkArtifactDetailResponse {
    pub artifact: CoworkArtifactSummary,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CoworkThread {
    pub id: String,
    pub repo_root_id: String,
    pub workspace_id: String,
    pub session_id: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_model_id: Option<String>,
    pub branch_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCoworkThreadRequest {
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCoworkThreadResponse {
    pub thread: CoworkThread,
    pub workspace: Workspace,
    pub session: Session,
}
