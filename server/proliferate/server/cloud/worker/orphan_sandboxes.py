"""Conservative provider attribution and cleanup for orphaned Cloud sandboxes."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.cloud_sandboxes import load_cloud_sandbox_by_id
from proliferate.integrations.sandbox import ProviderSandboxState, SandboxProvider
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.orphan_reaper")

_METADATA_SANDBOX_ID_KEY = "proliferate_cloud_sandbox_id"
_DEAD_STATES = frozenset({"killed", "destroyed", "terminated"})
_LIVE_STATES = frozenset({"running", "paused"})


async def reap_orphan_sandboxes(db: AsyncSession, *, provider: SandboxProvider) -> None:
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
            # Untagged provider objects may belong to qualification or another
            # product. Absence of our exact creation tag is never ownership.
            skipped_untagged += 1
            continue

        try:
            cloud_sandbox_id = UUID(raw_id)
        except (ValueError, TypeError, AttributeError):
            logger.warning(
                "orphan reaper saw an unparseable cloud sandbox attribution tag",
                extra={"external_sandbox_id": state.external_sandbox_id},
            )
            skipped_unknown_row += 1
            continue
        # Creation writes canonical ``str(UUID)``. Accepting other spellings
        # would broaden attribution beyond bytes this product actually emits.
        if str(cloud_sandbox_id) != raw_id:
            logger.warning(
                "orphan reaper saw a noncanonical cloud sandbox attribution tag",
                extra={"external_sandbox_id": state.external_sandbox_id},
            )
            skipped_unknown_row += 1
            continue

        row = await load_cloud_sandbox_by_id(db, cloud_sandbox_id)
        if row is None:
            # A shared E2B account may contain objects from another environment.
            # A valid-looking tag without a row in this DB is still not ours.
            logger.warning(
                "orphan reaper saw a sandbox attributed to an unknown local row",
                extra={"external_sandbox_id": state.external_sandbox_id},
            )
            skipped_unknown_row += 1
            continue

        young = _within_grace(state, now=now, grace_seconds=grace_seconds)

        if row.destroyed_at is not None:
            # The durable row proves product deletion. Preserve the grace window
            # whenever the provider supplies age; missing age is eligible only
            # for this terminal local state, never for a live-row mismatch.
            if state.started_at is not None and young:
                skipped_grace += 1
                continue
            if await _destroy(provider, state.external_sandbox_id):
                reaped += 1
            continue

        if row.e2b_sandbox_id is None:
            # An active row without a binding may be between create and record.
            skipped_healthy += 1
            continue

        if row.e2b_sandbox_id != state.external_sandbox_id:
            # The row positively owns another exact provider id. This duplicate
            # is eligible only when its provider age is known and past grace.
            if state.started_at is None or young:
                skipped_grace += 1
                continue
            if await _destroy(provider, state.external_sandbox_id):
                reaped += 1
            continue

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


def _within_grace(
    state: ProviderSandboxState,
    *,
    now: datetime,
    grace_seconds: float,
) -> bool:
    if state.started_at is None:
        return False
    started_at = state.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    return (now - started_at).total_seconds() < grace_seconds


async def _destroy(provider: SandboxProvider, external_sandbox_id: str) -> bool:
    try:
        await provider.destroy_sandbox(external_sandbox_id)
        return True
    except Exception:
        logger.exception(
            "orphan reaper failed to destroy provider sandbox",
            extra={"external_sandbox_id": external_sandbox_id},
        )
        return False
