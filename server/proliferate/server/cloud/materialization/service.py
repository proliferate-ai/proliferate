"""Public cloud materialization entrypoints."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.materialization import locks, operation, runner
from proliferate.server.cloud.materialization.materialize import (
    agent_auth as agent_auth_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    repo_environment as repo_environment_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    sandbox as sandbox_materializer,
)
from proliferate.server.cloud.materialization.materialize import (
    secret_set as secret_set_materializer,
)

logger = logging.getLogger("proliferate.cloud.materialization")

# How long a repair claim suppresses further repair scheduling for one sandbox.
# It must comfortably cover a cold provision (a fresh E2B VM plus the runtime
# initialize sequence, ~30-60 s in practice, with the operation lock itself
# allowed 600 s) so a client polling the typed 409 every second does not queue a
# second provision behind the first. It must also be short enough that a repair
# lost to a process restart is retried on the next access rather than being
# suppressed for the rest of the day.
SANDBOX_REPAIR_CLAIM_TTL_SECONDS = 900


async def schedule_materialize_sandbox(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_sandbox:{user_id}",
        task=lambda: _spawn(materialize_sandbox, user_id=user_id),
    )


async def schedule_repair_materialize_sandbox(
    *,
    sandbox_id: UUID,
    user_id: UUID,
    reason: str,
) -> bool:
    """Schedule at most one background repair materialization for a cold sandbox.

    Returns True when this call is the one that scheduled the repair and False
    when another caller already owns it. The return value exists for tests and
    callers that want the distinction; the request-time access seam ignores it,
    because either outcome means "a repair is in flight, keep polling".

    The access path (gateway or any other runtime-access resolution) can observe
    a sandbox row whose runtime access was never stamped or was cleared by
    provider loss. That row cannot repair itself: nothing else on a read path
    provisions, so the caller would otherwise retry into the same typed 409
    forever. This schedules the materialization that stamps it.

    Two layers keep it stampede-safe:

    - the cross-process Redis claim taken here, so N concurrent access calls
      (across workers) schedule at most one materialization per sandbox;
    - the per-sandbox materialization lock inside
      ``run_cloud_sandbox_operation``, which serializes any run that does start.

    The claim is released after the materialization attempt finishes so a failed
    attempt is retried on the next access instead of waiting out the TTL.

    Unlike the other schedulers here this does NOT defer to after-commit, and
    takes no session. Its caller is a request that is about to *fail* with the
    typed 409, so its transaction rolls back — an after-commit callback would be
    discarded while the claim stayed held, suppressing repair for a whole TTL.
    The repair reads authoritative state in its own fresh session and depends on
    nothing the failing request staged, so spawning it directly is both correct
    and the only variant that cannot strand the claim.
    """

    claim_key = f"sandbox-repair:{sandbox_id}"
    token = await locks.try_claim_materialization_trigger(
        claim_key,
        ttl_seconds=SANDBOX_REPAIR_CLAIM_TTL_SECONDS,
    )
    if token is None:
        # Someone else already owns the repair for this sandbox (or Redis is
        # unreachable). Either way, do not add a second provision.
        return False
    logger.info(
        "cloud_sandbox_access_repair_scheduled",
        extra={
            "cloud_sandbox_id": str(sandbox_id),
            "user_id": str(user_id),
            "reason": reason,
        },
    )
    try:
        runner.spawn_materialization_task(
            _repair_materialize_sandbox,
            user_id=user_id,
            claim_key=claim_key,
            claim_token=token,
        )
    except BaseException:
        # The spawn can fail synchronously (a shutting-down event loop rejects
        # `create_task`). Nothing will run and therefore nothing will release, so
        # the claim would suppress repair for the whole TTL. Hand it back before
        # letting the failure out; the access seam logs it and still returns its
        # typed 409, so the client's next poll can schedule afresh.
        await locks.release_materialization_trigger_claim(claim_key, token=token)
        raise
    return True


async def _repair_materialize_sandbox(
    db: AsyncSession,
    *,
    user_id: UUID,
    claim_key: str,
    claim_token: str,
) -> None:
    try:
        await materialize_sandbox(db, user_id=user_id)
    except operation.CloudMaterializationError as error:
        if str(error) != sandbox_materializer.SANDBOX_MISSING_ERROR_CODE:
            raise
        # The row vanished between scheduling and running (destroyed by the
        # owner or the reaper, or a never-committed row from an older caller).
        # That is a benign race, not an incident: swallow it here so the runner's
        # generic handler cannot turn a routine disappearance into a page. Every
        # other materialization failure still propagates and still pages.
        logger.info(
            "cloud_sandbox_access_repair_sandbox_missing",
            extra={"user_id": str(user_id), "claim_key": claim_key},
        )
    finally:
        # Release inside the background task, not the request: holding the claim
        # for the whole attempt is exactly what suppresses duplicate scheduling
        # while a provision is in flight. Shielded because this task can be
        # cancelled at shutdown mid-await: an unreleased claim would suppress
        # repair for the full TTL, and the release is a single short Redis
        # round-trip (the same shielding the session teardown in db/engine.py
        # applies to its rollback/close).
        await asyncio.shield(
            locks.release_materialization_trigger_claim(claim_key, token=claim_token)
        )


async def schedule_materialize_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_repo_environment:{repo_environment_id}",
        task=lambda: _spawn(
            materialize_repo_environment,
            repo_environment_id=repo_environment_id,
        ),
    )


async def schedule_materialize_secret_set(
    db: AsyncSession,
    *,
    secret_set_id: UUID,
) -> None:
    await runner.run_after_commit(
        db,
        label=f"materialize_secret_set:{secret_set_id}",
        task=lambda: _spawn(materialize_secret_set, secret_set_id=secret_set_id),
    )


async def schedule_materialize_agent_auth(
    db: AsyncSession,
    *,
    user_id: UUID,
    ensure_sandbox: bool = False,
) -> None:
    """Refresh agent-auth state in the user's active cloud sandbox after commit.

    ``ensure_sandbox=True`` is the ensure-on-switch trigger (agent-auth.md "A
    cloud switch ensures the sandbox"): the spawned task then provisions-or-
    wakes the user's existing sandbox instead of no-opping when the provider
    has not booted, so the switched document lands now rather than at the next
    unrelated wake. This only schedules — no caller ever awaits sandbox boot
    or readiness; the acknowledgement pipeline observes arrival.
    """
    await runner.run_after_commit(
        db,
        label=f"materialize_agent_auth:{user_id}",
        task=lambda: _spawn(
            materialize_agent_auth,
            user_id=user_id,
            ensure_sandbox=ensure_sandbox,
        ),
    )


async def materialize_sandbox(db: AsyncSession, *, user_id: UUID) -> None:
    await sandbox_materializer.materialize_sandbox(db, user_id=user_id)


async def materialize_repo_environment(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> None:
    await repo_environment_materializer.materialize_repo_environment(
        db,
        repo_environment_id=repo_environment_id,
    )


async def materialize_repo_environment_at_frozen_base(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
    base_ref: str,
    expected_cloud_sandbox_id: UUID,
) -> None:
    """Materialize one Cloud repo using the invocation's persisted base ref."""

    await repo_environment_materializer.materialize_repo_environment(
        db,
        repo_environment_id=repo_environment_id,
        frozen_base_ref=base_ref,
        expected_cloud_sandbox_id=expected_cloud_sandbox_id,
    )


async def materialize_secret_set(db: AsyncSession, *, secret_set_id: UUID) -> None:
    await secret_set_materializer.materialize_secret_set(db, secret_set_id=secret_set_id)


async def materialize_agent_auth(
    db: AsyncSession,
    *,
    user_id: UUID,
    ensure_sandbox: bool = False,
) -> None:
    await agent_auth_materializer.materialize_agent_auth_for_user(
        db,
        user_id=user_id,
        ensure_sandbox=ensure_sandbox,
    )


async def _spawn(fn: Callable[..., Awaitable[None]], **kwargs: object) -> None:
    runner.spawn_materialization_task(fn, **kwargs)
