"""Worker-facing GitHub credential lease service."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetKind
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.repo_authority import (
    ensure_fresh_github_app_authorization,
)
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.models import (
    WorkerGitHubCredentialLeaseRequest,
    WorkerGitHubCredentialLeaseResponse,
)
from proliferate.server.cloud.worker.target_validation import require_active_worker_target
from proliferate.utils.time import utcnow

_LEASE_REFRESH_SKEW = timedelta(minutes=10)


async def refresh_worker_github_credentials(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerGitHubCredentialLeaseRequest,
) -> WorkerGitHubCredentialLeaseResponse:
    del body
    target = await require_active_worker_target(db, auth=auth)
    if target.kind != CloudTargetKind.managed_cloud.value or target.owner_user_id is None:
        raise CloudApiError(
            "cloud_worker_github_credentials_unsupported_target",
            "GitHub credential leases are only available for personal managed cloud targets.",
            status_code=409,
        )

    authorization = await ensure_fresh_github_app_authorization(
        db,
        user_id=target.owner_user_id,
    )
    if authorization.access_token is None or authorization.token_expires_at is None:
        raise CloudApiError(
            "github_app_reauthorization_required",
            "Reconnect the GitHub App before refreshing sandbox Git credentials.",
            status_code=409,
        )

    issued_at = utcnow()
    expires_at = authorization.token_expires_at
    refresh_after = _refresh_after(issued_at=issued_at, expires_at=expires_at)
    return WorkerGitHubCredentialLeaseResponse(
        access_token=authorization.access_token,
        actor_login=authorization.github_login,
        actor_id=authorization.github_user_id,
        issued_at=issued_at.isoformat(),
        expires_at=expires_at.isoformat(),
        refresh_after=refresh_after.isoformat(),
        lease_id=secrets.token_urlsafe(18),
    )


def _refresh_after(*, issued_at: datetime, expires_at: datetime) -> datetime:
    latest = expires_at - _LEASE_REFRESH_SKEW
    if latest <= issued_at:
        return issued_at
    lifetime = expires_at - issued_at
    preferred = issued_at + (lifetime * 0.75)
    return min(preferred, latest)
