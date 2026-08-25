"""Current-model facade for personal cloud sandboxes.

This module is intentionally small while the old profile/target implementation is
parked. It talks to the simplified ``cloud_sandbox``/``repo_environment`` model
and keeps mounted gateway/API routes from importing the removed profile-target
ORM stack.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import billing_subjects
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import runtime_workers as runtime_workers_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.lib.infra.encryption.fernet import decrypt_text
from proliferate.server.api_errors import CloudApiError
from proliferate.server.billing.authorization import (
    assert_cloud_sandbox_resume_allowed_for_owner,
)
from proliferate.server.cloud.cloud_sandboxes.transactions import (
    commit_cloud_sandbox_session,
    run_after_commit,
)
from proliferate.server.cloud.provisioning_observability import provisioning_phase

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
    # unless CLOUD_BILLING_MODE=enforce. The GitHub-App trigger path calls
    # ensure_personal_cloud_sandbox_exists directly and is intentionally left
    # ungated so a brand-new user's initial row still gets created.
    require_cloud_provisioning_configured()
    await assert_cloud_sandbox_resume_allowed_for_owner(db, owner_user_id=user.id)
    sandbox = await ensure_personal_cloud_sandbox_exists(db, user_id=user.id)
    # Commit the ensured row before the caller resolves access against it. Every
    # caller of this function is a request entry point that commits at the end
    # anyway (`POST /cloud-sandbox/ensure`, `POST /cloud-sandbox/wake`, and the
    # gateway resolver — the direct `ensure_personal_cloud_sandbox_exists`
    # callers inside materialization are deliberately not routed here), so this
    # only moves the commit earlier. It has to be earlier on the gateway path:
    # access resolution for a brand-new row raises the typed 409, which rolls
    # the request session back. Without this commit the flushed-but-uncommitted
    # row vanished, so every poll of a fresh signup minted a *new* sandbox id —
    # a new repair claim key that could never collide, one background
    # materialization per poll, each of which then could not find the row.
    # Committing here makes the id stable (claims dedupe) and makes the row
    # visible to the repair's own fresh session.
    await commit_cloud_sandbox_session(db)
    return sandbox


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


async def observe_cloud_sandbox_provider_running(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
    expected_materialization_attempt: int,
    observed_at: datetime,
) -> CloudSandboxValue | None:
    return await sandbox_store.advance_cloud_sandbox_provider_observation_floor(
        db,
        sandbox_id,
        expected_provider_sandbox_id=expected_provider_sandbox_id,
        expected_materialization_attempt=expected_materialization_attempt,
        observed_at=observed_at,
    )


async def observe_cloud_sandbox_provider_stopped(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
    expected_materialization_attempt: int,
    observed_at: datetime,
) -> CloudSandboxValue | None:
    updated = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db,
        sandbox_id,
        status="paused",
        expected_provider_sandbox_id=expected_provider_sandbox_id,
        expected_materialization_attempt=expected_materialization_attempt,
        observed_at=observed_at,
    )
    if updated is not None:
        return updated
    return await sandbox_store.accept_destroyed_cloud_sandbox_provider_observation(
        db,
        sandbox_id,
        expected_provider_sandbox_id=expected_provider_sandbox_id,
        expected_materialization_attempt=expected_materialization_attempt,
        observed_at=observed_at,
    )


async def observe_cloud_sandbox_provider_missing(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    expected_provider_sandbox_id: str,
    expected_materialization_attempt: int,
    observed_at: datetime,
) -> CloudSandboxValue | None:
    # Imported lazily because materialization failures invalidate gateway
    # access, while the gateway service imports this module.
    from proliferate.server.cloud.materialization.failures import (
        PROVIDER_SANDBOX_MISSING_RECEIPT,
    )

    updated = await sandbox_store.mark_cloud_sandbox_provider_missing(
        db,
        sandbox_id,
        expected_provider_sandbox_id=expected_provider_sandbox_id,
        expected_materialization_attempt=expected_materialization_attempt,
        observed_at=observed_at,
        last_error=PROVIDER_SANDBOX_MISSING_RECEIPT,
    )
    if updated is not None:
        if updated.owner_user_id is not None:
            # Imported lazily to avoid the gateway -> cloud-sandbox service
            # dependency becoming a module cycle.
            from proliferate.server.cloud.gateway.service import (
                invalidate_cloud_sandbox_gateway_access_for_user,
            )

            invalidate_cloud_sandbox_gateway_access_for_user(updated.owner_user_id)
        return updated
    return await sandbox_store.accept_destroyed_cloud_sandbox_provider_observation(
        db,
        sandbox_id,
        expected_provider_sandbox_id=expected_provider_sandbox_id,
        expected_materialization_attempt=expected_materialization_attempt,
        observed_at=observed_at,
    )


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
    await cloud_workspace_store.mark_cloud_workspaces_lost_for_sandbox(
        db,
        destroyed or sandbox,
    )
    # Import lazily to avoid the gateway -> cloud-sandbox service dependency
    # becoming a module cycle.
    from proliferate.server.cloud.gateway.service import (
        invalidate_cloud_sandbox_gateway_access_for_user,
    )

    invalidate_cloud_sandbox_gateway_access_for_user(user.id)
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
        decrypt_text(sandbox.anyharness_bearer_token_ciphertext, secret=settings.cloud_secret_key),
        decrypt_text(sandbox.anyharness_data_key_ciphertext, secret=settings.cloud_secret_key),
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
    if sandbox.owner_scope != "personal" or sandbox.organization_id is not None:
        # Invariant this scheduler depends on: the claim is keyed by *sandbox id*
        # while the repair materializes the owner's CURRENT personal sandbox
        # (``materialize_sandbox`` resolves it by user id). Those coincide only
        # because ``ux_cloud_sandbox_personal_active`` makes at most one active
        # personal row per user. When org-owned sandboxes land, a cold org row
        # would take a claim keyed on itself and then repair the owner's personal
        # sandbox instead — wrong target, and a claim that never guards the row it
        # names. Fail closed here until the repair is given an explicit target.
        logger.info(
            "cloud_sandbox_access_repair_skipped_non_personal",
            extra={"cloud_sandbox_id": str(sandbox.id), "reason": reason},
        )
        return
    # Billing is NOT re-checked here, and scheduling is deliberately un-gated:
    # ``_read_managed_cloud_source`` reaches this with no billing gate at all, and
    # ``_load_ready_runtime_access`` only inherits one transitively. The
    # load-bearing safety is inside the materialization: ``connect_ready_sandbox``
    # asserts ``assert_cloud_sandbox_resume_allowed`` before it touches a provider
    # or creates a VM. So the worst a held subject can drive from here is one
    # Redis claim plus a background task that stops at that gate — never an E2B
    # create.
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
