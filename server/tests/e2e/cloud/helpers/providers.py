from __future__ import annotations

import uuid

from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.integrations.sandbox.base import ProviderSandboxState
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
    if workspace.active_sandbox_id is None:
        raise CloudE2ETestError(f"Workspace {workspace_id} does not have an active sandbox.")
    sandbox = await db_session.get(CloudSandbox, workspace.active_sandbox_id)
    if sandbox is None:
        raise CloudE2ETestError(f"Sandbox {workspace.active_sandbox_id} was not found.")
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
