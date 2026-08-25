from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
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
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store.cloud_sandboxes import (
    accept_destroyed_cloud_sandbox_provider_observation,
    apply_cloud_sandbox_provider_observation,
    load_cloud_sandbox_by_id,
    load_cloud_sandbox_by_provider_sandbox_id,
    mark_cloud_sandbox_provider_missing,
)
from proliferate.integrations.sandbox import (
    E2BWebhookSignatureError,
    get_sandbox_provider,
    verify_e2b_webhook_signature,
)
from proliferate.lib.infra.time.wall_clock import utcnow
from proliferate.server.api_errors import CloudApiError
from proliferate.server.billing.authorization import (
    record_cloud_sandbox_billing_block,
    resolve_cloud_sandbox_billing_block,
)
from proliferate.server.billing.runtime_usage import (
    close_cloud_sandbox_provider_usage,
    converge_cloud_sandbox_provider_usage,
    open_cloud_sandbox_provider_usage,
    remember_cloud_sandbox_event_receipt,
)
from proliferate.server.cloud.gateway.service import (
    invalidate_cloud_sandbox_gateway_access_for_user,
)
from proliferate.server.cloud.materialization import locks
from proliferate.server.cloud.materialization.failures import (
    PROVIDER_SANDBOX_MISSING_RECEIPT,
)
from proliferate.server.cloud.runtime.domain.provider_events import (
    provider_event_kind as _provider_event_kind,
)
from proliferate.server.cloud.webhooks.models import E2BWebhookEvent, E2BWebhookReceipt
from proliferate.server.cloud.webhooks.transactions import commit_webhook_phase

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
    value = metadata.get("cloud_sandbox_id") or metadata.get("proliferate_cloud_sandbox_id")
    if not value:
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _should_ignore_sandbox_event(
    *,
    sandbox_status: str,
    sandbox_destroyed_at: datetime | None,
    sandbox_provider_observed_at: datetime | None,
    event_kind: str,
    event_timestamp: datetime,
) -> bool:
    destroyed_usage_terminal_events = {
        PROVIDER_EVENT_KIND_KILLED,
        PROVIDER_EVENT_KIND_PAUSED,
        PROVIDER_EVENT_KIND_TIMEOUT,
    }
    if (
        sandbox_destroyed_at is not None or sandbox_status == "destroyed"
    ) and event_kind not in destroyed_usage_terminal_events:
        return True
    if (
        sandbox_provider_observed_at is not None
        and event_timestamp <= sandbox_provider_observed_at
    ):
        return True
    if event_kind not in {PROVIDER_EVENT_KIND_CREATED, PROVIDER_EVENT_KIND_RESUMED}:
        return False
    return sandbox_status == "error"


async def remember_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await remember_cloud_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def open_usage_segment_for_sandbox(
    db: AsyncSession,
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
    del runtime_environment_id, workspace_id, sandbox_execution_id, is_billable
    if user_id is None or external_sandbox_id is None:
        raise RuntimeError("Provider usage requires an owner and exact provider id.")
    await converge_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        current_provider_sandbox_id=external_sandbox_id,
        observed_at=started_at,
    )
    return await open_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        provider_sandbox_id=external_sandbox_id,
        started_at=started_at,
        opened_by=opened_by,
        user_id=user_id,
        event_id=event_id or f"provider-webhook-start:{sandbox_id}:{external_sandbox_id}",
    )


async def close_usage_segment_for_sandbox(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
    expected_external_sandbox_id: str | None = None,
) -> object | None:
    del is_billable
    if expected_external_sandbox_id is None:
        raise RuntimeError("Provider usage close requires an exact provider id.")
    await converge_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        current_provider_sandbox_id=expected_external_sandbox_id,
        observed_at=ended_at,
    )
    return await close_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        provider_sandbox_id=expected_external_sandbox_id,
        ended_at=ended_at,
        closed_by=closed_by,
        event_id=event_id,
        fail_on_provider_mismatch=True,
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

    metadata = event.event_data.sandbox_metadata
    sandbox = None
    if event.sandbox_id:
        sandbox = await load_cloud_sandbox_by_provider_sandbox_id(db, event.sandbox_id)
    if sandbox is None:
        metadata_sandbox_id = _metadata_sandbox_id(metadata)
        if metadata_sandbox_id is not None:
            sandbox = await load_cloud_sandbox_by_id(db, metadata_sandbox_id)
    if sandbox is None:
        return E2BWebhookReceipt()
    if sandbox.owner_user_id is None:
        return E2BWebhookReceipt()
    # Metadata is correlation only, never authority to adopt or mutate a
    # provider. Late events from a superseded binding are inert.
    if event.sandbox_id is None or sandbox.e2b_sandbox_id != event.sandbox_id:
        return E2BWebhookReceipt()

    if _should_ignore_sandbox_event(
        sandbox_status=sandbox.status,
        sandbox_destroyed_at=sandbox.destroyed_at,
        sandbox_provider_observed_at=sandbox.provider_observed_at,
        event_kind=event_kind,
        event_timestamp=event.timestamp,
    ):
        await remember_sandbox_event_receipt(
            db,
            event_id=event.id,
            provider="e2b",
            event_type=event.type,
            external_sandbox_id=event.sandbox_id,
        )
        return E2BWebhookReceipt()

    if event_kind in {PROVIDER_EVENT_KIND_CREATED, PROVIDER_EVENT_KIND_RESUMED}:
        # Corridor N2: a held/over-limit subject cannot CONTINUE. Reuse the
        # resume gate's decision so this stray wake is judged exactly like an
        # inbound resume request — the subject that PAYS (an org member bills the
        # org subject, matching segment attribution) on an active spend hold OR
        # over an enabled compute budget cap. Enforce-mode only; the helper
        # returns ``None`` outside ``CLOUD_BILLING_MODE=enforce``. It reads in
        # this session (unlike the old private-session snapshot call), which the
        # ``commit_webhook_phase`` below releases along with correlation.
        #
        # Law N6 also applies here, and deliberately so: if the resolver cannot
        # READ billing state it raises ``BillingStateUnavailableError`` (after its
        # own alert + receipt) and we let it propagate. The global handler renders
        # that as a 503, which E2B treats as a delivery failure and RETRIES — the
        # event receipt has not been claimed yet, so the retry re-runs this gate
        # with a healthy read. Swallowing it instead would mark the event
        # processed and leave over-limit compute running until the next
        # reconciler pass, which is exactly the fail-open this corridor forbids.
        billing_block = await resolve_cloud_sandbox_billing_block(
            db,
            owner_user_id=sandbox.owner_user_id,
        )
        if billing_block is not None:
            # Do not commit a processed receipt before the provider side effect.
            # Release the correlation/billing transaction before waiting on the
            # materialization lease, then release the fresh read transaction
            # before pausing E2B. A crash after pause remains safely retryable.
            await commit_webhook_phase(db)
            async with locks.redis_materialization_lock(f"cloud-sandbox:{sandbox.id}"):
                current = await load_cloud_sandbox_by_id(db, sandbox.id, refresh=True)
                if (
                    current is None
                    or current.destroyed_at is not None
                    or current.e2b_sandbox_id != event.sandbox_id
                    or current.materialization_attempt != sandbox.materialization_attempt
                    or event.timestamp <= current.provider_observed_at
                ):
                    await remember_sandbox_event_receipt(
                        db,
                        event_id=event.id,
                        provider="e2b",
                        event_type=event.type,
                        external_sandbox_id=event.sandbox_id,
                    )
                    await commit_webhook_phase(db)
                    return E2BWebhookReceipt()
                materialization_attempt = current.materialization_attempt
                await commit_webhook_phase(db)
                provider = get_sandbox_provider("e2b")
                await provider.pause_sandbox(event.sandbox_id)
                pause_observed_at = utcnow()
                if not await remember_sandbox_event_receipt(
                    db,
                    event_id=event.id,
                    provider="e2b",
                    event_type=event.type,
                    external_sandbox_id=event.sandbox_id,
                ):
                    await commit_webhook_phase(db)
                    return E2BWebhookReceipt()
                # Audit the enforcement once the event receipt is claimed, so a
                # redelivery cannot double-record. Same decision_type vocabulary
                # the reconciler uses for quota enforcement
                # (``enforce_active_spend``/``user_limit_pause``/``org_limit_pause``),
                # and this is a pause of running compute, not a refused start.
                await record_cloud_sandbox_billing_block(
                    db,
                    billing_block,
                    actor_user_id=sandbox.owner_user_id,
                    would_block_start=billing_block.start_blocked,
                    would_pause_active=True,
                )
                updated = await apply_cloud_sandbox_provider_observation(
                    db,
                    current.id,
                    status="paused",
                    expected_provider_sandbox_id=event.sandbox_id,
                    expected_materialization_attempt=materialization_attempt,
                    observed_at=pause_observed_at,
                )
                if updated is not None:
                    await close_usage_segment_for_sandbox(
                        db,
                        sandbox_id=current.id,
                        ended_at=pause_observed_at,
                        closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
                        event_id=event.id,
                        expected_external_sandbox_id=event.sandbox_id,
                    )
                await commit_webhook_phase(db)
            return E2BWebhookReceipt()

        if not await remember_sandbox_event_receipt(
            db,
            event_id=event.id,
            provider="e2b",
            event_type=event.type,
            external_sandbox_id=event.sandbox_id,
        ):
            return E2BWebhookReceipt()
        updated = await apply_cloud_sandbox_provider_observation(
            db,
            sandbox.id,
            status="ready",
            expected_provider_sandbox_id=event.sandbox_id,
            expected_materialization_attempt=sandbox.materialization_attempt,
            observed_at=event.timestamp,
        )
        if updated is None:
            return E2BWebhookReceipt()
        await open_usage_segment_for_sandbox(
            db,
            user_id=sandbox.owner_user_id,
            sandbox_id=sandbox.id,
            external_sandbox_id=event.sandbox_id or sandbox.e2b_sandbox_id,
            sandbox_execution_id=None,
            started_at=event.timestamp,
            opened_by=(
                USAGE_SEGMENT_OPENED_BY_PROVISION
                if event_kind == PROVIDER_EVENT_KIND_CREATED
                else USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED
            ),
            event_id=event.id,
        )
        return E2BWebhookReceipt()

    if not await remember_sandbox_event_receipt(
        db,
        event_id=event.id,
        provider="e2b",
        event_type=event.type,
        external_sandbox_id=event.sandbox_id,
    ):
        return E2BWebhookReceipt()

    if event_kind in {PROVIDER_EVENT_KIND_PAUSED, PROVIDER_EVENT_KIND_TIMEOUT}:
        # A terminal materialization receipt remains authoritative until an
        # explicit retry. The provider stop still ends exact-ID billing, but a
        # late timeout/pause notification must not disguise the failed attempt.
        updated = await apply_cloud_sandbox_provider_observation(
            db,
            sandbox.id,
            status="paused",
            expected_provider_sandbox_id=event.sandbox_id,
            expected_materialization_attempt=sandbox.materialization_attempt,
            observed_at=event.timestamp,
        )
        if updated is None:
            updated = await accept_destroyed_cloud_sandbox_provider_observation(
                db,
                sandbox.id,
                expected_provider_sandbox_id=event.sandbox_id,
                expected_materialization_attempt=sandbox.materialization_attempt,
                observed_at=event.timestamp,
            )
            if updated is None:
                return E2BWebhookReceipt()
        await close_usage_segment_for_sandbox(
            db,
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=(
                USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT
                if event_kind == PROVIDER_EVENT_KIND_TIMEOUT
                else USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED
            ),
            event_id=event.id,
            expected_external_sandbox_id=event.sandbox_id,
        )
        return E2BWebhookReceipt()

    if event_kind == PROVIDER_EVENT_KIND_KILLED:
        updated = None
        if sandbox.destroyed_at is None:
            updated = await mark_cloud_sandbox_provider_missing(
                db,
                sandbox.id,
                expected_provider_sandbox_id=event.sandbox_id,
                expected_materialization_attempt=sandbox.materialization_attempt,
                observed_at=event.timestamp,
                last_error=PROVIDER_SANDBOX_MISSING_RECEIPT,
            )
            if updated is not None and updated.owner_user_id is not None:
                invalidate_cloud_sandbox_gateway_access_for_user(
                    updated.owner_user_id,
                )
        if updated is None:
            # Explicit deletion may have won after correlation. Preserve its
            # state while fencing this exact attempt's terminal observation.
            updated = await accept_destroyed_cloud_sandbox_provider_observation(
                db,
                sandbox.id,
                expected_provider_sandbox_id=event.sandbox_id,
                expected_materialization_attempt=sandbox.materialization_attempt,
                observed_at=event.timestamp,
            )
            if updated is None:
                return E2BWebhookReceipt()
        await cloud_workspace_store.mark_cloud_workspaces_lost_for_sandbox(
            db,
            updated,
        )
        await close_usage_segment_for_sandbox(
            db,
            sandbox_id=sandbox.id,
            ended_at=event.timestamp,
            closed_by=USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
            event_id=event.id,
            expected_external_sandbox_id=event.sandbox_id,
        )
        return E2BWebhookReceipt()

    return E2BWebhookReceipt()
