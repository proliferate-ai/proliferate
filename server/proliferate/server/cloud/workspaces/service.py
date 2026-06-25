from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity, OwnerSelection
from proliferate.db.store.cloud_workspaces import (
    get_active_cloud_workspace_for_managed_profile_branch,
    get_active_cloud_workspace_for_runtime_branch,
    get_cloud_workspace_by_id,
    list_claimed_organization_workspaces_for_user,
    list_exposed_cloud_workspaces_for_user,
    list_organization_workspaces_for_admin_audit,
    list_unclaimed_organization_workspaces,
    update_workspace_branch,
    update_workspace_display_name,
)
from proliferate.db.store.cloud_workspace_lifecycle import archive_cloud_workspace_record
from proliferate.db.store.cloud_workspaces import (
    list_cloud_workspaces as list_cloud_workspaces_store,
)
from proliferate.server.cloud.claims.domain.policy import is_org_admin_role
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.access import (
    cloud_workspace_user_can_interact_with_db,
    cloud_workspace_user_can_read_with_db,
)
from proliferate.server.cloud.workspaces.details import (
    build_workspace_detail_for_request as _build_workspace_detail_for_request,
)
from proliferate.server.cloud.workspaces.details import (
    workspace_summaries_for_request as _workspace_summaries_for_request,
)
from proliferate.server.cloud.workspaces.models import (
    WorkspaceDetail,
    WorkspaceSummary,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
    resolve_owner_context,
)

MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS = 160


def _map_owner_context_error(error: OrganizationServiceError) -> NoReturn:
    raise CloudApiError(error.code, error.message, status_code=error.status_code) from error


async def list_cloud_workspaces_for_user(
    db: AsyncSession,
    user_id: UUID,
    *,
    user: ActorIdentity | None = None,
    owner_selection: OwnerSelection | None = None,
    scope: str | None = None,
    lifecycle: str = "active",
) -> list[WorkspaceSummary]:
    list_scope = scope or (
        "unclaimed"
        if owner_selection is not None and owner_selection.owner_scope == "organization"
        else "my"
    )
    if list_scope in {"unclaimed", "claimable", "org-all"}:
        if user is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        try:
            owner_context = await resolve_owner_context(
                user,
                owner_selection or OwnerSelection(owner_scope="organization"),
                db=db,
            )
        except OrganizationServiceError as error:
            _map_owner_context_error(error)
        if owner_context.organization_id is None:
            raise CloudApiError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        if list_scope == "org-all" and not is_org_admin_role(owner_context.membership_role):
            raise CloudApiError(
                "organization_permission_denied",
                "You do not have permission to view organization workspace audit data.",
                status_code=403,
            )
        if list_scope == "org-all":
            workspaces = await list_organization_workspaces_for_admin_audit(
                db,
                organization_id=owner_context.organization_id,
                lifecycle=lifecycle,
            )
        else:
            workspaces = await list_unclaimed_organization_workspaces(
                db,
                organization_id=owner_context.organization_id,
                lifecycle=lifecycle,
            )
        return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)

    if list_scope == "exposed":
        organization_id = (
            owner_selection.organization_id
            if owner_selection is not None and owner_selection.owner_scope == "organization"
            else None
        )
        workspaces = await list_exposed_cloud_workspaces_for_user(
            db,
            user_id=user_id,
            organization_id=organization_id,
            lifecycle=lifecycle,
        )
        return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)

    if list_scope != "my":
        raise CloudApiError(
            "invalid_workspace_scope",
            "Unsupported workspace scope.",
            status_code=400,
        )

    workspaces = await list_cloud_workspaces_store(db, user_id, lifecycle=lifecycle)
    claimed_workspaces = await list_claimed_organization_workspaces_for_user(
        db,
        user_id=user_id,
        lifecycle=lifecycle,
    )
    workspaces = sorted(
        [*workspaces, *claimed_workspaces],
        key=lambda workspace: workspace.updated_at,
        reverse=True,
    )
    return await _workspace_summaries_for_request(db, user_id=user_id, workspaces=workspaces)


async def get_cloud_workspace_detail(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> WorkspaceDetail:
    workspace = await cloud_workspace_user_can_read_with_db(db, user_id, workspace_id)
    return await _build_workspace_detail_for_request(db, workspace)


async def sync_cloud_workspace_branch(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
    *,
    branch_name: str,
) -> WorkspaceDetail:
    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Branch name is required.",
            status_code=400,
        )
    workspace = await _load_workspace_for_branch_sync(db, user_id, workspace_id)
    if workspace.git_branch == cleaned_branch_name:
        return await _build_workspace_detail_for_request(db, workspace)

    conflict = await _find_branch_sync_conflict(db, workspace, cleaned_branch_name)
    if conflict is not None:
        if _is_managed_workspace_projection_sibling(workspace, conflict):
            if workspace.archived_at is None:
                await archive_cloud_workspace_record(db, workspace=workspace)
            return await _build_workspace_detail_for_request(db, conflict)
        raise CloudApiError(
            "cloud_branch_already_exists",
            f"A cloud workspace already exists for branch '{cleaned_branch_name}'.",
            status_code=409,
        )

    workspace = await update_workspace_branch(db, workspace, cleaned_branch_name)
    return await _build_workspace_detail_for_request(db, workspace)


async def _find_branch_sync_conflict(
    db: AsyncSession,
    workspace: object,
    branch_name: str,
) -> object | None:
    runtime_environment_id = getattr(workspace, "runtime_environment_id", None)
    if runtime_environment_id is not None:
        return await get_active_cloud_workspace_for_runtime_branch(
            db,
            runtime_environment_id=runtime_environment_id,
            git_branch=branch_name,
            exclude_workspace_id=workspace.id,
        )
    sandbox_profile_id = getattr(workspace, "sandbox_profile_id", None)
    target_id = getattr(workspace, "target_id", None)
    if sandbox_profile_id is None or target_id is None:
        return None
    return await get_active_cloud_workspace_for_managed_profile_branch(
        db,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
        git_provider=workspace.git_provider,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=branch_name,
        exclude_workspace_id=workspace.id,
    )


async def _load_workspace_for_branch_sync(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
) -> object:
    try:
        return await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    except CloudApiError as error:
        if error.code != "workspace_not_found":
            raise
        workspace = await get_cloud_workspace_by_id(db, workspace_id)
        if not (
            workspace is not None
            and workspace.archived_at is not None
            and workspace.owner_scope == "personal"
            and workspace.owner_user_id == user_id
            and workspace.sandbox_profile_id is not None
            and workspace.target_id is not None
        ):
            raise
        return workspace


def _is_managed_workspace_projection_sibling(
    left: object,
    right: object,
) -> bool:
    return bool(
        getattr(left, "sandbox_profile_id", None)
        and getattr(left, "target_id", None)
        and getattr(left, "sandbox_profile_id", None) == getattr(right, "sandbox_profile_id", None)
        and getattr(left, "target_id", None) == getattr(right, "target_id", None)
        and getattr(left, "git_provider", None) == getattr(right, "git_provider", None)
        and getattr(left, "git_owner", None) == getattr(right, "git_owner", None)
        and getattr(left, "git_repo_name", None) == getattr(right, "git_repo_name", None)
    )


async def sync_cloud_workspace_display_name(
    db: AsyncSession,
    user_id: UUID,
    workspace_id: UUID,
    *,
    display_name: str | None,
) -> WorkspaceDetail:
    """Set or clear the user-provided cloud workspace display name.

    `display_name=None` (or an empty/whitespace string) clears the override
    and restores the default branch- or repo-derived label in the sidebar.
    """
    cleaned: str | None
    if display_name is None or not display_name.strip():
        cleaned = None
    else:
        cleaned = display_name.strip()
        if len(cleaned) > MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS:
            raise CloudApiError(
                "invalid_display_name",
                (
                    "Workspace display name cannot exceed "
                    f"{MAX_CLOUD_WORKSPACE_DISPLAY_NAME_CHARS} characters."
                ),
                status_code=400,
            )
    workspace = await cloud_workspace_user_can_interact_with_db(db, user_id, workspace_id)
    workspace = await update_workspace_display_name(db, workspace, cleaned)
    return await _build_workspace_detail_for_request(db, workspace)
