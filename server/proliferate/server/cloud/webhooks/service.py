from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    PROVIDER_EVENT_KIND_CREATED,
    PROVIDER_EVENT_KIND_KILLED,
    PROVIDER_EVENT_KIND_PAUSED,
    PROVIDER_EVENT_KIND_RESUMED,
    PROVIDER_EVENT_KIND_TIMEOUT,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED,
)
from proliferate.db.store.cloud_runtime_environments import (
    load_runtime_environment_by_id,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_workspaces import (
    load_cloud_sandbox_by_external_id,
    load_cloud_sandbox_by_id,
    load_cloud_workspace_by_id,
    save_sandbox_provider_state,
)
from proliferate.integrations.sandbox import (
    E2BWebhookSignatureError,
    get_sandbox_provider,
    verify_e2b_webhook_signature,
)
from proliferate.server.billing.service import (
    get_billing_snapshot_for_subject,
    record_cloud_sandbox_usage_started,
    record_cloud_sandbox_usage_stopped,
    remember_cloud_sandbox_event_receipt,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.domain.provider_events import (
    is_stale_provider_event as _is_stale_provider_event,
)
from proliferate.server.cloud.runtime.domain.provider_events import (
    provider_event_kind as _provider_event_kind,
)
from proliferate.server.cloud.runtime.domain.runtime_state import (
    runtime_provider_destroyed_update,
    runtime_provider_paused_update,
    runtime_provider_running_update,
)
from proliferate.server.cloud.webhooks.models import E2BWebhookEvent, E2BWebhookReceipt

_E2B_WEBHOOK_ERROR_RESPONSE = {
    "unconfigured": ("webhook_unavailable", 503),
    "missing_signature": ("invalid_webhook_signature", 401),
    "invalid_signature": ("invalid_webhook_signature", 401),
}


def _verify_e2b_signature(raw_body: bytes, signature: str | None) -> None:
    try:
        verify_e2b_webhook_signature(raw_body, signature)
    except E2BWebhookSignatureError as exc:
        code, status_code = _E2B_WEBHOOK_ERROR_RESPONSE[exc.reason]
        raise CloudApiError(
            code,
            exc.message,
            status_code=status_code,
        ) from exc


def _metadata_sandbox_id(metadata: dict[str, str]) -> UUID | None:
    value = metadata.get("cloud_sandbox_id")
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


async def remember_sandbox_event_receipt(
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await remember_cloud_sandbox_event_receipt(
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def open_usage_segment_for_sandbox(
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
    return await record_cloud_sandbox_usage_started(
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


async def close_usage_segment_for_sandbox(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> object | None:
    return await record_cloud_sandbox_usage_stopped(
        sandbox_id=sandbox_id,
        ended_at=ended_at,
        closed_by=closed_by,
        is_billable=is_billable,
        event_id=event_id,
    )


async def handle_e2b_webhook(
    db: AsyncSession,
    *,
    payload: bytes,
    signature: str | None,
) -> E2BWebhookReceipt:
    _verify_e2b_signature(payload, signature)
    event = E2BWebhookEvent.model_validate_json(payload)
    event_kind = _provider_event_kind(event.type)
    if event_kind is None:
        return E2BWebhookReceipt()

    if not await remember_sandbox_event_receipt(
        event_id=event.id,
        provider="e2b",
        event_type=event.type,
        external_sandbox_id=event.sandbox_id,
    ):
        return E2BWebhookReceipt()

    metadata = event.event_data.sandbox_metadata
    sandbox = None
    if event.sandbox_id:
        sandbox = await load_cloud_sandbox_by_external_id(db, event.sandbox_id)
    if sandbox is None:
        metadata_sandbox_id = _metadata_sandbox_id(metadata)
        if metadata_sandbox_id is not None:
            sandbox = await load_cloud_sandbox_by_id(db, metadata_sandbox_id)
    if sandbox is None:
        return E2BWebhookReceipt()

    if _is_stale_provider_event(
        last_event_at=sandbox.last_provider_event_at,
        last_event_kind=sandbox.last_provider_event_kind,
        incoming_event_at=event.timestamp,
        incoming_event_kind=event_kind,
    ):
        return E2BWebhookReceipt()

    runtime_environment = (
        await load_runtime_environment_by_id(db, sandbox.runtime_environment_id)
        if sandbox.runtime_environment_id is not None
        else None
    )
    workspace = (
        await load_cloud_workspace_by_id(db, sandbox.cloud_workspace_id)
        if sandbox.cloud_workspace_id is not None
        else None
    )
    if runtime_environment is None and workspace is None:
        return E2BWebhookReceipt()

    await save_sandbox_provider_state(
        db,
        sandbox.id,
        external_sandbox_id=event.sandbox_id if event.sandbox_id else sandbox.external_sandbox_id,
        last_provider_event_at=event.timestamp,
        last_provider_event_kind=event_kind,
    )

    if event_kind in {PROVIDER_EVENT_KIND_CREATED, PROVIDER_EVENT_KIND_RESUMED}:
        billing_subject_id = (
            runtime_environment.billing_subject_id
            if runtime_environment is not None
            else workspace.billing_subject_id
        )
        billing = await get_billing_snapshot_for_subject(billing_subject_id)
        if billing.billing_mode == BILLING_MODE_ENFORCE and billing.active_spend_hold:
            if event.sandbox_id:
                provider = get_sandbox_provider(sandbox.provider)
                await provider.pause_sandbox(event.sandbox_id)
            await close_usage_segment_for_sandbox(
                sandbox_id=sandbox.id,
                ended_at=event.timestamp,
                closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
                event_id=event.id,
            )
            await save_sandbox_provider_state(
                db,
                sandbox.id,
                status="paused",
                stopped_at=event.timestamp,
                last_provider_event_at=event.timestamp,
                last_provider_event_kind=PROVIDER_EVENT_KIND_PAUSED,
            )
            if runtime_environment is not None:
                await save_runtime_environment_state(
                    db,
                    runtime_environment.id,
                    **runtime_provider_paused_update(),
                )
            return E2BWebhookReceipt()

        user_id = (
            runtime_environment.user_id if runtime_environment is not None else workspace.user_id
        )
        runtime_environment_id = (
            runtime_environment.id if runtime_environment is not None else None
        )
        await open_usage_segment_for_sandbox(
            user_id=user_id,
            runtime_environment_id=runtime_environment_id,
            workspace_id=workspace.id if workspace is not None else None,
            sandbox_id=sandbox.id,
            external_sandbox_id=event.sandbox_id or sandbox.external_sandbox_id,
            sandbox_execution_id=None,
            started_at=event.timestamp,
            opened_by=(
                USAGE_SEGMENT_OPENED_BY_PROVISION
                if event_kind == PROVIDER_EVENT_KIND_CREATED
                else USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED
            ),
            event_id=event.id,
        )
        await save_sandbox_provider_state(
            db,
            sandbox.id,
            status="running",
            started_at=event.timestamp,
            stopped_at=None,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        if runtime_environment is not None:
            await save_runtime_environment_state(
                db,
                runtime_environment.id,
                **runtime_provider_running_update(),
            )
        return E2BWebhookReceipt()

    if event_kind in {PROVIDER_EVENT_KIND_PAUSED, PROVIDER_EVENT_KIND_TIMEOUT}:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=(
                USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT
                if event_kind == PROVIDER_EVENT_KIND_TIMEOUT
                else USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED
            ),
            event_id=event.id,
        )
        await save_sandbox_provider_state(
            db,
            sandbox.id,
            status="paused",
            stopped_at=event.timestamp,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        if runtime_environment is not None:
            await save_runtime_environment_state(
                db,
                runtime_environment.id,
                **runtime_provider_paused_update(),
            )
        return E2BWebhookReceipt()

    if event_kind == PROVIDER_EVENT_KIND_KILLED:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
            event_id=event.id,
        )
        await save_sandbox_provider_state(
            db,
            sandbox.id,
            status="destroyed",
            stopped_at=event.timestamp,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        if runtime_environment is not None:
            await save_runtime_environment_state(
                db,
                runtime_environment.id,
                **runtime_provider_destroyed_update(),
            )
        return E2BWebhookReceipt()

    return E2BWebhookReceipt()
