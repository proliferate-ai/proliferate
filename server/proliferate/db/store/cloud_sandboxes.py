"""Persistence helpers for the personal cloud sandbox.

The cloud sandbox product API is backed by ``cloud_sandbox``. Keep the
function names here stable while the server callers are migrated off the old
``cloud_sandbox`` table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.utils.time import utcnow

_UNSET: Final = object()


@dataclass(frozen=True)
class CloudSandboxValue:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID | None
    billing_subject_id: UUID | None
    status: str
    last_error: str | None
    e2b_sandbox_id: str | None
    e2b_template_ref: str
    anyharness_base_url: str | None
    anyharness_bearer_token_ciphertext: str | None
    anyharness_data_key_ciphertext: str | None
    runtime_generation: int
    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None
    last_health_at: datetime | None
    destroyed_at: datetime | None


def cloud_sandbox_value(row: CloudSandbox) -> CloudSandboxValue:
    status = row.status.value if hasattr(row.status, "value") else row.status
    sandbox_type = (
        row.sandbox_type.value
        if hasattr(row.sandbox_type, "value")
        else row.sandbox_type
    )
    return CloudSandboxValue(
        id=row.id,
        owner_scope="personal" if row.owner_user_id is not None else "unknown",
        owner_user_id=row.owner_user_id,
        organization_id=None,
        created_by_user_id=row.owner_user_id,
        billing_subject_id=None,
        status=status,
        last_error=None,
        e2b_sandbox_id=row.provider_sandbox_id,
        e2b_template_ref=sandbox_type,
        anyharness_base_url=row.anyharness_base_url,
        anyharness_bearer_token_ciphertext=row.runtime_token_ciphertext,
        anyharness_data_key_ciphertext=row.anyharness_data_key_ciphertext,
        runtime_generation=0,
        created_at=row.created_at,
        updated_at=row.updated_at,
        ready_at=row.ready_at,
        last_health_at=row.last_health_at,
        destroyed_at=row.destroyed_at,
    )


async def acquire_cloud_sandbox_owner_lock(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
) -> None:
    del organization_id
    if owner_scope != "personal" or owner_user_id is None:
        raise ValueError("Only personal cloud sandboxes are supported.")
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"cloud-sandbox:personal:{owner_user_id}"},
    )


async def load_personal_cloud_sandbox(
    db: AsyncSession,
    user_id: UUID,
    *,
    lock_row: bool = False,
) -> CloudSandboxValue | None:
    stmt = select(CloudSandbox).where(
        CloudSandbox.owner_user_id == user_id,
        CloudSandbox.destroyed_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def load_organization_cloud_sandbox(
    db: AsyncSession,
    organization_id: UUID,
    *,
    lock_row: bool = False,
) -> CloudSandboxValue | None:
    del db, organization_id, lock_row
    return None


async def load_cloud_sandbox_by_id(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    lock_row: bool = False,
) -> CloudSandboxValue | None:
    stmt = select(CloudSandbox).where(CloudSandbox.id == sandbox_id)
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def load_cloud_sandbox_by_provider_sandbox_id(
    db: AsyncSession,
    provider_sandbox_id: str,
    *,
    lock_row: bool = False,
) -> CloudSandboxValue | None:
    stmt = select(CloudSandbox).where(
        CloudSandbox.provider_sandbox_id == provider_sandbox_id,
        CloudSandbox.destroyed_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def ensure_personal_cloud_sandbox(
    db: AsyncSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID,
    billing_subject_id: UUID,
    e2b_template_ref: str,
) -> CloudSandboxValue:
    del created_by_user_id, billing_subject_id, e2b_template_ref
    existing = await load_personal_cloud_sandbox(db, user_id, lock_row=True)
    if existing is not None:
        return existing
    now = utcnow()
    row = CloudSandbox(
        owner_user_id=user_id,
        sandbox_type="e2b",
        provider_sandbox_id=None,
        status="creating",
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return cloud_sandbox_value(row)


async def ensure_organization_cloud_sandbox(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID | None,
    billing_subject_id: UUID,
    e2b_template_ref: str,
) -> CloudSandboxValue:
    del db, organization_id, created_by_user_id, billing_subject_id, e2b_template_ref
    raise ValueError("Organization cloud sandboxes are not supported.")


async def update_cloud_sandbox_status(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    status: str,
    last_error: str | None | object = _UNSET,
) -> CloudSandboxValue | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    row.status = status
    del last_error
    row.updated_at = utcnow()
    await db.flush()
    return cloud_sandbox_value(row)


async def record_cloud_sandbox_provider_sandbox(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    e2b_sandbox_id: str,
    e2b_template_ref: str,
) -> CloudSandboxValue | None:
    del e2b_template_ref
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None or row.destroyed_at is not None:
        return None
    row.provider_sandbox_id = e2b_sandbox_id
    row.status = "creating"
    row.updated_at = utcnow()
    await db.flush()
    return cloud_sandbox_value(row)


async def mark_cloud_sandbox_ready(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    e2b_sandbox_id: str,
    e2b_template_ref: str,
    anyharness_base_url: str,
    anyharness_bearer_token_ciphertext: str,
    anyharness_data_key_ciphertext: str,
) -> CloudSandboxValue | None:
    del e2b_template_ref
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None or row.destroyed_at is not None:
        return None
    now = utcnow()
    row.status = "ready"
    row.provider_sandbox_id = e2b_sandbox_id
    row.anyharness_base_url = anyharness_base_url
    row.runtime_token_ciphertext = anyharness_bearer_token_ciphertext
    row.anyharness_data_key_ciphertext = anyharness_data_key_ciphertext
    row.ready_at = now
    row.last_health_at = now
    row.updated_at = now
    await db.flush()
    return cloud_sandbox_value(row)


async def mark_cloud_sandbox_provider_state(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    status: str,
    e2b_sandbox_id: str | None | object = _UNSET,
) -> CloudSandboxValue | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    now = utcnow()
    if e2b_sandbox_id is not _UNSET:
        row.provider_sandbox_id = e2b_sandbox_id
    row.status = "ready" if status == "running" else status
    if row.status == "ready":
        if row.ready_at is None:
            row.ready_at = now
        row.last_health_at = now
    elif row.status == "destroyed":
        row.destroyed_at = now
    row.updated_at = now
    await db.flush()
    return cloud_sandbox_value(row)


async def mark_cloud_sandbox_health(
    db: AsyncSession,
    sandbox_id: UUID,
) -> CloudSandboxValue | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None or row.destroyed_at is not None:
        return None
    row.last_health_at = utcnow()
    row.updated_at = row.last_health_at
    await db.flush()
    return cloud_sandbox_value(row)


async def mark_cloud_sandbox_destroyed(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    last_error: str | None = None,
) -> CloudSandboxValue | None:
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    now = utcnow()
    row.status = "destroyed"
    del last_error
    row.destroyed_at = now
    row.updated_at = now
    await db.flush()
    return cloud_sandbox_value(row)
