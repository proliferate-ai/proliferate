from __future__ import annotations

import uuid

from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.integrations.sandbox.base import ProviderSandboxState
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.shared import CloudE2ETestError


async def load_workspace_record(
    db_session: AsyncSession,
    workspace_id: str,
) -> CloudWorkspace:
    workspace = await db_session.get(CloudWorkspace, uuid.UUID(workspace_id))
    if workspace is None:
        raise CloudE2ETestError(f"Workspace {workspace_id} was not found in the database.")
    await db_session.refresh(workspace)
    return workspace


async def load_active_sandbox_record(
    db_session: AsyncSession,
    workspace_id: str,
) -> CloudSandbox:
    workspace = await load_workspace_record(db_session, workspace_id)
    sandbox = (
        await db_session.execute(
            select(CloudSandbox).where(
                CloudSandbox.owner_user_id == workspace.owner_user_id,
                CloudSandbox.destroyed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if sandbox is None:
        raise CloudE2ETestError(f"Workspace {workspace_id} does not have an active sandbox.")
    await db_session.refresh(sandbox)
    return sandbox


async def provider_pause_native(provider_kind: str, external_sandbox_id: str) -> None:
    provider = get_sandbox_provider(provider_kind)
    await provider.pause_sandbox(external_sandbox_id)


async def provider_state(
    provider_kind: str,
    external_sandbox_id: str,
) -> ProviderSandboxState | None:
    provider = get_sandbox_provider(provider_kind)
    if provider_kind == "e2b":
        for state in await provider.list_sandbox_states():
            if state.external_sandbox_id == external_sandbox_id:
                return state
        return None
    return await provider.get_sandbox_state(external_sandbox_id)
