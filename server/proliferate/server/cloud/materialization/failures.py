"""Durable, secret-safe CloudSandbox materialization failure receipts."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_RESUME,
)
from proliferate.db.store.billing_runtime_usage import UsageProviderBindingMismatchError
from proliferate.db.store.cloud_sandbox_recovery import (
    adopt_ambiguous_cloud_sandbox_provider_sandbox,
)
from proliferate.db.store.cloud_sandboxes import (
    mark_cloud_sandbox_materialization_error,
    supersede_missing_cloud_sandbox_provider,
)
from proliferate.integrations.sandbox import (
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.integrations.sentry import report_critical
from proliferate.server.billing.runtime_usage import (
    close_cloud_sandbox_provider_usage,
    open_cloud_sandbox_provider_usage,
)
from proliferate.utils.time import utcnow

_CONFIGURATION_ERROR = "Sandbox provider configuration prevents materialization. Contact support."
PROVIDER_SANDBOX_MISSING_RECEIPT = (
    "The provider sandbox no longer exists. Retry to create a replacement."
)
_PROVIDER_UNAVAILABLE_ERROR = "The sandbox provider is temporarily unavailable. Retry later."
_RUNTIME_ERROR = "The sandbox runtime did not become ready. Retry later."
_INTERRUPTED_ERROR = "Sandbox materialization was interrupted. Retry later."
_USAGE_BINDING_ERROR = (
    "Sandbox usage attribution conflicts with its provider binding. Contact support."
)
_UNKNOWN_ERROR = "Sandbox materialization failed. Retry later."


def materialization_error_receipt(exc: BaseException) -> str:
    """Return a stable receipt without copying provider output or credentials."""

    # Import lazily: sandbox_io.__init__ owns the connect export, and connect
    # itself uses this module while that package is being initialized.
    from proliferate.server.cloud.materialization.sandbox_io.target import (
        CloudMaterializationCommandError,
    )

    if isinstance(exc, SandboxProviderConfigurationError):
        return _CONFIGURATION_ERROR
    if isinstance(exc, SandboxProviderTargetUnavailableError):
        return PROVIDER_SANDBOX_MISSING_RECEIPT
    if isinstance(exc, SandboxProviderUnavailableError):
        return _PROVIDER_UNAVAILABLE_ERROR
    if isinstance(exc, CloudMaterializationCommandError):
        return _RUNTIME_ERROR
    if isinstance(exc, asyncio.CancelledError):
        return _INTERRUPTED_ERROR
    if isinstance(exc, UsageProviderBindingMismatchError):
        return _USAGE_BINDING_ERROR
    return _UNKNOWN_ERROR


async def persist_materialization_failure(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    expected_provider_sandbox_ids: tuple[str | None, ...],
    expected_materialization_attempt: int,
    error: BaseException,
    close_usage_if_provider_matches: str | None = None,
    ensure_usage_if_provider_matches: tuple[str, UUID, datetime] | None = None,
    adopt_provider_if_unbound: tuple[str, UUID, datetime, datetime] | None = None,
    detach_missing_provider: tuple[str, datetime, datetime] | None = None,
) -> tuple[bool, str | None]:
    """Commit one failed attempt without ever masking its original exception."""

    try:
        await db.rollback()
        if detach_missing_provider is not None:
            missing_provider_id, observation_started_at, ended_at = detach_missing_provider
            detached = await supersede_missing_cloud_sandbox_provider(
                db,
                sandbox_id,
                expected_provider_sandbox_id=missing_provider_id,
                expected_materialization_attempt=expected_materialization_attempt,
                observation_started_at=observation_started_at,
            )
            if detached is not None:
                await close_cloud_sandbox_provider_usage(
                    db,
                    sandbox_id=sandbox_id,
                    provider_sandbox_id=missing_provider_id,
                    ended_at=ended_at,
                    closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
                )
            # Whether the ambiguous commit was applied or this replay detached
            # the row, only the unbound state is ours to receipt. A replay miss
            # can instead mean newer same-attempt provider evidence won; never
            # fall through and overwrite that still-bound provider.
            expected_provider_sandbox_ids = (None,)
        updated = None
        provider_sandbox_id = None
        for provider_sandbox_id in expected_provider_sandbox_ids:
            if provider_sandbox_id is None and adopt_provider_if_unbound is not None:
                (
                    candidate_id,
                    owner_user_id,
                    started_at,
                    expected_provider_observed_at,
                ) = adopt_provider_if_unbound
                adopted = await adopt_ambiguous_cloud_sandbox_provider_sandbox(
                    db,
                    sandbox_id,
                    e2b_sandbox_id=candidate_id,
                    expected_materialization_attempt=expected_materialization_attempt,
                    expected_provider_observed_at=expected_provider_observed_at,
                )
                if not adopted:
                    continue
                await open_cloud_sandbox_provider_usage(
                    db,
                    sandbox_id=sandbox_id,
                    provider_sandbox_id=candidate_id,
                    user_id=owner_user_id,
                    started_at=started_at,
                    opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
                    event_id=f"provider-candidate-adopt:{sandbox_id}:{candidate_id}",
                )
                provider_sandbox_id = candidate_id
            updated = await mark_cloud_sandbox_materialization_error(
                db,
                sandbox_id,
                expected_provider_sandbox_id=provider_sandbox_id,
                expected_materialization_attempt=expected_materialization_attempt,
                last_error=materialization_error_receipt(error),
            )
            if updated is not None:
                if (
                    close_usage_if_provider_matches is not None
                    and provider_sandbox_id == close_usage_if_provider_matches
                ):
                    await close_cloud_sandbox_provider_usage(
                        db,
                        sandbox_id=sandbox_id,
                        provider_sandbox_id=close_usage_if_provider_matches,
                        ended_at=utcnow(),
                        closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
                    )
                if (
                    ensure_usage_if_provider_matches is not None
                    and provider_sandbox_id == ensure_usage_if_provider_matches[0]
                ):
                    provider_id, owner_user_id, started_at = ensure_usage_if_provider_matches
                    await open_cloud_sandbox_provider_usage(
                        db,
                        sandbox_id=sandbox_id,
                        provider_sandbox_id=provider_id,
                        user_id=owner_user_id,
                        started_at=started_at,
                        opened_by=USAGE_SEGMENT_OPENED_BY_RESUME,
                        event_id=f"provider-resume-failure-start:{sandbox_id}:{provider_id}",
                    )
                break
        await db.commit()
        return updated is not None, provider_sandbox_id if updated is not None else None
    except Exception as persistence_error:  # noqa: BLE001 - preserve original failure.
        with suppress(Exception):
            await db.rollback()
        report_critical(
            persistence_error,
            tags={
                "domain": "cloud_materialization_failure_persistence",
                "cloud_sandbox_id": str(sandbox_id),
            },
        )
        return False, None
