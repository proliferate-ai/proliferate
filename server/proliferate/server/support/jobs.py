from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import run_after_commit
from proliferate.server.support.diagnostics import collect_cloud_diagnostics_for_report


async def schedule_cloud_diagnostics_after_commit(db: AsyncSession, report_id: str) -> None:
    async def _collect_after_commit() -> None:
        await collect_cloud_diagnostics_for_report(report_id)

    await run_after_commit(db, _collect_after_commit)
