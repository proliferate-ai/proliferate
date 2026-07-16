"""Domain logic for reaping orphaned provider sandboxes.

The server destroys ``cloud_sandbox`` rows and (after commit) best-effort kills
their provider VMs, but a provider VM can still outlive its row: an at-most-once
after-commit destroy lost on restart, or a create/destroy race that never
records the provider id (see ``connect_ready_sandbox``). E2B sandboxes are
created with ``on_timeout=pause`` + ``auto_resume``, so an orphan never dies on
its own.

``run_orphan_sandbox_reap_pass`` is the durable backstop for exactly that loss.
It lists live provider sandboxes, attributes each back to a ``cloud_sandbox``
row via the ``proliferate_cloud_sandbox_id`` creation tag, and destroys only the
ones it can positively attribute to a destroyed or superseded row in THIS
database. Anything it cannot attribute is left alone: the E2B account may host
sandboxes another environment (or other tooling) owns, and killing those would
be catastrophic.

The periodic trigger lives in the Beat/Celery substrate (a thin wrapper in
``proliferate.background.tasks.cloud_sandboxes`` scheduled by
``build_beat_schedule``); this module stays domain-owned. The Postgres advisory
lock below is the cross-worker singleton guard: overlapping Celery workers must
not run two passes at once against the same provider account.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_sandboxes import (
    load_cloud_sandbox_by_id,
    release_cloud_sandbox_reaper_lock,
    try_acquire_cloud_sandbox_reaper_lock,
)
from proliferate.integrations.sandbox import (
    ProviderSandboxState,
    SandboxProvider,
    get_configured_sandbox_provider,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.reaper")

_METADATA_SANDBOX_ID_KEY = "proliferate_cloud_sandbox_id"
# Provider states that already imply a dead VM — nothing to reap.
_DEAD_STATES = frozenset({"killed", "destroyed", "terminated"})
# Only running/paused VMs cost money; paused E2B sandboxes still hold storage
# and auto-resume, so they are reaped too.
_LIVE_STATES = frozenset({"running", "paused"})


async def run_orphan_sandbox_reap_pass() -> None:
    async with db_engine.async_session_factory() as lock_db:
        acquired = await try_acquire_cloud_sandbox_reaper_lock(lock_db)
        if not acquired:
            logger.debug("orphan reaper skipped because another instance owns the lock")
            return
        try:
            await _reap(get_configured_sandbox_provider())
        finally:
            await release_cloud_sandbox_reaper_lock(lock_db)


async def _reap(provider: SandboxProvider) -> None:
    states = await provider.list_sandbox_states()
    now = utcnow()
    grace_seconds = settings.cloud_sandbox_reaper_grace_seconds

    reaped = 0
    skipped_untagged = 0
    skipped_unknown_row = 0
    skipped_healthy = 0
    skipped_grace = 0

    for state in states:
        if state.state in _DEAD_STATES or state.state not in _LIVE_STATES:
            continue

        raw_id = state.metadata.get(_METADATA_SANDBOX_ID_KEY)
        if not raw_id:
            # Untagged: not ours to touch (qualification runs, other tooling).
            skipped_untagged += 1
            continue

        try:
            cloud_sandbox_id = UUID(raw_id)
        except (ValueError, TypeError):
            # Tagged but unparseable — treat as an unknown row we cannot attribute.
            logger.warning(
                "orphan reaper saw sandbox with unparseable cloud_sandbox_id tag",
                extra={"external_sandbox_id": state.external_sandbox_id, "tag": raw_id},
            )
            skipped_unknown_row += 1
            continue

        async with db_engine.async_session_factory() as db:
            row = await load_cloud_sandbox_by_id(db, cloud_sandbox_id)

        if row is None:
            # Tagged for a row that does not exist in THIS database. Fail-safe:
            # another environment may share the E2B account, so never kill what
            # we cannot positively attribute to our own DB.
            logger.warning(
                "orphan reaper saw sandbox tagged for an unknown row; skipping",
                extra={
                    "external_sandbox_id": state.external_sandbox_id,
                    "cloud_sandbox_id": raw_id,
                },
            )
            skipped_unknown_row += 1
            continue

        young = _within_grace(state, now, grace_seconds)

        if row.destroyed_at is not None:
            # Orphan: the row is destroyed but the VM is still alive. Grace still
            # applies (a create racing a destroy could have a very-fresh VM); if
            # started_at is unknown, treat as old enough for the destroyed case.
            if state.started_at is not None and young:
                skipped_grace += 1
                continue
            if await _destroy(provider, state.external_sandbox_id):
                reaped += 1
            continue

        if row.e2b_sandbox_id is None:
            # Alive row with an in-flight create that has not recorded yet. Never
            # race it — Part B handles the destroyed case at the source.
            skipped_healthy += 1
            continue

        if row.e2b_sandbox_id != state.external_sandbox_id:
            # Superseded duplicate from a concurrent-create race: the row points
            # at a different VM. Reap this stray, but only once it is past grace
            # (its create/record may simply not have committed yet). An unknown
            # started_at cannot be aged, so skip the mismatch case then.
            if state.started_at is None or young:
                skipped_grace += 1
                continue
            if await _destroy(provider, state.external_sandbox_id):
                reaped += 1
            continue

        # Row alive, ids match: healthy.
        skipped_healthy += 1

    summary = {
        "reaped": reaped,
        "skipped_untagged": skipped_untagged,
        "skipped_unknown_row": skipped_unknown_row,
        "skipped_healthy": skipped_healthy,
        "skipped_grace": skipped_grace,
    }
    if reaped:
        logger.info("orphan reaper destroyed provider sandboxes", extra=summary)
    else:
        logger.debug("orphan reaper pass complete", extra=summary)


def _within_grace(state: ProviderSandboxState, now: datetime, grace_seconds: float) -> bool:
    if state.started_at is None:
        return False
    started_at = state.started_at
    if started_at.tzinfo is None:
        # A provider payload without an offset parses naive; assume UTC rather
        # than letting the aware-naive subtraction abort the whole pass.
        started_at = started_at.replace(tzinfo=UTC)
    return (now - started_at).total_seconds() < grace_seconds


async def _destroy(provider: SandboxProvider, external_id: str) -> bool:
    try:
        await provider.destroy_sandbox(external_id)
        return True
    except Exception:
        logger.exception(
            "orphan reaper failed to destroy provider sandbox",
            extra={"external_sandbox_id": external_id},
        )
        return False
