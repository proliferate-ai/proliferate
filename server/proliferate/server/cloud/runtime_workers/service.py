"""Runtime worker enrollment + heartbeat service.

Enrollment is single-use and single-active-worker per identity: consuming an
enrollment mints a fresh worker token and a scoped integration-gateway token,
retiring any prior worker for the same sandbox / desktop install.
"""

from __future__ import annotations

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_INTEGRATION_GATEWAY_MCP_PATH,
    CLOUD_RUNTIME_WORKER_CLOUD_ENROLLMENT_TTL_SECONDS,
    CLOUD_RUNTIME_WORKER_DESKTOP_ENROLLMENT_TTL_SECONDS,
    CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
)
from proliferate.db.store import runtime_workers as store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime_workers.models import (
    DesktopWorkerEnrollmentResponse,
    DesktopWorkerRevokeResponse,
    IntegrationGatewayConfig,
    WorkerEnrollRequest,
    WorkerEnrollResponse,
    WorkerHeartbeatResponse,
)
from proliferate.utils.time import utcnow

_TOKEN_BYTES = 48


def worker_cloud_base_url() -> str:
    """Base URL workers use to reach Cloud; empty when unconfigured."""
    return (settings.cloud_worker_base_url or settings.api_base_url or "").strip().rstrip("/")


def integration_gateway_config(token: str) -> IntegrationGatewayConfig:
    base = worker_cloud_base_url()
    if not base:
        raise CloudApiError(
            "cloud_worker_misconfigured",
            "No cloud base URL is configured for worker integration gateway access.",
            status_code=500,
        )
    return IntegrationGatewayConfig(
        url=f"{base}{CLOUD_INTEGRATION_GATEWAY_MCP_PATH}",
        authorization=f"Bearer {token}",
    )


async def create_cloud_sandbox_enrollment(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    owner_user_id: UUID,
    organization_id: UUID | None = None,
) -> str:
    """Mint a pending enrollment token for a cloud sandbox worker.

    Returns the raw enrollment token (only its hash is persisted).
    """
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    await store.create_enrollment(
        db,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        runtime_kind="cloud_sandbox",
        cloud_sandbox_id=cloud_sandbox_id,
        desktop_install_id=None,
        created_by_user_id=owner_user_id,
        token_hash=store.hash_enrollment_token(token),
        expires_at=utcnow() + timedelta(seconds=CLOUD_RUNTIME_WORKER_CLOUD_ENROLLMENT_TTL_SECONDS),
    )
    return token


async def create_desktop_enrollment(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    desktop_install_id: str,
) -> DesktopWorkerEnrollmentResponse:
    """Mint a short-lived enrollment token for the user's desktop install."""
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    expires_at = utcnow() + timedelta(seconds=CLOUD_RUNTIME_WORKER_DESKTOP_ENROLLMENT_TTL_SECONDS)
    await store.create_enrollment(
        db,
        owner_user_id=owner_user_id,
        organization_id=None,
        runtime_kind="desktop",
        cloud_sandbox_id=None,
        desktop_install_id=desktop_install_id,
        created_by_user_id=owner_user_id,
        token_hash=store.hash_enrollment_token(token),
        expires_at=expires_at,
    )
    return DesktopWorkerEnrollmentResponse(
        enrollment_token=token,
        expires_at=expires_at,
    )


async def revoke_desktop_worker(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    desktop_install_id: str,
) -> DesktopWorkerRevokeResponse:
    """Revoke the caller's active desktop worker and its gateway token.

    Idempotent: revoking when no active worker exists is a successful no-op.
    """
    await store.revoke_active_workers_for_identity(
        db,
        cloud_sandbox_id=None,
        owner_user_id=owner_user_id,
        desktop_install_id=desktop_install_id,
    )
    return DesktopWorkerRevokeResponse(revoked=True)


async def enroll_worker(
    db: AsyncSession,
    *,
    request: WorkerEnrollRequest,
) -> WorkerEnrollResponse:
    enrollment = await store.consume_pending_enrollment_by_hash(
        db,
        token_hash=store.hash_enrollment_token(request.enrollment_token),
    )
    if enrollment is None:
        raise CloudApiError(
            "cloud_worker_enrollment_invalid",
            "Enrollment token is invalid, already used, or expired.",
            status_code=401,
        )

    # Single active worker per identity: retire any prior worker + gateway token.
    await store.revoke_active_workers_for_identity(
        db,
        cloud_sandbox_id=enrollment.cloud_sandbox_id,
        owner_user_id=enrollment.owner_user_id,
        desktop_install_id=enrollment.desktop_install_id,
    )

    worker_token = secrets.token_urlsafe(_TOKEN_BYTES)
    worker = await store.create_worker(
        db,
        enrollment=enrollment,
        token_hash=store.hash_worker_token(worker_token),
    )

    gateway_token = secrets.token_urlsafe(_TOKEN_BYTES)
    await store.create_gateway_token(
        db,
        worker=worker,
        token_hash=store.hash_gateway_token(gateway_token),
    )

    return WorkerEnrollResponse(
        worker_id=str(worker.id),
        worker_token=worker_token,
        heartbeat_interval_seconds=CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
        integration_gateway=integration_gateway_config(gateway_token),
    )


async def record_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
) -> WorkerHeartbeatResponse:
    await store.touch_worker_heartbeat(db, worker_id=worker_id)
    return WorkerHeartbeatResponse(
        worker_id=str(worker_id),
        server_time=utcnow(),
        heartbeat_interval_seconds=CLOUD_RUNTIME_WORKER_HEARTBEAT_INTERVAL_SECONDS,
    )
