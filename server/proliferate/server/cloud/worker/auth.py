"""Worker authentication."""

from __future__ import annotations

import hashlib
import hmac

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudTargetStatus,
    CloudWorkerStatus,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext


def hash_token(*, domain: str, token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def authenticate_worker(
    db: AsyncSession,
    *,
    authorization: str | None,
) -> WorkerAuthContext:
    if authorization is None or not authorization.startswith("Bearer "):
        raise CloudApiError(
            "cloud_worker_auth_required",
            "Worker authentication is required.",
            status_code=401,
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise CloudApiError(
            "cloud_worker_auth_required",
            "Worker authentication is required.",
            status_code=401,
        )
    worker = await worker_auth_store.get_worker_by_token_hash(
        db,
        token_hash=hash_token(domain=CLOUD_WORKER_TOKEN_DOMAIN, token=token),
    )
    if worker is None:
        raise CloudApiError(
            "cloud_worker_auth_invalid",
            "Worker token is invalid.",
            status_code=401,
        )
    if worker.status == CloudWorkerStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_archived",
            "Worker token is archived.",
            status_code=401,
        )
    target = await targets_store.get_target_by_id(db, worker.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    if target.status == CloudTargetStatus.archived.value:
        raise CloudApiError(
            "cloud_worker_target_archived",
            "Worker target is archived.",
            status_code=409,
        )
    return WorkerAuthContext(
        worker_id=worker.id,
        target_id=worker.target_id,
    )
