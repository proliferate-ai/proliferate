use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepoRootKind {
    External,
    Managed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepoRoot {
    pub id: String,
    pub kind: RepoRootKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_repo_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRepoRootFromPathRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRepoRootMobilityDestinationRequest {
    pub requested_branch: String,
    pub requested_base_sha: String,
    #[schema(pattern = "^[A-Za-z0-9._-]{1,96}$", max_length = 96)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_workspace_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRepoRootMobilityDestinationResponse {
    pub workspace: crate::v1::Workspace,
    pub created: bool,
}

// ---------------------------------------------------------------------------
// Local repository acquisition (clone-or-adopt) — PR 3
// ---------------------------------------------------------------------------

/// The single supported provider for repository acquisition today. Kept as a
/// closed enum so callers cannot request an unsupported host and the wire stays
/// forward-compatible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryProvider {
    Github,
}

/// The expected identity + fetch source for a repository the runtime should
/// acquire. `clone_url` may be HTTPS or SSH; the runtime relies solely on the
/// local Git credential chain to authenticate.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeRepositoryTarget {
    pub provider: RepositoryProvider,
    pub owner: String,
    pub name: String,
    pub clone_url: String,
}

/// Acquisition mode. Only `clone_or_adopt` is supported: clone into a
/// non-existent/empty destination, or adopt an existing matching main checkout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepoRootMaterializationMode {
    CloneOrAdopt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepoRootMaterializationOutcome {
    Cloned,
    Adopted,
    Reused,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeRepoRootRequest {
    /// Stable caller idempotency key.
    pub operation_id: String,
    pub repository: MaterializeRepositoryTarget,
    /// Absolute destination path selected by the user-facing host.
    pub destination_path: String,
    pub mode: RepoRootMaterializationMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeRepoRootResponse {
    pub operation_id: String,
    pub repo_root: RepoRoot,
    pub outcome: RepoRootMaterializationOutcome,
}

// ---------------------------------------------------------------------------
// Exact-ref workspace materialization — PR 3
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMaterializationOutcome {
    Created,
    Adopted,
    Reused,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeWorkspaceAtRefRequest {
    /// Stable caller idempotency key.
    pub operation_id: String,
    pub branch_name: String,
    pub head_sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred_workspace_name: Option<String>,
    #[schema(pattern = "^[A-Za-z0-9._-]{1,96}$", max_length = 96)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterializeWorkspaceAtRefResponse {
    pub operation_id: String,
    pub workspace: crate::v1::Workspace,
    pub observed_head_sha: String,
    pub outcome: WorkspaceMaterializationOutcome,
}
