"""Persistence and secret-destroying transitions for revocation jobs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integration_revocation import (
    CloudIntegrationRevocationJob,
)
from proliferate.lib.infra.time.wall_clock import utcnow

TERMINAL_REVOCATION_STATUSES = frozenset({"succeeded", "unsupported", "exhausted"})


@dataclass(frozen=True)
class IntegrationRevocationJobRecord:
    id: UUID
    account_id: UUID
    owner_user_id: UUID
    definition_id: UUID
    provider_namespace: str
    provider_client_id: UUID | None
    credential_ciphertext: str | None
    credential_format: str
    status: str
    attempt_count: int
    last_error_code: str | None
    deadline_at: datetime
    last_attempt_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _record(row: CloudIntegrationRevocationJob) -> IntegrationRevocationJobRecord:
    return IntegrationRevocationJobRecord(
        id=row.id,
        account_id=row.account_id,
        owner_user_id=row.owner_user_id,
        definition_id=row.definition_id,
        provider_namespace=row.provider_namespace,
        provider_client_id=row.provider_client_id,
        credential_ciphertext=row.credential_ciphertext,
        credential_format=row.credential_format,
        status=row.status,
        attempt_count=row.attempt_count,
        last_error_code=row.last_error_code,
        deadline_at=row.deadline_at,
        last_attempt_at=row.last_attempt_at,
        completed_at=row.completed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_revocation_job(
    db: AsyncSession,
    *,
    account_id: UUID,
    owner_user_id: UUID,
    definition_id: UUID,
    provider_namespace: str,
    provider_client_id: UUID | None,
    credential_ciphertext: str,
    credential_format: str,
    deadline_at: datetime,
) -> IntegrationRevocationJobRecord:
    row = CloudIntegrationRevocationJob(
        account_id=account_id,
        owner_user_id=owner_user_id,
        definition_id=definition_id,
        provider_namespace=provider_namespace,
        provider_client_id=provider_client_id,
        credential_ciphertext=credential_ciphertext,
        credential_format=credential_format,
        status="pending",
        attempt_count=0,
        deadline_at=deadline_at,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _record(row)


async def create_unsupported_revocation_receipt(
    db: AsyncSession,
    *,
    account_id: UUID,
    owner_user_id: UUID,
    definition_id: UUID,
    provider_namespace: str,
    provider_client_id: UUID | None,
    credential_format: str,
    deadline_at: datetime,
    error_code: str,
) -> IntegrationRevocationJobRecord:
    now = utcnow()
    row = CloudIntegrationRevocationJob(
        account_id=account_id,
        owner_user_id=owner_user_id,
        definition_id=definition_id,
        provider_namespace=provider_namespace,
        provider_client_id=provider_client_id,
        credential_ciphertext=None,
        credential_format=credential_format,
        status="unsupported",
        attempt_count=0,
        last_error_code=error_code[:64],
        deadline_at=deadline_at,
        completed_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _record(row)


async def get_revocation_job(
    db: AsyncSession,
    job_id: UUID,
) -> IntegrationRevocationJobRecord | None:
    row = await db.get(CloudIntegrationRevocationJob, job_id)
    return _record(row) if row is not None else None


def _finish(
    row: CloudIntegrationRevocationJob,
    *,
    status: str,
    error_code: str | None,
    now: datetime,
) -> None:
    row.status = status
    row.credential_ciphertext = None
    row.last_error_code = error_code
    row.completed_at = now
    row.updated_at = now


async def claim_revocation_job(
    db: AsyncSession,
    job_id: UUID,
    *,
    lease_seconds: int,
) -> tuple[IntegrationRevocationJobRecord | None, bool]:
    row = await db.scalar(
        select(CloudIntegrationRevocationJob)
        .where(CloudIntegrationRevocationJob.id == job_id)
        .with_for_update()
    )
    if row is None or row.status in TERMINAL_REVOCATION_STATUSES:
        return _record(row) if row is not None else None, False
    now = utcnow()
    if row.deadline_at <= now:
        _finish(row, status="exhausted", error_code="deadline_exceeded", now=now)
        await db.flush()
        await db.refresh(row)
        return _record(row), False
    if (
        row.status == "running"
        and row.last_attempt_at is not None
        and row.last_attempt_at + timedelta(seconds=lease_seconds) > now
    ):
        return _record(row), False
    row.status = "running"
    row.attempt_count += 1
    row.last_attempt_at = now
    row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _record(row), True


async def complete_revocation_job(
    db: AsyncSession,
    *,
    job_id: UUID,
    status: str,
    error_code: str | None,
    expected_attempt: int,
) -> IntegrationRevocationJobRecord | None:
    if status not in TERMINAL_REVOCATION_STATUSES:
        raise ValueError(f"unsupported terminal revocation status: {status}")
    row = await db.scalar(
        select(CloudIntegrationRevocationJob)
        .where(CloudIntegrationRevocationJob.id == job_id)
        .with_for_update()
    )
    if row is None:
        return None
    if row.status not in TERMINAL_REVOCATION_STATUSES and row.attempt_count == expected_attempt:
        _finish(row, status=status, error_code=error_code, now=utcnow())
        await db.flush()
        await db.refresh(row)
    return _record(row)


async def release_revocation_job_for_retry(
    db: AsyncSession,
    *,
    job_id: UUID,
    error_code: str,
    expected_attempt: int,
) -> IntegrationRevocationJobRecord | None:
    row = await db.scalar(
        select(CloudIntegrationRevocationJob)
        .where(CloudIntegrationRevocationJob.id == job_id)
        .with_for_update()
    )
    if row is None or row.status in TERMINAL_REVOCATION_STATUSES:
        return _record(row) if row is not None else None
    now = utcnow()
    if row.deadline_at <= now:
        _finish(row, status="exhausted", error_code="deadline_exceeded", now=now)
    elif row.attempt_count == expected_attempt:
        row.status = "pending"
        row.last_error_code = error_code[:64]
        row.updated_at = now
    await db.flush()
    await db.refresh(row)
    return _record(row)


async def exhaust_due_revocation_jobs(db: AsyncSession) -> int:
    now = utcnow()
    result = await db.execute(
        update(CloudIntegrationRevocationJob)
        .where(
            CloudIntegrationRevocationJob.status.in_({"pending", "running"}),
            CloudIntegrationRevocationJob.deadline_at <= now,
        )
        .values(
            status="exhausted",
            credential_ciphertext=None,
            last_error_code="deadline_exceeded",
            completed_at=now,
            updated_at=now,
        )
    )
    await db.flush()
    return int(getattr(result, "rowcount", 0) or 0)
