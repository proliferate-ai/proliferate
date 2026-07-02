"""Managed cloud runtime target registration helpers."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.cloud import CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN, CloudTargetStatus
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.utils.time import utcnow

MANAGED_RUNTIME_ENROLLMENT_TTL_SECONDS = 3600


@dataclass(frozen=True)
class RuntimeTargetEnrollment:
    target_id: UUID
    enrollment_token: str


def _hash_token(*, domain: str, token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{token}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def ensure_runtime_target_enrollment(
    *,
    user_id: UUID,
    sandbox_profile_id: UUID,
    target_id: UUID,
) -> RuntimeTargetEnrollment | None:
    """Ensure a managed-cloud target exists and return a fresh worker token.

    The enrollment token is single-use. A new token is intentionally minted on
    every sandbox launch so a fresh managed target can register its worker
    without the server talking directly to AnyHarness.
    """

    async with db_engine.async_session_factory() as db, db.begin():
        target = await targets_store.get_target_by_id(db, target_id)
        if target is None or target.sandbox_profile_id != sandbox_profile_id:
            return None

        token = secrets.token_urlsafe(48)
        await worker_auth_store.create_enrollment(
            db,
            target_id=target_id,
            sandbox_profile_id=sandbox_profile_id,
            token_hash=_hash_token(domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN, token=token),
            created_by_user_id=user_id,
            expires_at=utcnow() + timedelta(seconds=MANAGED_RUNTIME_ENROLLMENT_TTL_SECONDS),
        )
        return RuntimeTargetEnrollment(target_id=target_id, enrollment_token=token)


async def wait_for_worker_target_fresh_heartbeat(
    target_id: UUID,
    *,
    workspace_id: UUID,
    not_before: datetime,
    previous_worker_id: UUID | None = None,
    total_attempts: int = 90,
    delay_seconds: float = 0.5,
) -> targets_store.CloudTargetSnapshot:
    """Wait until a relaunched managed worker proves it can authenticate."""

    last_status = "missing"
    last_detail: str | None = None
    last_worker_id: UUID | None = None
    last_heartbeat_at: datetime | None = None
    last_anyharness_version: str | None = None
    last_worker_version: str | None = None
    last_supervisor_version: str | None = None
    for _attempt in range(max(1, total_attempts)):
        async with db_engine.async_session_factory() as db:
            target = await targets_store.get_target_by_id(db, target_id)
        if target is not None:
            last_status = target.status
            if target.status_record is not None:
                last_detail = target.status_record.status_detail
                last_worker_id = target.status_record.worker_id
                last_heartbeat_at = target.status_record.last_heartbeat_at
            else:
                last_detail = None
                last_worker_id = None
                last_heartbeat_at = None
            if target.current_versions is not None:
                last_anyharness_version = target.current_versions.anyharness_version
                last_worker_version = target.current_versions.worker_version
                last_supervisor_version = target.current_versions.supervisor_version
            else:
                last_anyharness_version = None
                last_worker_version = None
                last_supervisor_version = None
            if (
                target.status == CloudTargetStatus.online.value
                and last_worker_id is not None
                and last_heartbeat_at is not None
                and last_heartbeat_at >= not_before
                and (previous_worker_id is None or last_worker_id != previous_worker_id)
                and last_anyharness_version
                and last_worker_version
                and last_supervisor_version
            ):
                return target
        await asyncio.sleep(delay_seconds)

    raise RuntimeError(
        "Proliferate Worker did not report a fresh online AnyHarness runtime "
        f"for target {target_id} after relaunch; workspace_id={workspace_id}; "
        f"last_status={last_status}; "
        f"last_detail={last_detail or '<none>'}; "
        f"last_worker_id={last_worker_id or '<none>'}; "
        f"last_heartbeat_at={last_heartbeat_at.isoformat() if last_heartbeat_at else '<none>'}; "
        f"last_anyharness_version={last_anyharness_version or '<none>'}; "
        f"last_worker_version={last_worker_version or '<none>'}; "
        f"last_supervisor_version={last_supervisor_version or '<none>'}."
    )
