from __future__ import annotations

import base64
import hashlib
from datetime import datetime
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    PROVIDER_EVENT_KIND_CREATED,
    PROVIDER_EVENT_KIND_KILLED,
    PROVIDER_EVENT_KIND_PAUSED,
    PROVIDER_EVENT_KIND_PRECEDENCE,
    PROVIDER_EVENT_KIND_RESUMED,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED,
)
from proliferate.db.store.billing import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
    remember_sandbox_event_receipt,
)
from proliferate.db.store.cloud_workspaces import (
    load_cloud_sandbox_by_external_id,
    load_cloud_sandbox_by_id,
    load_cloud_workspace_by_id,
    persist_workspace_destroy_state,
    persist_workspace_stop_state,
    save_sandbox_provider_state,
)
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.billing.service import get_billing_snapshot_for_subject
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.webhooks.models import E2BWebhookEvent, E2BWebhookReceipt


def _verify_e2b_signature(raw_body: bytes, signature: str | None) -> None:
    secret = settings.e2b_webhook_signature_secret.strip()
    if not secret:
        raise CloudApiError(
            "webhook_unavailable",
            "E2B webhook verification is not configured.",
            status_code=503,
        )
    if not signature:
        raise CloudApiError(
            "invalid_webhook_signature",
            "E2B webhook signature is required.",
            status_code=401,
        )

    digest = hashlib.sha256(secret.encode("utf-8") + raw_body).digest()
    expected = base64.b64encode(digest).decode("utf-8").rstrip("=")
    legacy_expected = expected.replace("+", "-").replace("/", "_")
    if signature not in {expected, legacy_expected}:
        raise CloudApiError(
            "invalid_webhook_signature",
            "E2B webhook signature is invalid.",
            status_code=401,
        )


def _provider_event_kind(event_type: str) -> str | None:
    suffix = event_type.removeprefix("sandbox.lifecycle.")
    if suffix in PROVIDER_EVENT_KIND_PRECEDENCE:
        return suffix
    return None


def _is_stale_provider_event(
    *,
    last_event_at: datetime | None,
    last_event_kind: str | None,
    incoming_event_at: datetime,
    incoming_event_kind: str,
) -> bool:
    if last_event_at is None:
        return False
    if incoming_event_at < last_event_at:
        return True
    if incoming_event_at > last_event_at:
        return False
    return PROVIDER_EVENT_KIND_PRECEDENCE.get(
        incoming_event_kind, 0
    ) <= PROVIDER_EVENT_KIND_PRECEDENCE.get(last_event_kind or "", 0)


def _metadata_sandbox_id(metadata: dict[str, str]) -> UUID | None:
    value = metadata.get("cloud_sandbox_id")
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


async def handle_e2b_webhook(
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
        sandbox = await load_cloud_sandbox_by_external_id(event.sandbox_id)
    if sandbox is None:
        metadata_sandbox_id = _metadata_sandbox_id(metadata)
        if metadata_sandbox_id is not None:
            sandbox = await load_cloud_sandbox_by_id(metadata_sandbox_id)
    if sandbox is None:
        return E2BWebhookReceipt()

    if _is_stale_provider_event(
        last_event_at=sandbox.last_provider_event_at,
        last_event_kind=sandbox.last_provider_event_kind,
        incoming_event_at=event.timestamp,
        incoming_event_kind=event_kind,
    ):
        return E2BWebhookReceipt()

    workspace = await load_cloud_workspace_by_id(sandbox.cloud_workspace_id)
    if workspace is None:
        return E2BWebhookReceipt()

    await save_sandbox_provider_state(
        sandbox.id,
        external_sandbox_id=event.sandbox_id if event.sandbox_id else sandbox.external_sandbox_id,
        last_provider_event_at=event.timestamp,
        last_provider_event_kind=event_kind,
    )

    if event_kind in {PROVIDER_EVENT_KIND_CREATED, PROVIDER_EVENT_KIND_RESUMED}:
        billing = await get_billing_snapshot_for_subject(workspace.billing_subject_id)
        if billing.active_spend_hold:
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
                sandbox.id,
                status="paused",
                stopped_at=event.timestamp,
                last_provider_event_at=event.timestamp,
                last_provider_event_kind=PROVIDER_EVENT_KIND_PAUSED,
            )
            workspace.status = "stopped"
            workspace.status_detail = "Stopped"
            await persist_workspace_stop_state(workspace)
            return E2BWebhookReceipt()

        await open_usage_segment_for_sandbox(
            user_id=workspace.user_id,
            workspace_id=workspace.id,
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
            sandbox.id,
            status="running",
            started_at=event.timestamp,
            stopped_at=None,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        return E2BWebhookReceipt()

    if event_kind == PROVIDER_EVENT_KIND_PAUSED:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
            event_id=event.id,
        )
        await save_sandbox_provider_state(
            sandbox.id,
            status="paused",
            stopped_at=event.timestamp,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        workspace.status = "stopped"
        workspace.status_detail = "Stopped"
        await persist_workspace_stop_state(workspace)
        return E2BWebhookReceipt()

    if event_kind == PROVIDER_EVENT_KIND_KILLED:
        await close_usage_segment_for_sandbox(
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
            event_id=event.id,
        )
        await save_sandbox_provider_state(
            sandbox.id,
            status="destroyed",
            stopped_at=event.timestamp,
            last_provider_event_at=event.timestamp,
            last_provider_event_kind=event_kind,
        )
        workspace.status = "stopped"
        workspace.status_detail = "Stopped"
        await persist_workspace_destroy_state(workspace)
        return E2BWebhookReceipt()

    return E2BWebhookReceipt()
