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

from proliferate.config import settings
from proliferate.db.store import billing_subjects
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.billing.authorization import (
    assert_cloud_sandbox_resume_allowed_for_owner,
)
from proliferate.server.cloud.cloud_sandboxes.transactions import run_after_commit
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.provisioning_observability import provisioning_phase
from proliferate.utils.crypto import decrypt_text

logger = logging.getLogger("proliferate.cloud.cloud_sandboxes")


class _UserWithId(Protocol):
    id: UUID


def require_cloud_provisioning_configured() -> None:
    """Fail cloud-provisioning requests with an actionable error when E2B is
    half-configured (API key set, template missing).

    This is the request-time peer of the boot-time warning in ``main.py``: the
    control plane stays up for base features, but explicit cloud-provisioning
    intents return a specific 503 naming the missing requirement rather than
    booting the wrong E2B template or surfacing an opaque runtime failure.
    """
    config_error = settings.cloud_provisioning_config_error
    if config_error is not None:
        raise CloudApiError(
            "e2b_template_not_configured",
            config_error,
            status_code=503,
        )


async def get_cloud_sandbox_detail(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue | None:
    return await sandbox_store.load_personal_cloud_sandbox(db, user.id)


async def ensure_cloud_sandbox_ready(
    db: AsyncSession,
    user: _UserWithId,
) -> CloudSandboxValue:
    # LIVE billing gate (spec §4.3): an exhausted owner must not wake or ensure a
    # cloud sandbox. Gate BEFORE ensure_personal_cloud_sandbox_exists stages a
    # new-row INSERT, since the gate commits its audit row before raising. No-op
    # unless CLOUD_BILLING_MODE=enforce. wake_cloud_sandbox delegates here, so
    # both /cloud-sandbox/wake and /cloud-sandbox/ensure inherit this gate; the
    # GitHub-App trigger path calls ensure_personal_cloud_sandbox_exists directly
    # and is intentionally left ungated so a brand-new user's initial row still
    # gets created.
    require_cloud_provisioning_configured()
    await assert_cloud_sandbox_resume_allowed_for_owner(db, owner_user_id=user.id)
    return await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)


async def ensure_personal_cloud_sandbox_exists(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> CloudSandboxValue:
    async with provisioning_phase(scope="sandbox_ensure", phase="owner_lock"):
        await sandbox_store.acquire_cloud_sandbox_owner_lock(
            db,
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
        )
    async with provisioning_phase(scope="sandbox_ensure", phase="billing_subject"):
        billing_subject = await billing_subjects.ensure_personal_billing_subject(db, user_id)
    async with provisioning_phase(scope="sandbox_ensure", phase="sandbox_row"):
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
    destroyed = await sandbox_store.mark_cloud_sandbox_destroyed(db, sandbox.id)
    # Kill the provider VM so a destroyed row does not leave an E2B sandbox
    # running forever (it is created with on_timeout=pause + auto_resume, so it
    # never dies on its own). This MUST happen only after the DB destroy durably
    # commits: if we killed inline and the caller's transaction then rolled back,
    # the row would stay alive pointing at a dead provider id and the next
    # connect would resume the dead id instead of recreating — a wedged sandbox.
    # run_after_commit defers to the root-commit event and discards on rollback.
    # The captured ids are plain locals (no ORM access inside the callback, which
    # runs after the session may be closed). Loss on process restart before the
    # callback fires is accepted at-most-once behavior. The periodic orphan
    # reaper is the backstop for that loss and for pre-existing attributable
    # provider sandboxes; it applies its own grace and exact-ownership checks.
    if sandbox.e2b_sandbox_id:
        provider_sandbox_id = sandbox.e2b_sandbox_id
        template_ref = sandbox.e2b_template_ref
        sandbox_id_for_log = str(sandbox.id)

        async def _destroy_provider_sandbox() -> None:
            try:
                provider = get_sandbox_provider(template_ref)
                await provider.destroy_sandbox(provider_sandbox_id)
            except Exception:
                logger.exception(
                    "failed to destroy provider sandbox on cloud sandbox destroy",
                    extra={
                        "cloud_sandbox_id": sandbox_id_for_log,
                        "e2b_sandbox_id": provider_sandbox_id,
                    },
                )

        await run_after_commit(db, _destroy_provider_sandbox)
    return destroyed


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


async def load_cloud_sandbox_runtime_access_or_repair(
    sandbox: CloudSandboxValue,
    *,
    reason: str,
) -> tuple[str, str, str]:
    """Request-time access resolution that repairs a cold row instead of dead-ending.

    ``load_cloud_sandbox_runtime_access`` is a pure read: it 409s when the row
    carries no runtime access, which is the truth for a row that was never
    materialized or whose access was cleared by provider loss
    (``mark_cloud_sandbox_provider_missing``). Nothing else on a read path
    provisions, so a client would retry into the identical 409 forever — the
    sandbox has no way back to ready.

    This wrapper keeps the typed 409 exactly as it was (clients already treat it
    as "connecting", and provisioning takes far too long to hold a request open
    for) and additionally kicks off the materialization that stamps the row, so
    the retry the client is already doing eventually succeeds. It is the seam for
    *request-time* access paths only; materialization-internal callers keep using
    the bare loader, because they are already inside the operation that repairs.
    """

    try:
        return await load_cloud_sandbox_runtime_access(sandbox)
    except CloudApiError as error:
        if error.code != "cloud_sandbox_runtime_not_ready":
            raise
        await _schedule_cold_access_repair(sandbox=sandbox, reason=reason)
        raise


async def _schedule_cold_access_repair(
    *,
    sandbox: CloudSandboxValue,
    reason: str,
) -> None:
    # Imported here, not at module scope: the materialization package imports this
    # module (materializers resolve runtime access through it), so a top-level
    # import would close a cycle.
    from proliferate.server.cloud.materialization import service as materialization_service

    if sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        # A destroyed row is not cold, it is gone. Re-provisioning it would
        # resurrect a sandbox the user (or the reaper) deliberately killed.
        return
    owner_user_id = sandbox.owner_user_id
    if owner_user_id is None:
        return
    if not settings.cloud_provisioning_configured:
        # Deployments without managed cloud have nothing to materialize with; a
        # scheduled repair could only fail in the background.
        return
    # Billing is NOT re-checked here: every request-time access path runs the
    # owner resume gate before reaching access resolution (the gateway through
    # ``ensure_cloud_sandbox_ready``), and ``connect_ready_sandbox`` re-asserts it
    # inside the materialization itself, so a held subject cannot be resumed by a
    # repair. Scheduling is deliberately not a second gate.
    try:
        await materialization_service.schedule_repair_materialize_sandbox(
            sandbox_id=sandbox.id,
            user_id=owner_user_id,
            reason=reason,
        )
    except Exception:
        # The caller is already failing with the typed 409; a scheduling problem
        # (e.g. the claim backend misbehaving) must not turn that into a 500.
        logger.exception(
            "failed to schedule cold cloud sandbox access repair",
            extra={"cloud_sandbox_id": str(sandbox.id), "reason": reason},
        )
