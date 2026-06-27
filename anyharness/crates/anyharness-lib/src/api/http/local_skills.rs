use anyharness_contract::v1::{
    DeleteSkillResponse, InstallSkillRequest, InstalledSkill, InstalledSkillsResponse,
    MarketplaceSkillSearchResponse, UpdateWorkspaceSkillRequest, WorkspaceSkill,
    WorkspaceSkillsResponse,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use serde::Deserialize;

use super::access::assert_workspace_auth_scope;
use super::error::ApiError;
use crate::api::auth::AuthContext;
use crate::app::AppState;
use crate::domains::local_skills::service::LocalSkillError;
use crate::integrations::skills_sh::SkillsShClientError;

#[derive(Debug, Deserialize)]
pub struct MarketplaceSearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
}

#[utoipa::path(
    get,
    path = "/v1/skills",
    responses((status = 200, description = "Installed local skills", body = InstalledSkillsResponse)),
    tag = "skills"
)]
pub async fn list_skills(
    State(state): State<AppState>,
) -> Result<Json<InstalledSkillsResponse>, ApiError> {
    state
        .local_skill_service
        .list_installed()
        .map(|skills| Json(InstalledSkillsResponse { skills }))
        .map_err(map_local_skill_error)
}

#[utoipa::path(
    get,
    path = "/v1/skills/marketplace/search",
    params(
        ("q" = Option<String>, Query, description = "Marketplace search query"),
        ("limit" = Option<usize>, Query, description = "Maximum result count")
    ),
    responses(
        (status = 200, description = "Marketplace skill search results", body = MarketplaceSkillSearchResponse),
        (status = 409, description = "Marketplace auth required", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "skills"
)]
pub async fn search_marketplace(
    State(state): State<AppState>,
    Query(query): Query<MarketplaceSearchQuery>,
) -> Result<Json<MarketplaceSkillSearchResponse>, ApiError> {
    state
        .local_skill_service
        .search_marketplace(query.q.as_deref().unwrap_or_default(), query.limit)
        .await
        .map(Json)
        .map_err(map_local_skill_error)
}

#[utoipa::path(
    post,
    path = "/v1/skills/install",
    request_body = InstallSkillRequest,
    responses(
        (status = 200, description = "Installed local skill", body = InstalledSkill),
        (status = 409, description = "Audit confirmation required or install blocked", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "skills"
)]
pub async fn install_skill(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<InstallSkillRequest>,
) -> Result<Json<InstalledSkill>, ApiError> {
    if let Some(workspace_id) = req.enable_for_workspace_id.as_deref() {
        assert_workspace_auth_scope(&auth, workspace_id)?;
    }
    state
        .local_skill_service
        .install_from_marketplace(
            &req.skill_id,
            req.enable_for_workspace_id.as_deref(),
            req.allow_missing_audit,
            req.allow_warning_audit,
        )
        .await
        .map(Json)
        .map_err(map_local_skill_error)
}

#[utoipa::path(
    delete,
    path = "/v1/skills/{skill_id}",
    params(("skill_id" = String, Path, description = "Local skill ID")),
    responses((status = 200, description = "Deleted local skill", body = DeleteSkillResponse)),
    tag = "skills"
)]
pub async fn delete_skill(
    State(state): State<AppState>,
    Path(skill_id): Path<String>,
) -> Result<Json<DeleteSkillResponse>, ApiError> {
    state
        .local_skill_service
        .delete_skill(&skill_id)
        .map(|deleted| Json(DeleteSkillResponse { deleted }))
        .map_err(map_local_skill_error)
}

#[utoipa::path(
    get,
    path = "/v1/workspaces/{workspace_id}/skills",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses((status = 200, description = "Workspace local skills", body = WorkspaceSkillsResponse)),
    tag = "skills"
)]
pub async fn list_workspace_skills(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(workspace_id): Path<String>,
) -> Result<Json<WorkspaceSkillsResponse>, ApiError> {
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    state
        .local_skill_service
        .workspace_skills(&workspace_id)
        .map(Json)
        .map_err(map_local_skill_error)
}

#[utoipa::path(
    patch,
    path = "/v1/workspaces/{workspace_id}/skills/{skill_id}",
    params(
        ("workspace_id" = String, Path, description = "Workspace ID"),
        ("skill_id" = String, Path, description = "Local skill ID")
    ),
    request_body = UpdateWorkspaceSkillRequest,
    responses((status = 200, description = "Updated workspace local skill", body = WorkspaceSkill)),
    tag = "skills"
)]
pub async fn update_workspace_skill(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path((workspace_id, skill_id)): Path<(String, String)>,
    Json(req): Json<UpdateWorkspaceSkillRequest>,
) -> Result<Json<WorkspaceSkill>, ApiError> {
    assert_workspace_auth_scope(&auth, &workspace_id)?;
    state
        .local_skill_service
        .set_workspace_skill_enabled(&workspace_id, &skill_id, req.enabled)
        .map(Json)
        .map_err(map_local_skill_error)
}

fn map_local_skill_error(error: LocalSkillError) -> ApiError {
    match error {
        LocalSkillError::NotFound(skill_id) => ApiError::not_found(
            format!("Local skill not found: {skill_id}"),
            "LOCAL_SKILL_NOT_FOUND",
        ),
        LocalSkillError::InvalidSnapshot(detail) => {
            ApiError::bad_request(detail, "LOCAL_SKILL_INVALID")
        }
        LocalSkillError::AuditFailed => ApiError::conflict(
            "Failed skills.sh audits block install.",
            "LOCAL_SKILL_AUDIT_FAILED",
        ),
        LocalSkillError::AuditConfirmationRequired(status) => ApiError::conflict(
            format!("Skill audit status requires explicit confirmation: {status:?}"),
            "LOCAL_SKILL_AUDIT_CONFIRMATION_REQUIRED",
        ),
        LocalSkillError::Marketplace(SkillsShClientError::MissingAuthToken) => ApiError::conflict(
            "Set SKILLS_SH_AUTH_TOKEN or VERCEL_OIDC_TOKEN to search skills.sh marketplace.",
            "SKILLS_SH_AUTH_REQUIRED",
        ),
        LocalSkillError::Marketplace(SkillsShClientError::Unauthorized) => ApiError::unauthorized(
            "skills.sh rejected the configured marketplace token.",
            "SKILLS_SH_UNAUTHORIZED",
        ),
        LocalSkillError::Marketplace(error) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "Bad gateway",
            Some(error.to_string()),
            Some("SKILLS_SH_REQUEST_FAILED"),
        ),
        LocalSkillError::Internal(error) => ApiError::internal(error.to_string()),
    }
}
