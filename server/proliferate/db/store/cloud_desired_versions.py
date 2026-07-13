"""Persistence for target-scoped desired runtime-component versions.

See :mod:`proliferate.db.models.cloud.desired_versions`. A record is keyed by
``cloud_sandbox_id`` and overrides the global image-env pin per component; an
unset column defers to the global pin.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.desired_versions import CloudSandboxDesiredVersion
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class DesiredVersionOverride:
    """A target's per-component desired-version override (``None`` = defer)."""

    cloud_sandbox_id: UUID
    anyharness: str | None
    worker: str | None


def _value(row: CloudSandboxDesiredVersion) -> DesiredVersionOverride:
    return DesiredVersionOverride(
        cloud_sandbox_id=row.cloud_sandbox_id,
        anyharness=row.desired_anyharness_version,
        worker=row.desired_worker_version,
    )


async def get_for_sandbox(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
) -> DesiredVersionOverride | None:
    """Return the target-scoped override for a sandbox, or ``None`` if unset."""
    row = (
        await db.execute(
            select(CloudSandboxDesiredVersion).where(
                CloudSandboxDesiredVersion.cloud_sandbox_id == cloud_sandbox_id
            )
        )
    ).scalar_one_or_none()
    return _value(row) if row is not None else None


async def set_for_sandbox(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    anyharness: str | None = None,
    worker: str | None = None,
) -> DesiredVersionOverride:
    """Upsert a target's desired-version override.

    Only the components passed are written; an omitted (``None``) argument
    leaves that column untouched on an existing record, and unset on a new one.
    Pass an explicit empty string to record "no override" for a component
    without touching the other. Idempotent: setting the same values twice is a
    no-op beyond bumping ``updated_at``.
    """
    row = (
        await db.execute(
            select(CloudSandboxDesiredVersion).where(
                CloudSandboxDesiredVersion.cloud_sandbox_id == cloud_sandbox_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudSandboxDesiredVersion(
            cloud_sandbox_id=cloud_sandbox_id,
            desired_anyharness_version=anyharness,
            desired_worker_version=worker,
        )
        db.add(row)
    else:
        if anyharness is not None:
            row.desired_anyharness_version = anyharness or None
        if worker is not None:
            row.desired_worker_version = worker or None
        row.updated_at = utcnow()
    await db.flush()
    return _value(row)


async def clear_for_sandbox(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
) -> None:
    """Remove a target's desired-version override so it defers to the global pin."""
    row = (
        await db.execute(
            select(CloudSandboxDesiredVersion).where(
                CloudSandboxDesiredVersion.cloud_sandbox_id == cloud_sandbox_id
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.flush()
