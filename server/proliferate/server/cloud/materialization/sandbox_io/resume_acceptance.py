"""Order a successful provider resume against overlapping lifecycle evidence."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_CLOSED_BY_RECONCILER,
)
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxProviderTargetUnavailableError,
)
from proliferate.server.billing.runtime_usage import close_cloud_sandbox_provider_usage
from proliferate.utils.time import utcnow

_ACTIVE_STATES = {"ready", "running"}
_INACTIVE_STATES = {"paused", "stopped"}
_MISSING_STATES = {"destroyed", "killed", "terminated"}


class ProviderMissingAfterResume(SandboxProviderTargetUnavailableError):
    """An exact-ID post-resume observation proved the provider target absent."""

    def __init__(self, *, observation_started_at: datetime, ended_at: datetime) -> None:
        super().__init__("Provider target disappeared after resume.")
        self.observation_started_at = observation_started_at
        self.ended_at = ended_at


class ProviderInactiveAfterResume(RuntimeError):
    """A post-resume observation proved paused usage and owns its close."""

    def __init__(self, *, commit_error: BaseException | None = None) -> None:
        super().__init__("Provider remained inactive after resume.")
        self.commit_error = commit_error


async def detach_missing_provider(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    provider_sandbox_id: str,
    materialization_attempt: int,
    observation_started_at: datetime,
    ended_at: datetime,
) -> CloudSandboxValue | None:
    """Stage exact detach and usage closure for provider absence."""

    refreshed = await cloud_sandboxes_store.supersede_missing_cloud_sandbox_provider(
        db,
        sandbox_id,
        expected_provider_sandbox_id=provider_sandbox_id,
        expected_materialization_attempt=materialization_attempt,
        observation_started_at=observation_started_at,
    )
    if refreshed is None:
        return None
    await close_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        provider_sandbox_id=provider_sandbox_id,
        ended_at=ended_at,
        closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    )
    return refreshed


async def accept_resumed_provider(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    sandbox_id: UUID,
    provider_sandbox_id: str,
    materialization_attempt: int,
    resume_started_at: datetime,
) -> CloudSandboxValue | None:
    """Accept resume evidence, resolving only an exact overlapping pause."""

    accepted = await cloud_sandboxes_store.lock_cloud_sandbox_materialization_attempt(
        db,
        sandbox_id,
        expected_provider_sandbox_id=provider_sandbox_id,
        expected_materialization_attempt=materialization_attempt,
        observed_at=resume_started_at,
    )
    if accepted is not None:
        return accepted

    await db.rollback()
    current = await cloud_sandboxes_store.load_cloud_sandbox_by_id(
        db,
        sandbox_id,
        refresh=True,
    )
    if (
        current is None
        or current.e2b_sandbox_id != provider_sandbox_id
        or current.materialization_attempt != materialization_attempt
        or current.status not in {"creating", "paused", "ready"}
    ):
        return None
    # End the authoritative reload before the post-resume provider read.
    await db.commit()

    observation_started_at = utcnow()
    try:
        state = await provider.get_sandbox_state(provider_sandbox_id)
    except SandboxProviderTargetUnavailableError as missing_error:
        raise ProviderMissingAfterResume(
            observation_started_at=observation_started_at,
            ended_at=observation_started_at,
        ) from missing_error
    if state is None:
        return None
    if state.state in _ACTIVE_STATES:
        return await cloud_sandboxes_store.lock_cloud_sandbox_materialization_attempt(
            db,
            sandbox_id,
            expected_provider_sandbox_id=provider_sandbox_id,
            expected_materialization_attempt=materialization_attempt,
            observed_at=state.observed_at,
        )
    if state.state in _MISSING_STATES:
        raise ProviderMissingAfterResume(
            observation_started_at=state.observed_at,
            ended_at=state.end_at or state.observed_at,
        )
    if state.state not in _INACTIVE_STATES:
        return None

    paused = await cloud_sandboxes_store.apply_cloud_sandbox_provider_observation(
        db,
        sandbox_id,
        status="paused",
        expected_provider_sandbox_id=provider_sandbox_id,
        expected_materialization_attempt=materialization_attempt,
        observed_at=state.observed_at,
    )
    if paused is None:
        return None
    await close_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        provider_sandbox_id=provider_sandbox_id,
        ended_at=state.end_at or state.observed_at,
        closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
    )
    try:
        await db.commit()
    except BaseException as commit_error:
        raise ProviderInactiveAfterResume(commit_error=commit_error) from commit_error
    raise ProviderInactiveAfterResume()
