"""Current-model facade for personal cloud sandboxes.

This module is intentionally small while the old profile/target implementation is
parked. It talks to the simplified ``cloud_sandbox``/``repo_environment`` model
and keeps mounted gateway/API routes from importing the removed profile-target
ORM stack.
"""

from __future__ import annotations

import logging
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import billing_subjects
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.cloud.errors import CloudApiError
from proliferate.utils.crypto import decrypt_text

logger = logging.getLogger("proliferate.cloud.cloud_sandboxes.service")


class _UserWithId(Protocol):
    id: UUID


async def get_cloud_sandbox_detail(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue | None:
    return await sandbox_store.load_personal_cloud_sandbox(db, user.id)


async def ensure_cloud_sandbox_ready(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue:
    return await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)


async def ensure_personal_cloud_sandbox_exists(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> CloudSandboxValue:
    await sandbox_store.acquire_cloud_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
    )
    billing_subject = await billing_subjects.ensure_personal_billing_subject(db, user_id)
    sandbox = await sandbox_store.ensure_personal_cloud_sandbox(
        db,
        user_id=user_id,
        created_by_user_id=user_id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref="e2b",
    )
    return sandbox


async def wake_cloud_sandbox(db: AsyncSession, user: _UserWithId) -> CloudSandboxValue:
    return await ensure_cloud_sandbox_ready(db, user)


async def destroy_cloud_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue | None:
    sandbox = await sandbox_store.load_personal_cloud_sandbox(db, user.id, lock_row=True)
    if sandbox is None:
        return None
    # Retire the sandbox's worker + gateway token so a destroyed sandbox can
    # never keep authenticating back to Cloud.
    await runtime_workers_store.revoke_active_workers_for_identity(db, cloud_sandbox_id=sandbox.id)

    # Best-effort: destroy the provider sandbox so the VM stops running.
    # Provider failure must not abort the DB-level destroy.
    if sandbox.e2b_sandbox_id:
        try:
            provider = get_sandbox_provider(sandbox.e2b_template_ref)
            await provider.destroy_sandbox(sandbox.e2b_sandbox_id)
        except Exception:
            logger.warning(
                "Failed to destroy provider sandbox (best-effort). "
                "cloud_sandbox_id=%s provider_sandbox_id=%s",
                sandbox.id,
                sandbox.e2b_sandbox_id,
                exc_info=True,
            )

    return await sandbox_store.mark_cloud_sandbox_destroyed(db, sandbox.id)


async def load_cloud_sandbox_runtime_access(
    sandbox: CloudSandboxValue,
) -> tuple[str, str, str]:
    if (
        not sandbox.anyharness_base_url
        or not sandbox.anyharness_bearer_token_ciphertext
        or not sandbox.anyharness_data_key_ciphertext
    ):
        raise CloudApiError(
            "cloud_sandbox_runtime_not_ready",
            "Cloud sandbox runtime access is not ready.",
            status_code=409,
        )
    return (
        sandbox.anyharness_base_url,
        decrypt_text(sandbox.anyharness_bearer_token_ciphertext),
        decrypt_text(sandbox.anyharness_data_key_ciphertext),
    )
