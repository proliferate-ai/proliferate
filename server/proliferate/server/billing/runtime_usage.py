"""Billing runtime usage recording orchestration."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE
from proliferate.db import session_ops as db_session
from proliferate.db.store.billing_runtime_usage import (
    close_conflicting_provider_usage_segment,
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
    remember_sandbox_event_receipt,
)


async def remember_cloud_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await remember_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def record_cloud_sandbox_usage_started(
    *,
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> object:
    async with db_session.open_async_transaction() as db:
        return await open_usage_segment_for_sandbox(
            db,
            runtime_environment_id=runtime_environment_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=started_at,
            opened_by=opened_by,
            user_id=user_id,
            is_billable=is_billable,
            event_id=event_id,
        )


async def open_cloud_sandbox_provider_usage(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    provider_sandbox_id: str,
    user_id: UUID,
    started_at: datetime,
    opened_by: str,
    event_id: str,
) -> object:
    """Open exact provider usage inside the caller's lifecycle transaction."""

    return await open_usage_segment_for_sandbox(
        db,
        sandbox_id=sandbox_id,
        external_sandbox_id=provider_sandbox_id,
        sandbox_execution_id=None,
        started_at=started_at,
        opened_by=opened_by,
        user_id=user_id,
        event_id=event_id,
    )


async def record_cloud_sandbox_usage_stopped(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
    expected_external_sandbox_id: str | None = None,
    fail_on_provider_mismatch: bool = False,
) -> object | None:
    async with db_session.open_async_transaction() as db:
        return await close_usage_segment_for_sandbox(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            is_billable=is_billable,
            event_id=event_id,
            expected_external_sandbox_id=expected_external_sandbox_id,
            fail_on_provider_mismatch=fail_on_provider_mismatch,
        )


async def close_cloud_sandbox_provider_usage(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    provider_sandbox_id: str,
    ended_at: datetime,
    closed_by: str,
    event_id: str | None = None,
    fail_on_provider_mismatch: bool = True,
) -> object | None:
    """Close only the usage segment attributed to one provider binding.

    Recovery invokes this in the same transaction as binding supersession so a
    stale open segment cannot be inherited by a replacement.
    """

    return await close_usage_segment_for_sandbox(
        db,
        sandbox_id=sandbox_id,
        ended_at=ended_at,
        closed_by=closed_by,
        event_id=(
            event_id or f"provider-binding-stop:{sandbox_id}:{provider_sandbox_id}:{closed_by}"
        ),
        expected_external_sandbox_id=provider_sandbox_id,
        fail_on_provider_mismatch=fail_on_provider_mismatch,
    )


async def converge_cloud_sandbox_provider_usage(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    current_provider_sandbox_id: str | None,
    observed_at: datetime,
) -> object | None:
    """Converge legacy null attribution before provider I/O.

    The caller already owns the CloudSandbox row lock. A null-attributed segment
    is closed under that unchanged unknown identity; a successful resume opens
    a fresh exact-provider segment later. A conflicting concrete provider raises
    so its possibly-live billing interval is never silently stopped.
    """

    return await close_conflicting_provider_usage_segment(
        db,
        sandbox_id=sandbox_id,
        current_provider_sandbox_id=current_provider_sandbox_id,
        ended_at=observed_at,
        closed_by=USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE,
    )
