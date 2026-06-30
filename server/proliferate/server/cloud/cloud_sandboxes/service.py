"""Current-model facade for personal cloud sandboxes.

This module is intentionally small while the old profile/target implementation is
parked. It talks to the simplified ``cloud_sandbox``/``repo_environment`` model
and keeps mounted gateway/API routes from importing the removed profile-target
ORM stack.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store import billing_subjects
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import repositories as repo_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.cloud_sandboxes.repo_runtime_connections import (
    CloudSandboxRepoRuntimeConnection,
)
from proliferate.utils.crypto import decrypt_text


class _UserWithId(Protocol):
    id: UUID


@dataclass(frozen=True)
class CloudSandboxWorkspaceRuntimeConnection:
    anyharness_workspace_id: str
    anyharness_repo_root_id: str | None
    runtime_generation: int


async def get_cloud_sandbox_detail(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue | None:
    return await sandbox_store.load_personal_cloud_sandbox(db, user.id)


async def ensure_cloud_sandbox_ready(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue:
    await sandbox_store.acquire_cloud_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    billing_subject = await billing_subjects.ensure_personal_billing_subject(db, user.id)
    sandbox = await sandbox_store.ensure_personal_cloud_sandbox(
        db,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="e2b",
    )
    return sandbox


async def wake_cloud_sandbox(db: AsyncSession, user: _UserWithId) -> CloudSandboxValue:
    return await ensure_cloud_sandbox_ready(db, user)


async def destroy_cloud_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue | None:
    sandbox = await sandbox_store.load_personal_cloud_sandbox(db, user.id, lock_row=True)
    if sandbox is None:
        return None
    return await sandbox_store.mark_cloud_sandbox_destroyed(db, sandbox.id)


async def load_cloud_sandbox_runtime_access(
    sandbox: CloudSandboxValue,
) -> tuple[str, str, str]:
    if (
        not sandbox.anyharness_base_url
        or not sandbox.anyharness_bearer_token_ciphertext
        or not sandbox.anyharness_data_key_ciphertext
    ):
        raise CloudApiError(
            "cloud_sandbox_runtime_not_ready",
            "Cloud sandbox runtime access is not ready.",
            status_code=409,
        )
    return (
        sandbox.anyharness_base_url,
        decrypt_text(sandbox.anyharness_bearer_token_ciphertext),
        decrypt_text(sandbox.anyharness_data_key_ciphertext),
    )


async def ensure_cloud_sandbox_repo_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    git_owner: str,
    git_repo_name: str,
) -> CloudSandboxRepoRuntimeConnection:
    repo_environment = await repo_store.get_cloud_repo_environment(
        db,
        user_id=user.id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Cloud repo environment not found.",
            status_code=404,
        )

    del repo_environment
    raise CloudApiError(
        "cloud_repo_materialization_not_available",
        "Cloud repo materialization is not available in this model-cleanup build.",
        status_code=501,
    )


async def ensure_cloud_sandbox_workspace_runtime_connection(
    db: AsyncSession,
    user: _UserWithId,
    *,
    workspace_id: UUID,
) -> CloudSandboxWorkspaceRuntimeConnection:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if (
        workspace is None
        or workspace.owner_user_id != user.id
        or workspace.archived_at is not None
    ):
        raise CloudApiError("workspace_not_found", "Cloud workspace not found.", status_code=404)
    repo_environment = await repo_store.get_repo_environment_by_id(
        db,
        workspace.repo_environment_id,
    )
    if repo_environment is None:
        raise CloudApiError(
            "cloud_repo_environment_not_found",
            "Cloud repo environment not found.",
            status_code=404,
        )
    repo_connection = await ensure_cloud_sandbox_repo_runtime_connection(
        db,
        user,
        git_owner=repo_environment.git_owner,
        git_repo_name=repo_environment.git_repo_name,
    )
    return CloudSandboxWorkspaceRuntimeConnection(
        anyharness_workspace_id=workspace.anyharness_workspace_id
        or repo_connection.anyharness_workspace_id,
        anyharness_repo_root_id=repo_connection.anyharness_repo_root_id,
        runtime_generation=repo_connection.runtime_generation,
    )
