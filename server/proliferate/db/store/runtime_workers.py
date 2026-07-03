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

from sqlalchemy import select
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


async def consume_pending_enrollment_by_hash(
    db: AsyncSession,
    *,
    token_hash: str,
) -> RuntimeWorkerEnrollmentValue | None:
    """Atomically consume a pending, unexpired enrollment.

    Returns ``None`` when the token is unknown, already used, revoked, or
    expired (expired rows are flipped to ``expired`` as a side effect).
    """
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


async def touch_worker_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
) -> None:
    row = await db.get(CloudRuntimeWorker, worker_id)
    if row is None or row.status == "revoked":
        return
    now = utcnow()
    row.status = "online"
    row.last_seen_at = now
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
