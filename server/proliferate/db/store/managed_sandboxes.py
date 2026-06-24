"""Persistence helpers for managed cloud sandboxes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.managed_sandboxes import ManagedSandbox
from proliferate.utils.time import utcnow

_UNSET: Final = object()


@dataclass(frozen=True)
class ManagedSandboxValue:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID | None
    billing_subject_id: UUID
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


def managed_sandbox_value(row: ManagedSandbox) -> ManagedSandboxValue:
    return ManagedSandboxValue(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        billing_subject_id=row.billing_subject_id,
        status=row.status,
        last_error=row.last_error,
        e2b_sandbox_id=row.e2b_sandbox_id,
        e2b_template_ref=row.e2b_template_ref,
        anyharness_base_url=row.anyharness_base_url,
        anyharness_bearer_token_ciphertext=row.anyharness_bearer_token_ciphertext,
        anyharness_data_key_ciphertext=row.anyharness_data_key_ciphertext,
        runtime_generation=row.runtime_generation,
        created_at=row.created_at,
        updated_at=row.updated_at,
        ready_at=row.ready_at,
        last_health_at=row.last_health_at,
        destroyed_at=row.destroyed_at,
    )


async def acquire_managed_sandbox_owner_lock(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
) -> None:
    if owner_scope == "personal" and owner_user_id is not None:
        lock_key = f"managed-sandbox:personal:{owner_user_id}"
    elif owner_scope == "organization" and organization_id is not None:
        lock_key = f"managed-sandbox:organization:{organization_id}"
    else:
        raise ValueError("Managed sandbox owner fields do not match owner scope.")
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": lock_key},
    )


async def load_personal_managed_sandbox(
    db: AsyncSession,
    user_id: UUID,
    *,
    lock_row: bool = False,
) -> ManagedSandboxValue | None:
    stmt = select(ManagedSandbox).where(
        ManagedSandbox.owner_scope == "personal",
        ManagedSandbox.owner_user_id == user_id,
        ManagedSandbox.destroyed_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return managed_sandbox_value(row) if row is not None else None


async def load_organization_managed_sandbox(
    db: AsyncSession,
    organization_id: UUID,
    *,
    lock_row: bool = False,
) -> ManagedSandboxValue | None:
    stmt = select(ManagedSandbox).where(
        ManagedSandbox.owner_scope == "organization",
        ManagedSandbox.organization_id == organization_id,
        ManagedSandbox.destroyed_at.is_(None),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return managed_sandbox_value(row) if row is not None else None


async def load_managed_sandbox_by_id(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    lock_row: bool = False,
) -> ManagedSandboxValue | None:
    stmt = select(ManagedSandbox).where(ManagedSandbox.id == sandbox_id)
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return managed_sandbox_value(row) if row is not None else None


async def ensure_personal_managed_sandbox(
    db: AsyncSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID,
    billing_subject_id: UUID,
    e2b_template_ref: str,
) -> ManagedSandboxValue:
    existing = await load_personal_managed_sandbox(db, user_id, lock_row=True)
    if existing is not None:
        return existing
    now = utcnow()
    row = ManagedSandbox(
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=created_by_user_id,
        billing_subject_id=billing_subject_id,
        status="creating",
        last_error=None,
        e2b_sandbox_id=None,
        e2b_template_ref=e2b_template_ref,
        anyharness_base_url=None,
        anyharness_bearer_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        runtime_generation=0,
        created_at=now,
        updated_at=now,
        ready_at=None,
        last_health_at=None,
        destroyed_at=None,
    )
    db.add(row)
    await db.flush()
    return managed_sandbox_value(row)


async def ensure_organization_managed_sandbox(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID | None,
    billing_subject_id: UUID,
    e2b_template_ref: str,
) -> ManagedSandboxValue:
    existing = await load_organization_managed_sandbox(db, organization_id, lock_row=True)
    if existing is not None:
        return existing
    now = utcnow()
    row = ManagedSandbox(
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        billing_subject_id=billing_subject_id,
        status="creating",
        last_error=None,
        e2b_sandbox_id=None,
        e2b_template_ref=e2b_template_ref,
        anyharness_base_url=None,
        anyharness_bearer_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        runtime_generation=0,
        created_at=now,
        updated_at=now,
        ready_at=None,
        last_health_at=None,
        destroyed_at=None,
    )
    db.add(row)
    await db.flush()
    return managed_sandbox_value(row)


async def update_managed_sandbox_status(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    status: str,
    last_error: str | None | object = _UNSET,
) -> ManagedSandboxValue | None:
    row = await db.get(ManagedSandbox, sandbox_id)
    if row is None:
        return None
    row.status = status
    if last_error is not _UNSET:
        row.last_error = last_error  # type: ignore[assignment]
    row.updated_at = utcnow()
    await db.flush()
    return managed_sandbox_value(row)


async def mark_managed_sandbox_ready(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    e2b_sandbox_id: str,
    e2b_template_ref: str,
    anyharness_base_url: str,
    anyharness_bearer_token_ciphertext: str,
    anyharness_data_key_ciphertext: str,
) -> ManagedSandboxValue | None:
    row = await db.get(ManagedSandbox, sandbox_id)
    if row is None:
        return None
    now = utcnow()
    was_same_runtime = (
        row.e2b_sandbox_id == e2b_sandbox_id
        and row.anyharness_base_url == anyharness_base_url
        and row.anyharness_bearer_token_ciphertext == anyharness_bearer_token_ciphertext
        and row.anyharness_data_key_ciphertext == anyharness_data_key_ciphertext
    )
    row.status = "ready"
    row.last_error = None
    row.e2b_sandbox_id = e2b_sandbox_id
    row.e2b_template_ref = e2b_template_ref
    row.anyharness_base_url = anyharness_base_url
    row.anyharness_bearer_token_ciphertext = anyharness_bearer_token_ciphertext
    row.anyharness_data_key_ciphertext = anyharness_data_key_ciphertext
    if not was_same_runtime:
        row.runtime_generation += 1
    row.ready_at = now
    row.last_health_at = now
    row.updated_at = now
    await db.flush()
    return managed_sandbox_value(row)


async def mark_managed_sandbox_health(
    db: AsyncSession,
    sandbox_id: UUID,
) -> ManagedSandboxValue | None:
    row = await db.get(ManagedSandbox, sandbox_id)
    if row is None:
        return None
    row.last_health_at = utcnow()
    row.updated_at = row.last_health_at
    await db.flush()
    return managed_sandbox_value(row)


async def mark_managed_sandbox_destroyed(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    last_error: str | None = None,
) -> ManagedSandboxValue | None:
    row = await db.get(ManagedSandbox, sandbox_id)
    if row is None:
        return None
    now = utcnow()
    row.status = "destroyed"
    row.last_error = last_error
    row.destroyed_at = now
    row.updated_at = now
    await db.flush()
    return managed_sandbox_value(row)
