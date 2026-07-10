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

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_INTEGRATION_GATEWAY_TOKEN_DOMAIN,
    CLOUD_RUNTIME_WORKER_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_RUNTIME_WORKER_OFFLINE_THRESHOLD_SECONDS,
    CLOUD_RUNTIME_WORKER_TOKEN_DOMAIN,
    CLOUD_WORKFLOW_RUN_GATEWAY_TOKEN_DOMAIN,
)
from proliferate.db.models.cloud.runtime_workers import (
    CloudIntegrationGatewayToken,
    CloudRuntimeWorker,
    CloudRuntimeWorkerEnrollment,
)
from proliferate.db.models.cloud.sandboxes import CloudSandbox
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


def hash_workflow_run_gateway_token(token: str) -> str:
    """Hash a per-run workflow gateway token — worker-token hashing exactly, under
    its own HMAC domain so a run token can never resolve a per-worker row."""
    return hash_runtime_token(
        domain=CLOUD_WORKFLOW_RUN_GATEWAY_TOKEN_DOMAIN,
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
    owner_user_id: UUID
    organization_id: UUID | None
    # Per-worker grant fields (None on a per-run grant).
    runtime_worker_id: UUID | None = None
    runtime_kind: str | None = None
    # L25 layer 1: the resolved worker-level provider allowlist for this request.
    # None = unscoped (today's behavior / no worker known). Re-resolved per request.
    worker_scope: list[str] | None = None
    # Per-run grant fields (PR E / OPEN-3a). Present only when the bearer resolved a
    # ``cloud_workflow_run_gateway_token`` row; the credential itself proves the run.
    run_id: UUID | None = None
    workflow_id: UUID | None = None
    # L25 layer 2: the run's frozen function grant (``[{provider, tools}]``). None on
    # a per-worker grant (no per-run function restriction).
    run_scope: list[dict[str, object]] | None = None
    # §2 "default access modes" layer 2 for CHAT/interactive (per-worker) grants: the
    # CONFIGURABLE default run-scope computed from the org's
    # ``CloudIntegrationPolicy.scope_json``. None = unscoped (default-all — today's
    # unconditional behavior). Never set on a per-run (workflow) grant: those carry
    # their own frozen ``run_scope`` (E3 explicit opt-in), so the chat default policy
    # never narrows a workflow.
    default_scope: list[dict[str, object]] | None = None

    @property
    def effective_run_scope(self) -> list[dict[str, object]] | None:
        """The layer-2 scope the gateway enforces: a workflow run token's frozen
        ``run_scope`` when present, otherwise the chat/interactive default-access
        scope. Mutually exclusive by construction (a per-run grant leaves
        ``default_scope`` None; a per-worker grant leaves ``run_scope`` None)."""
        return self.run_scope if self.run_scope is not None else self.default_scope


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
        # Layer-1 allowlist for this worker (NULL = unscoped, today's behavior).
        worker_scope=list(token.scope_json) if token.scope_json is not None else None,
    )


async def get_active_worker_gateway_scope_for_owner(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
) -> list[str] | None:
    """The layer-1 provider allowlist of the owner's active cloud-sandbox worker.

    Used both at workflow delivery (L25 intersection) and per gateway request for a
    run token (L25 asymmetric re-check): the delivering worker is the owner's
    active worker on their personal cloud sandbox. Returns the worker token's
    ``scope_json`` (a provider-namespace list) or ``None`` when the worker is
    unscoped OR no worker exists yet — both mean "unscoped passthrough", never an
    empty allowlist.
    """

    scope = (
        await db.execute(
            select(CloudIntegrationGatewayToken.scope_json)
            .join(
                CloudRuntimeWorker,
                CloudRuntimeWorker.id == CloudIntegrationGatewayToken.runtime_worker_id,
            )
            .join(CloudSandbox, CloudSandbox.id == CloudRuntimeWorker.cloud_sandbox_id)
            .where(
                CloudSandbox.owner_user_id == owner_user_id,
                CloudSandbox.destroyed_at.is_(None),
                CloudRuntimeWorker.status != "revoked",
                CloudIntegrationGatewayToken.status == "active",
            )
            .order_by(CloudIntegrationGatewayToken.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return list(scope) if scope is not None else None
