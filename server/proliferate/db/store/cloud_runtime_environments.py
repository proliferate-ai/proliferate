"""Persistence helpers for cloud runtime environments."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import ACTIVE_SANDBOX_STATUSES
from proliferate.constants.cloud import (
    CloudRuntimeEnvironmentStatus,
    CloudRuntimeIsolationPolicy,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudRuntimeEnvironment, CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.utils.time import utcnow

_UNSET = object()


@dataclass(frozen=True)
class RuntimeEnvironmentWithSandbox:
    environment: CloudRuntimeEnvironment
    sandbox: CloudSandbox | None


def normalize_repo_identity(value: str) -> str:
    return value.strip().lower()


async def ensure_runtime_environment_for_repo(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    created_by_user_id: UUID | None = None,
    isolation_policy: str = CloudRuntimeIsolationPolicy.repo_shared.value,
) -> CloudRuntimeEnvironment:
    git_owner_norm = normalize_repo_identity(git_owner)
    git_repo_name_norm = normalize_repo_identity(git_repo_name)
    existing = (
        await db.execute(
            select(CloudRuntimeEnvironment).where(
                CloudRuntimeEnvironment.user_id == user_id,
                CloudRuntimeEnvironment.organization_id.is_(None),
                CloudRuntimeEnvironment.git_provider == git_provider,
                CloudRuntimeEnvironment.git_owner_norm == git_owner_norm,
                CloudRuntimeEnvironment.git_repo_name_norm == git_repo_name_norm,
                CloudRuntimeEnvironment.isolation_policy == isolation_policy,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    billing_subject = await ensure_personal_billing_subject(db, user_id)
    now = utcnow()
    environment = CloudRuntimeEnvironment(
        user_id=user_id,
        organization_id=None,
        created_by_user_id=created_by_user_id or user_id,
        billing_subject_id=billing_subject.id,
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_owner_norm=git_owner_norm,
        git_repo_name_norm=git_repo_name_norm,
        isolation_policy=isolation_policy,
        status=CloudRuntimeEnvironmentStatus.pending.value,
        active_sandbox_id=None,
        runtime_generation=0,
        credential_snapshot_version=0,
        repo_env_applied_version=0,
        created_at=now,
        updated_at=now,
    )
    db.add(environment)
    await db.flush()
    return environment


async def get_runtime_environment_by_id(
    db: AsyncSession,
    runtime_environment_id: UUID,
) -> CloudRuntimeEnvironment | None:
    return await db.get(CloudRuntimeEnvironment, runtime_environment_id)


async def get_runtime_environment_for_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudRuntimeEnvironment | None:
    if workspace.runtime_environment_id is None:
        return None
    return await db.get(CloudRuntimeEnvironment, workspace.runtime_environment_id)


async def ensure_runtime_environment_for_workspace(
    db: AsyncSession,
    workspace: CloudWorkspace,
) -> CloudRuntimeEnvironment:
    environment = await get_runtime_environment_for_workspace(db, workspace)
    if environment is not None:
        return environment
    environment = await ensure_runtime_environment_for_repo(
        db,
        user_id=workspace.user_id,
        git_provider=workspace.git_provider,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        created_by_user_id=workspace.user_id,
    )
    workspace.runtime_environment_id = environment.id
    workspace.billing_subject_id = environment.billing_subject_id
    workspace.updated_at = utcnow()
    await db.flush()
    return environment


async def get_active_sandbox_for_environment(
    db: AsyncSession,
    environment: CloudRuntimeEnvironment,
) -> CloudSandbox | None:
    if environment.active_sandbox_id is None:
        return None
    return await db.get(CloudSandbox, environment.active_sandbox_id)


async def reserve_sandbox_slot_for_environment(
    db: AsyncSession,
    *,
    runtime_environment_id: UUID,
    external_sandbox_id: str | None,
    provider: str,
    template_version: str,
    status: str,
    started_at: datetime | None,
    concurrent_sandbox_limit: int | None,
) -> CloudSandbox | None:
    environment = await get_runtime_environment_by_id(db, runtime_environment_id)
    if environment is None:
        raise RuntimeError("Runtime environment disappeared before sandbox attachment.")

    if concurrent_sandbox_limit is not None:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": f"billing-subject:{environment.billing_subject_id}"},
        )
        active_sandbox_count = int(
            await db.scalar(
                select(func.count(CloudSandbox.id))
                .join(
                    CloudRuntimeEnvironment,
                    CloudSandbox.runtime_environment_id == CloudRuntimeEnvironment.id,
                )
                .where(
                    CloudRuntimeEnvironment.billing_subject_id == environment.billing_subject_id,
                    CloudSandbox.status.in_(ACTIVE_SANDBOX_STATUSES),
                )
            )
            or 0
        )
        if active_sandbox_count >= concurrent_sandbox_limit:
            return None

    now = utcnow()
    sandbox = CloudSandbox(
        runtime_environment_id=environment.id,
        cloud_workspace_id=None,
        provider=provider,
        external_sandbox_id=external_sandbox_id,
        status=status,
        template_version=template_version,
        started_at=started_at,
        created_at=now,
        updated_at=now,
    )
    db.add(sandbox)
    await db.flush()
    environment.active_sandbox_id = sandbox.id
    environment.status = CloudRuntimeEnvironmentStatus.provisioning.value
    environment.updated_at = now
    await db.flush()
    return sandbox


async def persist_runtime_environment_state(
    db: AsyncSession,
    environment: CloudRuntimeEnvironment,
    *,
    status: str | object = _UNSET,
    runtime_url: str | None | object = _UNSET,
    runtime_token_ciphertext: str | None | object = _UNSET,
    anyharness_data_key_ciphertext: str | None | object = _UNSET,
    root_anyharness_workspace_id: str | None | object = _UNSET,
    root_anyharness_repo_root_id: str | None | object = _UNSET,
    active_sandbox_id: UUID | None | object = _UNSET,
    increment_runtime_generation: bool = False,
    repo_env_applied_version: int | object = _UNSET,
    last_error: str | None | object = _UNSET,
) -> CloudRuntimeEnvironment:
    if status is not _UNSET:
        environment.status = status
    if runtime_url is not _UNSET:
        environment.runtime_url = runtime_url
    if runtime_token_ciphertext is not _UNSET:
        environment.runtime_token_ciphertext = runtime_token_ciphertext
    if anyharness_data_key_ciphertext is not _UNSET:
        environment.anyharness_data_key_ciphertext = anyharness_data_key_ciphertext
    if root_anyharness_workspace_id is not _UNSET:
        environment.root_anyharness_workspace_id = root_anyharness_workspace_id
    if root_anyharness_repo_root_id is not _UNSET:
        environment.root_anyharness_repo_root_id = root_anyharness_repo_root_id
    if active_sandbox_id is not _UNSET:
        environment.active_sandbox_id = active_sandbox_id
    if repo_env_applied_version is not _UNSET:
        environment.repo_env_applied_version = repo_env_applied_version
    if last_error is not _UNSET:
        environment.last_error = last_error[:2000] if isinstance(last_error, str) else None
    if increment_runtime_generation:
        environment.runtime_generation = environment.runtime_generation + 1
    environment.updated_at = utcnow()
    await db.flush()
    return environment


async def ensure_runtime_environment_for_workspace_id(
    workspace_id: UUID,
) -> CloudRuntimeEnvironment | None:
    async with db_engine.async_session_factory() as db:
        workspace = await db.get(CloudWorkspace, workspace_id)
        if workspace is None:
            return None
        environment = await ensure_runtime_environment_for_workspace(db, workspace)
        await db.commit()
        await db.refresh(environment)
        return environment


async def load_runtime_environment_by_id(
    runtime_environment_id: UUID,
) -> CloudRuntimeEnvironment | None:
    async with db_engine.async_session_factory() as db:
        return await db.get(CloudRuntimeEnvironment, runtime_environment_id)


async def load_runtime_environment_for_workspace(
    workspace: CloudWorkspace,
) -> CloudRuntimeEnvironment | None:
    if workspace.runtime_environment_id is None:
        return None
    async with db_engine.async_session_factory() as db:
        return await db.get(CloudRuntimeEnvironment, workspace.runtime_environment_id)


async def load_runtime_environment_with_sandbox(
    runtime_environment_id: UUID,
) -> RuntimeEnvironmentWithSandbox | None:
    async with db_engine.async_session_factory() as db:
        environment = await db.get(CloudRuntimeEnvironment, runtime_environment_id)
        if environment is None:
            return None
        sandbox = await get_active_sandbox_for_environment(db, environment)
        return RuntimeEnvironmentWithSandbox(environment=environment, sandbox=sandbox)


async def reserve_and_attach_sandbox_for_environment(
    runtime_environment_id: UUID,
    *,
    external_sandbox_id: str | None,
    provider: str,
    template_version: str,
    status: str = "provisioning",
    started_at: datetime | None = None,
    concurrent_sandbox_limit: int | None,
) -> CloudSandbox | None:
    async with db_engine.async_session_factory() as db:
        sandbox = await reserve_sandbox_slot_for_environment(
            db,
            runtime_environment_id=runtime_environment_id,
            external_sandbox_id=external_sandbox_id,
            provider=provider,
            template_version=template_version,
            status=status,
            started_at=started_at,
            concurrent_sandbox_limit=concurrent_sandbox_limit,
        )
        await db.commit()
        if sandbox is not None:
            await db.refresh(sandbox)
        return sandbox


async def save_runtime_environment_state(
    runtime_environment_id: UUID,
    **kwargs: object,
) -> CloudRuntimeEnvironment:
    async with db_engine.async_session_factory() as db:
        environment = await db.get(CloudRuntimeEnvironment, runtime_environment_id)
        if environment is None:
            raise RuntimeError("Runtime environment not found.")
        updated = await persist_runtime_environment_state(db, environment, **kwargs)
        await db.commit()
        await db.refresh(updated)
        return updated
