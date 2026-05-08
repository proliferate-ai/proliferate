from __future__ import annotations

from typing import TYPE_CHECKING, NoReturn
from uuid import UUID

from proliferate.auth.authorization import PolicyDenied
from proliferate.db.store.cloud_workspaces import load_cloud_workspace_by_id
from proliferate.db.store.organizations import load_active_membership
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workspaces.domain.policy import can_read_cloud_workspace

if TYPE_CHECKING:
    from proliferate.db.models.cloud import CloudWorkspace


def _raise_policy_denied(verdict: PolicyDenied) -> NoReturn:
    raise CloudApiError(verdict.code, verdict.message, status_code=verdict.status_code)


def _raise_workspace_not_found() -> NoReturn:
    _raise_policy_denied(
        PolicyDenied(
            code="workspace_not_found",
            message="Cloud workspace not found.",
            status_code=404,
        )
    )


async def cloud_workspace_user_can_read(
    user_id: UUID,
    workspace_id: UUID,
) -> CloudWorkspace:
    # Transitional: the cloud workspace service still consumes ORM objects.
    # Keep lookup/policy ownership here until the store returns snapshots.
    workspace = await load_cloud_workspace_by_id(workspace_id)
    if workspace is None:
        _raise_workspace_not_found()

    has_active_organization_membership = False
    if workspace.owner_scope == "organization" and workspace.organization_id is not None:
        membership = await load_active_membership(
            organization_id=workspace.organization_id,
            user_id=user_id,
        )
        has_active_organization_membership = membership is not None

    verdict = can_read_cloud_workspace(
        actor_user_id=user_id,
        owner_scope=workspace.owner_scope,
        owner_user_id=workspace.owner_user_id,
        organization_id=workspace.organization_id,
        has_active_organization_membership=has_active_organization_membership,
    )
    if isinstance(verdict, PolicyDenied):
        _raise_policy_denied(verdict)
    return workspace
