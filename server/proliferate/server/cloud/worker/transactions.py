"""API-facing worker transaction helpers."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops as db_session
from proliferate.server.cloud.worker import commands, service
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.models import (
    WorkerCommandLeaseRequest,
    WorkerCommandLeaseResponse,
    WorkerMaterializationReportRequest,
    WorkerMaterializationReportResponse,
)


async def record_materialization_report_and_commit(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerMaterializationReportRequest,
) -> WorkerMaterializationReportResponse:
    response = await service.record_materialization_report(db, auth=auth, body=body)
    await db_session.commit_session(db)
    return response


async def lease_worker_command_and_commit_if_needed(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerCommandLeaseRequest,
) -> WorkerCommandLeaseResponse:
    response, should_commit = await commands.prepare_worker_command_lease(
        db,
        auth=auth,
        body=body,
    )
    if should_commit:
        await db_session.commit_session(db)
    return response
