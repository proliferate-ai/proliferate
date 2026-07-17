"""Persistence helpers for the personal cloud sandbox.

The cloud sandbox product API is backed by ``cloud_sandbox``. Keep the
function names here stable while the server callers are migrated off the old
``cloud_sandbox`` table.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final, cast
from uuid import UUID

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudSandboxStatus
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.utils.time import utcnow

_UNSET: Final = object()
_LAST_ERROR_MAX_LENGTH = 2000


def _bounded_last_error(value: str | None) -> str | None:
    return value[:_LAST_ERROR_MAX_LENGTH] if value is not None else None


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
    desired_anyharness_version: str | None
    desired_worker_version: str | None


def cloud_sandbox_value(row: CloudSandbox) -> CloudSandboxValue:
    status = row.status.value if hasattr(row.status, "value") else row.status
    sandbox_type = (
        row.sandbox_type.value if hasattr(row.sandbox_type, "value") else row.sandbox_type
    )
    return CloudSandboxValue(
        id=row.id,
        owner_scope="personal" if row.owner_user_id is not None else "unknown",
        owner_user_id=row.owner_user_id,
        organization_id=None,
        created_by_user_id=row.owner_user_id,
        billing_subject_id=None,
        status=status,
        last_error=row.last_error,
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
        desired_anyharness_version=row.desired_anyharness_version,
        desired_worker_version=row.desired_worker_version,
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
    refresh: bool = False,
) -> CloudSandboxValue | None:
    stmt = select(CloudSandbox).where(CloudSandbox.id == sandbox_id)
    if lock_row:
        stmt = stmt.with_for_update()
    if refresh:
        stmt = stmt.execution_options(populate_existing=True)
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
        last_error=None,
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
    row.status = CloudSandboxStatus(status)
    if last_error is not _UNSET:
        row.last_error = _bounded_last_error(cast("str | None", last_error))
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
    now = utcnow()
    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                or_(
                    CloudSandbox.provider_sandbox_id.is_(None),
                    CloudSandbox.provider_sandbox_id == e2b_sandbox_id,
                ),
            )
            .values(
                provider_sandbox_id=e2b_sandbox_id,
                status="creating",
                last_error=None,
                updated_at=now,
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return cloud_sandbox_value(row)


async def begin_cloud_sandbox_materialization_retry(
    db: AsyncSession,
    sandbox_id: UUID,
) -> CloudSandboxValue | None:
    """Start an explicit attempt without disturbing an already-ready read model."""

    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                or_(
                    CloudSandbox.status.in_((CloudSandboxStatus.error, CloudSandboxStatus.paused)),
                    CloudSandbox.last_error.is_not(None),
                ),
            )
            .values(
                status=CloudSandboxStatus.creating,
                last_error=None,
                updated_at=utcnow(),
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is not None:
        return cloud_sandbox_value(row)
    current = await load_cloud_sandbox_by_id(db, sandbox_id, refresh=True)
    if current is None or current.destroyed_at is not None or current.status == "destroyed":
        return None
    return current


async def lock_cloud_sandbox_materialization_attempt(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
) -> CloudSandboxValue | None:
    """Lock the exact active provider attempt before usage attribution."""

    row = (
        await db.execute(
            select(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id == expected_provider_sandbox_id,
                CloudSandbox.status.in_((CloudSandboxStatus.creating, CloudSandboxStatus.ready)),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def supersede_missing_cloud_sandbox_provider(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
) -> CloudSandboxValue | None:
    """Detach exactly one authoritatively absent provider binding.

    The compare-and-set prevents a stale recovery attempt from clearing a
    replacement that another locked attempt has already recorded.
    """

    now = utcnow()
    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id == expected_provider_sandbox_id,
                CloudSandbox.status.in_((CloudSandboxStatus.creating, CloudSandboxStatus.ready)),
            )
            .values(
                provider_sandbox_id=None,
                status="creating",
                last_error=None,
                anyharness_base_url=None,
                runtime_token_ciphertext=None,
                anyharness_data_key_ciphertext=None,
                ready_at=None,
                last_health_at=None,
                updated_at=now,
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def mark_cloud_sandbox_provider_missing(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
    last_error: str,
) -> CloudSandboxValue | None:
    """Fence a provider-death observation while preserving the logical row."""

    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id == expected_provider_sandbox_id,
            )
            .values(
                provider_sandbox_id=None,
                status="error",
                last_error=_bounded_last_error(last_error),
                anyharness_base_url=None,
                runtime_token_ciphertext=None,
                anyharness_data_key_ciphertext=None,
                ready_at=None,
                last_health_at=None,
                updated_at=utcnow(),
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def mark_cloud_sandbox_materialization_error(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str | None,
    last_error: str,
) -> CloudSandboxValue | None:
    """Persist a terminal attempt failure without clobbering another binding."""

    provider_matches = (
        CloudSandbox.provider_sandbox_id.is_(None)
        if expected_provider_sandbox_id is None
        else CloudSandbox.provider_sandbox_id == expected_provider_sandbox_id
    )
    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                provider_matches,
                CloudSandbox.status.in_((CloudSandboxStatus.creating, CloudSandboxStatus.ready)),
            )
            .values(
                status="error",
                last_error=_bounded_last_error(last_error),
                updated_at=utcnow(),
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


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
    now = utcnow()
    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id == e2b_sandbox_id,
                CloudSandbox.status.in_((CloudSandboxStatus.creating, CloudSandboxStatus.ready)),
            )
            .values(
                status="ready",
                last_error=None,
                anyharness_base_url=anyharness_base_url,
                runtime_token_ciphertext=anyharness_bearer_token_ciphertext,
                anyharness_data_key_ciphertext=anyharness_data_key_ciphertext,
                ready_at=now,
                last_health_at=now,
                updated_at=now,
            )
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


async def mark_cloud_sandbox_provider_state(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    status: str,
    expected_provider_sandbox_id: str,
    expected_status: str,
) -> CloudSandboxValue | None:
    now = utcnow()
    normalized_status = "ready" if status == "running" else status
    values: dict[str, object] = {
        "status": normalized_status,
        "updated_at": now,
    }
    if normalized_status == "ready":
        values.update(
            last_error=None,
            ready_at=func.coalesce(CloudSandbox.ready_at, now),
            last_health_at=now,
        )
    elif normalized_status == "destroyed":
        values["destroyed_at"] = now
    row = (
        await db.execute(
            update(CloudSandbox)
            .where(
                CloudSandbox.id == sandbox_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudSandbox.provider_sandbox_id == expected_provider_sandbox_id,
                CloudSandbox.status == CloudSandboxStatus(expected_status),
            )
            .values(**values)
            .returning(CloudSandbox)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return cloud_sandbox_value(row) if row is not None else None


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
    row.status = CloudSandboxStatus.destroyed
    row.last_error = _bounded_last_error(last_error)
    row.destroyed_at = now
    row.updated_at = now
    await db.flush()
    return cloud_sandbox_value(row)


async def set_cloud_sandbox_desired_versions(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    desired_anyharness_version: str | None,
    desired_worker_version: str | None,
) -> CloudSandboxValue | None:
    """Overlay target-scoped desired versions on one sandbox (decision 1).

    ``None`` clears the override so the target inherits the global pin again;
    a value overrides it for this sandbox only. Touching sandbox A never
    reads or writes any other sandbox's row.
    """
    row = await db.get(CloudSandbox, sandbox_id)
    if row is None:
        return None
    row.desired_anyharness_version = desired_anyharness_version
    row.desired_worker_version = desired_worker_version
    row.updated_at = utcnow()
    await db.flush()
    return cloud_sandbox_value(row)
