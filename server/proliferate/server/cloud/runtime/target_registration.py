"""Managed cloud runtime target registration helpers."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.cloud import CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_runtime_environments import (
    attach_target_to_runtime_environment,
    get_runtime_environment_by_id,
)
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
    runtime_environment_id: UUID,
    user_id: UUID,
    display_name: str,
    sandbox_profile_id: UUID,
    target_id: UUID,
    cloud_sandbox_id: UUID,
    slot_generation: int,
) -> RuntimeTargetEnrollment | None:
    """Ensure a managed-cloud target exists and return a fresh worker token.

    The enrollment token is single-use. A new token is intentionally minted on
    every sandbox launch so a replaced sandbox can register a new worker for the
    same durable target without the server talking directly to AnyHarness.
    """

    async with db_engine.async_session_factory() as db, db.begin():
        environment = await get_runtime_environment_by_id(db, runtime_environment_id)
        if environment is None:
            return None
        profile = await agent_auth_store.get_sandbox_profile(db, sandbox_profile_id)
        if profile is None:
            return None
        target = await targets_store.ensure_primary_profile_target(
            db,
            sandbox_profile_id=profile.id,
            created_by_user_id=user_id,
        )
        if target.id != target_id:
            return None
        if environment.target_id != target_id:
            await attach_target_to_runtime_environment(
                db,
                runtime_environment_id=runtime_environment_id,
                target_id=target_id,
            )

        token = secrets.token_urlsafe(48)
        await worker_auth_store.create_enrollment(
            db,
            target_id=target_id,
            sandbox_profile_id=sandbox_profile_id,
            cloud_sandbox_id=cloud_sandbox_id,
            slot_generation=slot_generation,
            token_hash=_hash_token(domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN, token=token),
            created_by_user_id=user_id,
            expires_at=utcnow() + timedelta(seconds=MANAGED_RUNTIME_ENROLLMENT_TTL_SECONDS),
        )
        return RuntimeTargetEnrollment(target_id=target_id, enrollment_token=token)
