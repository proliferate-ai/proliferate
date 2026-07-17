"""Durable, secret-safe CloudSandbox materialization failure receipts."""

from __future__ import annotations

from contextlib import suppress
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sandboxes import mark_cloud_sandbox_materialization_error
from proliferate.integrations.sandbox import (
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.integrations.sentry import report_critical

_CONFIGURATION_ERROR = "Sandbox provider configuration prevents materialization. Contact support."
PROVIDER_SANDBOX_MISSING_RECEIPT = (
    "The provider sandbox no longer exists. Retry to create a replacement."
)
_PROVIDER_UNAVAILABLE_ERROR = "The sandbox provider is temporarily unavailable. Retry later."
_RUNTIME_ERROR = "The sandbox runtime did not become ready. Retry later."
_UNKNOWN_ERROR = "Sandbox materialization failed. Retry later."


def materialization_error_receipt(exc: Exception) -> str:
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
    return _UNKNOWN_ERROR


async def persist_materialization_failure(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    expected_provider_sandbox_id: str | None,
    error: Exception,
) -> None:
    """Commit one failed attempt without ever masking its original exception."""

    try:
        await db.rollback()
        await mark_cloud_sandbox_materialization_error(
            db,
            sandbox_id,
            expected_provider_sandbox_id=expected_provider_sandbox_id,
            last_error=materialization_error_receipt(error),
        )
        await db.commit()
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
