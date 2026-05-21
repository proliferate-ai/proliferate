from __future__ import annotations

from dataclasses import dataclass

from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_mobility import load_due_cleanup_items
from proliferate.server.cloud.mobility.cleanup_executor import (
    SERVER_CLEANUP_ITEM_KINDS,
    execute_server_cleanup_item,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class MobilityCleanupReconcilerResult:
    attempted: int


async def reconcile_due_mobility_cleanup_items(
    *,
    limit: int = 50,
) -> MobilityCleanupReconcilerResult:
    async with db_engine.async_session_factory() as db:
        due_items = await load_due_cleanup_items(
            db,
            now=utcnow(),
            item_kinds=SERVER_CLEANUP_ITEM_KINDS,
            limit=limit,
        )

    attempted = 0
    for item in due_items:
        async with db_engine.async_session_factory() as db:
            await execute_server_cleanup_item(
                db,
                handoff_op_id=item.handoff_op_id,
                cleanup_item_id=item.id,
            )
            await db.commit()
            attempted += 1

    return MobilityCleanupReconcilerResult(attempted=attempted)
