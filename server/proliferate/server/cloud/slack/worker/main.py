"""Transaction entry points for deferred Cloud Slack bot work."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops as db_session
from proliferate.db.store.cloud_slack import events as slack_event_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.worker import events, outbound


def defer_inbound_job_after_commit(db: AsyncSession, job_id: UUID) -> None:
    db_session.defer_after_commit(
        db,
        lambda job_id=job_id: process_inbound_job_and_due_outbound(job_id),
    )


async def process_inbound_job_and_due_outbound(job_id: UUID) -> None:
    await process_inbound_job_by_id(job_id)
    await process_due_outbound_messages()


async def process_inbound_job_by_id(job_id: UUID) -> None:
    async with db_session.open_async_session() as db:
        async with db.begin():
            job = await slack_event_store.mark_job_processing(db, job_id)
        if job is None:
            return
        try:
            await events.process_inbound_job(db, job)
            await slack_event_store.mark_job_completed(db, job.id)
            await db_session.commit_session(db)
        except CloudApiError as exc:
            await db_session.rollback_session(db)
            await events.queue_job_error(db, job, error_code=exc.code, message=exc.message)
            await slack_event_store.mark_job_failed(
                db,
                job.id,
                error_code=exc.code,
                error_message=exc.message,
            )
            await db_session.commit_session(db)
        except Exception as exc:
            await db_session.rollback_session(db)
            await events.queue_job_error(db, job, error_code="slack_job_failed", message=str(exc))
            await slack_event_store.mark_job_failed(
                db,
                job.id,
                error_code="slack_job_failed",
                error_message=str(exc),
            )
            await db_session.commit_session(db)


async def process_due_outbound_messages(*, limit: int = 20) -> None:
    async with db_session.open_async_transaction() as db:
        await outbound.process_due_outbound_messages(db, limit=limit)
