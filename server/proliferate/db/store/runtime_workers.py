"""Persistence for runtime workers, their enrollments, and gateway tokens.

Token values are never stored; only their HMAC-SHA256 hashes are. The three
token families (enrollment, worker, integration gateway) each use a distinct
HMAC domain so a raw value can never authenticate against the wrong table.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_INTEGRATION_GATEWAY_TOKEN_DOMAIN,
    CLOUD_RUNTIME_WORKER_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS,
    CLOUD_RUNTIME_WORKER_TOKEN_DOMAIN,
)
from proliferate.db.models.cloud.runtime_workers import (
    CloudIntegrationGatewayToken,
    CloudRuntimeWorker,
    CloudRuntimeWorkerEnrollment,
)
from proliferate.utils.time import utcnow


def hash_runtime_token(*, domain: str, token: str) -> str:
    """HMAC-SHA256 a raw token under a domain, keyed by the cloud secret."""
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def hash_enrollment_token(token: str) -> str:
    return hash_runtime_token(
        domain=CLOUD_RUNTIME_WORKER_ENROLLMENT_TOKEN_DOMAIN,
        token=token,
    )


def hash_worker_token(token: str) -> str:
    return hash_runtime_token(domain=CLOUD_RUNTIME_WORKER_TOKEN_DOMAIN, token=token)


def hash_gateway_token(token: str) -> str:
    return hash_runtime_token(
        domain=CLOUD_INTEGRATION_GATEWAY_TOKEN_DOMAIN,
        token=token,
    )


@dataclass(frozen=True)
class RuntimeWorkerEnrollmentValue:
    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    runtime_kind: str
    cloud_sandbox_id: UUID | None
    desktop_install_id: str | None
    status: str
    expires_at: datetime


@dataclass(frozen=True)
class RuntimeWorkerValue:
    id: UUID
    owner_user_id: UUID
    organization_id: UUID | None
    runtime_kind: str
    cloud_sandbox_id: UUID | None
    desktop_install_id: str | None
    status: str
    worker_version: str | None
    anyharness_version: str | None
    hostname: str | None
    machine_fingerprint: str | None
    enrolled_at: datetime
    last_seen_at: datetime | None

    @property
    def online(self) -> bool:
        """Derive liveness at read time; nothing writes ``offline`` eagerly."""
        if self.status != "online" or self.last_seen_at is None:
            return False
        age = (utcnow() - self.last_seen_at).total_seconds()
        return age <= CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS


@dataclass(frozen=True)
class IntegrationGatewayGrant:
    runtime_worker_id: UUID
    runtime_kind: str
    owner_user_id: UUID
    organization_id: UUID | None


def _enrollment_value(row: CloudRuntimeWorkerEnrollment) -> RuntimeWorkerEnrollmentValue:
    return RuntimeWorkerEnrollmentValue(
        id=row.id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        runtime_kind=row.runtime_kind,
        cloud_sandbox_id=row.cloud_sandbox_id,
        desktop_install_id=row.desktop_install_id,
        status=row.status,
        expires_at=row.expires_at,
    )


def _worker_value(row: CloudRuntimeWorker) -> RuntimeWorkerValue:
    return RuntimeWorkerValue(
        id=row.id,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        runtime_kind=row.runtime_kind,
        cloud_sandbox_id=row.cloud_sandbox_id,
        desktop_install_id=row.desktop_install_id,
        status=row.status,
        worker_version=row.worker_version,
        anyharness_version=row.anyharness_version,
        hostname=row.hostname,
        machine_fingerprint=row.machine_fingerprint,
        enrolled_at=row.enrolled_at,
        last_seen_at=row.last_seen_at,
    )


async def create_enrollment(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    organization_id: UUID | None,
    runtime_kind: str,
    cloud_sandbox_id: UUID | None,
    desktop_install_id: str | None,
    created_by_user_id: UUID,
    token_hash: str,
    expires_at: datetime,
) -> RuntimeWorkerEnrollmentValue:
    row = CloudRuntimeWorkerEnrollment(
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        runtime_kind=runtime_kind,
        cloud_sandbox_id=cloud_sandbox_id,
        desktop_install_id=desktop_install_id,
        created_by_user_id=created_by_user_id,
        token_hash=token_hash,
        status="pending",
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return _enrollment_value(row)


async def revoke_pending_desktop_enrollments_for_install(
    db: AsyncSession,
    *,
    desktop_install_id: str,
) -> None:
    """Fence older one-time tickets so the newest Desktop enrollment wins.

    The transaction lock is shared with ticket consumption. Without it, a
    Worker stranded before enrollment could consume an older ticket after its
    replacement enrolled, revoke the replacement, and rewrite the shared
    integration-gateway credential.
    """
    await acquire_desktop_enrollment_rotation_lock(db, desktop_install_id)
    rows = (
        (
            await db.execute(
                select(CloudRuntimeWorkerEnrollment)
                .where(
                    CloudRuntimeWorkerEnrollment.runtime_kind == "desktop",
                    CloudRuntimeWorkerEnrollment.desktop_install_id == desktop_install_id,
                    CloudRuntimeWorkerEnrollment.status == "pending",
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for row in rows:
        row.status = "revoked"
        row.updated_at = now
    if rows:
        await db.flush()


async def acquire_desktop_enrollment_rotation_lock(
    db: AsyncSession,
    desktop_install_id: str,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"desktop-worker-enrollment:{desktop_install_id}"},
    )


async def consume_pending_enrollment_by_hash(
    db: AsyncSession,
    *,
    token_hash: str,
) -> RuntimeWorkerEnrollmentValue | None:
    """Atomically consume a pending, unexpired enrollment.

    Returns ``None`` when the token is unknown, already used, revoked, or
    expired (expired rows are flipped to ``expired`` as a side effect).
    """
    # Discover the identity without a row lock, then take the same advisory
    # lock used by ticket creation before locking/revalidating the row. This
    # ordering avoids a row/advisory-lock inversion while making creation and
    # consumption serial for one physical Desktop install.
    identity = (
        await db.execute(
            select(
                CloudRuntimeWorkerEnrollment.runtime_kind,
                CloudRuntimeWorkerEnrollment.desktop_install_id,
            ).where(CloudRuntimeWorkerEnrollment.token_hash == token_hash)
        )
    ).one_or_none()
    if identity is not None and identity.runtime_kind == "desktop":
        if identity.desktop_install_id is None:
            return None
        await acquire_desktop_enrollment_rotation_lock(db, identity.desktop_install_id)

    row = (
        await db.execute(
            select(CloudRuntimeWorkerEnrollment)
            .where(CloudRuntimeWorkerEnrollment.token_hash == token_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.status != "pending":
        return None
    now = utcnow()
    if (
        row.runtime_kind == "desktop"
        and row.desktop_install_id is not None
        and await _newer_desktop_enrollment_exists(db, row)
    ):
        row.status = "revoked"
        row.updated_at = now
        await db.flush()
        return None
    if row.expires_at <= now:
        row.status = "expired"
        row.updated_at = now
        await db.flush()
        return None
    row.status = "consumed"
    row.consumed_at = now
    row.updated_at = now
    await db.flush()
    return _enrollment_value(row)


async def _newer_desktop_enrollment_exists(
    db: AsyncSession,
    row: CloudRuntimeWorkerEnrollment,
) -> bool:
    """Treat every older pre-fix ticket as stale once a successor exists.

    ``created_at`` is generated when each row is flushed. The equality branch
    is deliberately fail-closed for the vanishingly rare timestamp tie: both
    siblings are rejected and Desktop obtains one fresh serialized ticket.
    """
    newer_id = await db.scalar(
        select(CloudRuntimeWorkerEnrollment.id)
        .where(
            CloudRuntimeWorkerEnrollment.runtime_kind == "desktop",
            CloudRuntimeWorkerEnrollment.desktop_install_id == row.desktop_install_id,
            CloudRuntimeWorkerEnrollment.id != row.id,
            CloudRuntimeWorkerEnrollment.created_at >= row.created_at,
        )
        .limit(1)
    )
    return newer_id is not None


async def revoke_active_workers_for_identity(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID | None,
    owner_user_id: UUID | None = None,
    desktop_install_id: str | None = None,
) -> None:
    """Revoke any non-revoked worker (and its gateway token) for an identity.

    Enrollment is single-active-worker per identity; a fresh enrollment retires
    the prior worker so the partial-unique indexes never collide.
    """
    stmt = select(CloudRuntimeWorker).where(CloudRuntimeWorker.status != "revoked")
    if cloud_sandbox_id is not None:
        stmt = stmt.where(CloudRuntimeWorker.cloud_sandbox_id == cloud_sandbox_id)
    else:
        stmt = stmt.where(
            CloudRuntimeWorker.owner_user_id == owner_user_id,
            CloudRuntimeWorker.desktop_install_id == desktop_install_id,
        )
    await _revoke_workers_and_gateway_tokens(db, stmt)


async def revoke_active_workers_for_desktop_install(
    db: AsyncSession,
    *,
    desktop_install_id: str,
) -> None:
    """Revoke every non-revoked worker (and gateway token) on a desktop install.

    Deliberately ignores the owner: a desktop install runs exactly one physical
    worker process, so a fresh enrollment — possibly by a different user on the
    same machine — must retire all predecessors, or the previous user's worker
    row stays "online" and its gateway token stays a live credential.
    """
    stmt = select(CloudRuntimeWorker).where(
        CloudRuntimeWorker.status != "revoked",
        CloudRuntimeWorker.desktop_install_id == desktop_install_id,
    )
    await _revoke_workers_and_gateway_tokens(db, stmt)


async def _revoke_workers_and_gateway_tokens(
    db: AsyncSession,
    stmt: Select[tuple[CloudRuntimeWorker]],
) -> None:
    workers = (await db.execute(stmt.with_for_update())).scalars().all()
    now = utcnow()
    for worker in workers:
        worker.status = "revoked"
        worker.revoked_at = now
        worker.updated_at = now
        await _revoke_gateway_tokens_for_worker(db, worker_id=worker.id, now=now)
    if workers:
        await db.flush()


async def _revoke_gateway_tokens_for_worker(
    db: AsyncSession,
    *,
    worker_id: UUID,
    now: datetime,
) -> None:
    tokens = (
        (
            await db.execute(
                select(CloudIntegrationGatewayToken).where(
                    CloudIntegrationGatewayToken.runtime_worker_id == worker_id,
                    CloudIntegrationGatewayToken.status == "active",
                )
            )
        )
        .scalars()
        .all()
    )
    for token in tokens:
        token.status = "revoked"
        token.revoked_at = now
        token.updated_at = now


async def create_worker(
    db: AsyncSession,
    *,
    enrollment: RuntimeWorkerEnrollmentValue,
    token_hash: str,
    worker_version: str | None = None,
    anyharness_version: str | None = None,
    hostname: str | None = None,
    machine_fingerprint: str | None = None,
) -> RuntimeWorkerValue:
    now = utcnow()
    row = CloudRuntimeWorker(
        owner_user_id=enrollment.owner_user_id,
        organization_id=enrollment.organization_id,
        runtime_kind=enrollment.runtime_kind,
        cloud_sandbox_id=enrollment.cloud_sandbox_id,
        desktop_install_id=enrollment.desktop_install_id,
        token_hash=token_hash,
        status="online",
        worker_version=worker_version,
        anyharness_version=anyharness_version,
        hostname=hostname,
        machine_fingerprint=machine_fingerprint,
        enrolled_at=now,
        last_seen_at=now,
    )
    db.add(row)
    await db.flush()
    return _worker_value(row)


async def create_gateway_token(
    db: AsyncSession,
    *,
    worker: RuntimeWorkerValue,
    token_hash: str,
) -> None:
    db.add(
        CloudIntegrationGatewayToken(
            runtime_worker_id=worker.id,
            owner_user_id=worker.owner_user_id,
            organization_id=worker.organization_id,
            token_hash=token_hash,
            status="active",
        )
    )
    await db.flush()


async def get_worker_by_token_hash(
    db: AsyncSession,
    *,
    token_hash: str,
) -> RuntimeWorkerValue | None:
    row = (
        await db.execute(
            select(CloudRuntimeWorker).where(
                CloudRuntimeWorker.token_hash == token_hash,
                CloudRuntimeWorker.status != "revoked",
            )
        )
    ).scalar_one_or_none()
    return _worker_value(row) if row is not None else None


async def get_worker(
    db: AsyncSession,
    *,
    worker_id: UUID,
) -> RuntimeWorkerValue | None:
    """Load a worker by id, including revoked rows (callers check status)."""
    row = await db.get(CloudRuntimeWorker, worker_id)
    return _worker_value(row) if row is not None else None


async def get_active_desktop_worker_for_user(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    desktop_install_id: str,
) -> RuntimeWorkerValue | None:
    """Load the caller's non-revoked desktop worker for an install, if any.

    Used to confirm that a ``desktopInstallId`` supplied on a materialization
    request is owned by the caller before selecting/redacting local rows.
    """
    row = (
        await db.execute(
            select(CloudRuntimeWorker).where(
                CloudRuntimeWorker.owner_user_id == owner_user_id,
                CloudRuntimeWorker.desktop_install_id == desktop_install_id,
                CloudRuntimeWorker.runtime_kind == "desktop",
                CloudRuntimeWorker.status != "revoked",
            )
        )
    ).scalar_one_or_none()
    return _worker_value(row) if row is not None else None


async def touch_worker_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
    worker_version: str | None = None,
    anyharness_version: str | None = None,
) -> None:
    """Stamp liveness and, when self-reported, the running component versions.

    Versions only move forward on report (post-swap); an omitted field never
    clears what enrollment or a prior heartbeat recorded.
    """
    row = await db.get(CloudRuntimeWorker, worker_id)
    if row is None or row.status == "revoked":
        return
    now = utcnow()
    row.status = "online"
    row.last_seen_at = now
    if worker_version is not None and worker_version != row.worker_version:
        row.worker_version = worker_version
    if anyharness_version is not None and anyharness_version != row.anyharness_version:
        row.anyharness_version = anyharness_version
    row.updated_at = now
    await db.flush()


async def get_grant_by_gateway_token_hash(
    db: AsyncSession,
    *,
    token_hash: str,
) -> IntegrationGatewayGrant | None:
    """Resolve an active gateway token to its owning (non-revoked) worker."""
    token = (
        await db.execute(
            select(CloudIntegrationGatewayToken).where(
                CloudIntegrationGatewayToken.token_hash == token_hash,
                CloudIntegrationGatewayToken.status == "active",
            )
        )
    ).scalar_one_or_none()
    if token is None:
        return None
    worker = await db.get(CloudRuntimeWorker, token.runtime_worker_id)
    if worker is None or worker.status == "revoked":
        return None
    # Deliberately no last_used_at stamp: this is the gateway hot path and a
    # per-request row write + flush is not worth the bookkeeping.
    return IntegrationGatewayGrant(
        runtime_worker_id=worker.id,
        runtime_kind=worker.runtime_kind,
        owner_user_id=worker.owner_user_id,
        organization_id=worker.organization_id,
    )
