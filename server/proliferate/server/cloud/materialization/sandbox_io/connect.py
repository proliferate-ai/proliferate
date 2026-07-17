"""Connect to, wake, and launch the AnyHarness process inside a CloudSandbox."""

from __future__ import annotations

import asyncio
import logging
import secrets
from contextlib import suppress
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_RESUME,
)
from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store.billing_runtime_usage import UsageProviderBindingMismatchError
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
    get_sandbox_provider,
)
from proliferate.server.billing.authorization import assert_cloud_sandbox_resume_allowed
from proliferate.server.billing.runtime_usage import (
    converge_cloud_sandbox_provider_usage,
    open_cloud_sandbox_provider_usage,
)
from proliferate.server.cloud.materialization.failures import persist_materialization_failure
from proliferate.server.cloud.materialization.sandbox_io.resume_acceptance import (
    ProviderInactiveAfterResume,
    ProviderMissingAfterResume,
    accept_resumed_provider,
    detach_missing_provider,
)
from proliferate.server.cloud.materialization.sandbox_io.runtime_launch import (
    launch_anyharness_runtime as _launch_anyharness_runtime,
)
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
    SandboxIOTarget,
)
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.liveness_health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.materialization.connect")


class _ProviderResumeObservedActiveError(RuntimeError):
    """Resume was ambiguous, but an exact-ID observation proved active usage."""

    def __init__(self, original_error: BaseException) -> None:
        super().__init__("Provider resume was active but its handle was unavailable.")
        self.original_error = original_error


def _runtime_token(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_bearer_token_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_bearer_token_ciphertext)


def _runtime_data_key(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_data_key_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_data_key_ciphertext)


async def _destroy_unrecorded_candidate(
    provider: SandboxProvider,
    *,
    sandbox_id: UUID,
    provider_sandbox_id: str,
) -> None:
    try:
        await provider.destroy_sandbox(provider_sandbox_id)
    except Exception:
        logger.exception(
            "failed to destroy unrecorded provider sandbox",
            extra={
                "cloud_sandbox_id": str(sandbox_id),
                "e2b_sandbox_id": provider_sandbox_id,
            },
        )


async def _create_provider_sandbox(
    provider: SandboxProvider,
    *,
    sandbox_id: UUID,
    owner_user_id: UUID,
) -> object:
    create_task = asyncio.create_task(
        provider.create_sandbox(
            metadata={
                "cloud_sandbox_id": str(sandbox_id),
                "proliferate_cloud_sandbox_id": str(sandbox_id),
                "proliferate_owner_user_id": str(owner_user_id),
            }
        )
    )
    try:
        return await asyncio.shield(create_task)
    except asyncio.CancelledError:
        try:
            candidate = await create_task
        except Exception:
            pass
        else:
            await _destroy_unrecorded_candidate(
                provider,
                sandbox_id=sandbox_id,
                provider_sandbox_id=candidate.sandbox_id,
            )
        raise


async def _resume_provider_sandbox(
    provider: SandboxProvider,
    provider_sandbox_id: str,
) -> tuple[object, asyncio.CancelledError | None]:
    """Resolve an ambiguous cancellation after provider resume exactly once."""

    async def _recover_ambiguous_resume(
        original_error: BaseException,
    ) -> object:
        try:
            state = await provider.get_sandbox_state(provider_sandbox_id)
        except SandboxProviderTargetUnavailableError:
            raise
        except Exception:
            raise original_error from None
        if state is None or state.state not in {"running", "ready"}:
            raise original_error
        try:
            return await provider.connect_running_sandbox(provider_sandbox_id)
        except SandboxProviderTargetUnavailableError:
            raise
        except Exception as reconnect_error:
            raise _ProviderResumeObservedActiveError(original_error) from reconnect_error

    resume_task = asyncio.create_task(provider.resume_sandbox(provider_sandbox_id))
    try:
        return await asyncio.shield(resume_task), None
    except asyncio.CancelledError as interrupted:
        try:
            provider_sandbox = await resume_task
        except SandboxProviderTargetUnavailableError:
            raise
        except SandboxProviderUnavailableError:
            provider_sandbox = await _recover_ambiguous_resume(interrupted)
        except BaseException:
            raise interrupted from None
        return provider_sandbox, interrupted
    except SandboxProviderUnavailableError as resume_error:
        return await _recover_ambiguous_resume(resume_error), None


async def connect_ready_sandbox(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
) -> SandboxIOTarget:
    if sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise CloudMaterializationCommandError("Cloud sandbox has been destroyed.")

    # Enforced billing holds must not be resumed by an incoming request.
    await assert_cloud_sandbox_resume_allowed(db, sandbox)
    # End the billing/read phase before provider or runtime I/O.
    await db.commit()

    retried = await cloud_sandboxes_store.begin_cloud_sandbox_materialization_retry(
        db,
        sandbox.id,
    )
    if retried is None:
        raise CloudMaterializationCommandError("Cloud sandbox was destroyed while connecting.")
    sandbox = retried
    provider_sandbox_id = sandbox.e2b_sandbox_id
    failure_expected_provider_sandbox_ids = (provider_sandbox_id,)
    failure_expected_materialization_attempt = sandbox.materialization_attempt
    failure_close_usage_provider_sandbox_id: str | None = None
    failure_ensure_usage: tuple[str, UUID, datetime] | None = None
    failure_error_override: BaseException | None = None
    failure_detach_missing_provider: tuple[str, datetime, datetime] | None = None
    ambiguous_candidate_provider_sandbox_id: str | None = None
    ambiguous_candidate_usage_started_at: datetime | None = None
    accepted_resume_started_at: datetime | None = None
    provider: SandboxProvider | None = None

    async def _persist_failure(error: BaseException) -> None:
        matched, matched_provider_sandbox_id = await persist_materialization_failure(
            db,
            sandbox_id=sandbox.id,
            expected_provider_sandbox_ids=failure_expected_provider_sandbox_ids,
            expected_materialization_attempt=failure_expected_materialization_attempt,
            error=failure_error_override or error,
            close_usage_if_provider_matches=failure_close_usage_provider_sandbox_id,
            ensure_usage_if_provider_matches=failure_ensure_usage,
            adopt_provider_if_unbound=(
                (
                    ambiguous_candidate_provider_sandbox_id,
                    sandbox.owner_user_id,
                    ambiguous_candidate_usage_started_at,
                    sandbox.provider_observed_at,
                )
                if ambiguous_candidate_provider_sandbox_id is not None
                and ambiguous_candidate_usage_started_at is not None
                and provider is not None
                and sandbox.owner_user_id is not None
                else None
            ),
            detach_missing_provider=failure_detach_missing_provider,
        )
        if ambiguous_candidate_provider_sandbox_id is None or provider is None:
            return
        should_destroy_candidate = matched and matched_provider_sandbox_id is None
        if not matched:
            try:
                await db.rollback()
                current = await cloud_sandboxes_store.load_cloud_sandbox_by_id(
                    db,
                    sandbox.id,
                    refresh=True,
                )
                should_destroy_candidate = (
                    current is None
                    or current.e2b_sandbox_id != ambiguous_candidate_provider_sandbox_id
                )
                await db.commit()
            except Exception:
                with suppress(Exception):
                    await db.rollback()
                logger.exception(
                    "failed to resolve ambiguous provider binding after materialization error",
                    extra={"cloud_sandbox_id": str(sandbox.id)},
                )
                should_destroy_candidate = False
        if should_destroy_candidate:
            await _destroy_unrecorded_candidate(
                provider,
                sandbox_id=sandbox.id,
                provider_sandbox_id=ambiguous_candidate_provider_sandbox_id,
            )

    try:
        # Converge null legacy usage cloud-row-first. Concrete conflicts fail
        # closed before provider I/O because their provider may still be live.
        try:
            await converge_cloud_sandbox_provider_usage(
                db,
                sandbox_id=sandbox.id,
                current_provider_sandbox_id=sandbox.e2b_sandbox_id,
                observed_at=utcnow(),
            )
        except UsageProviderBindingMismatchError as mismatch_error:
            # Retain the epoch for the exact-attempt support receipt.
            failure_error_override = mismatch_error
            await db.commit()
            raise
        await db.commit()

        owner_user_id = sandbox.owner_user_id
        if owner_user_id is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox has no owner for provider usage attribution."
            )
        provider = get_sandbox_provider(sandbox.e2b_template_ref)
        provider_sandbox: object | None = None
        if provider_sandbox_id is not None:
            resume_started_at = utcnow()
            try:
                provider_sandbox, resume_interrupted = await _resume_provider_sandbox(
                    provider,
                    provider_sandbox_id,
                )
            except _ProviderResumeObservedActiveError as active_error:
                failure_ensure_usage = (
                    provider_sandbox_id,
                    owner_user_id,
                    resume_started_at,
                )
                raise active_error.original_error from active_error
            except SandboxProviderTargetUnavailableError as missing_error:
                failure_error_override = missing_error
                failure_close_usage_provider_sandbox_id = provider_sandbox_id
                missing_ended_at = utcnow()
                refreshed = await detach_missing_provider(
                    db,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=provider_sandbox_id,
                    materialization_attempt=failure_expected_materialization_attempt,
                    observation_started_at=resume_started_at,
                    ended_at=missing_ended_at,
                )
                if refreshed is None:
                    failure_expected_provider_sandbox_ids = ()
                    failure_close_usage_provider_sandbox_id = None
                    failure_error_override = None
                    raise CloudMaterializationCommandError(
                        "Cloud sandbox provider binding changed while recovering."
                    ) from missing_error
                failure_detach_missing_provider = (
                    provider_sandbox_id,
                    resume_started_at,
                    missing_ended_at,
                )
                sandbox = refreshed
                provider_sandbox_id = None
                # Commit absence and exact usage before allocating a replacement.
                failure_expected_provider_sandbox_ids = (
                    None,
                    failure_expected_provider_sandbox_ids[0],
                )
                await db.commit()
                failure_expected_provider_sandbox_ids = (None,)
                failure_close_usage_provider_sandbox_id = None
                failure_error_override = None
                failure_detach_missing_provider = None
            else:
                accepted_resume_started_at = resume_started_at
                failure_ensure_usage = (
                    provider_sandbox_id,
                    owner_user_id,
                    utcnow(),
                )
                if resume_interrupted is not None:
                    raise resume_interrupted

        if provider_sandbox_id is None:
            handle = await _create_provider_sandbox(
                provider,
                sandbox_id=sandbox.id,
                owner_user_id=owner_user_id,
            )
            candidate_provider_sandbox_id = handle.sandbox_id
            candidate_usage_started_at = utcnow()
            try:
                refreshed = await cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox(
                    db,
                    sandbox.id,
                    e2b_sandbox_id=candidate_provider_sandbox_id,
                    e2b_template_ref=provider.template_version,
                    expected_materialization_attempt=failure_expected_materialization_attempt,
                )
                if refreshed is None:
                    failure_expected_provider_sandbox_ids = ()
                    failure_close_usage_provider_sandbox_id = None
                    failure_error_override = None
                    raise CloudMaterializationCommandError(
                        "Cloud sandbox changed while provisioning."
                    )
                await open_cloud_sandbox_provider_usage(
                    db,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=candidate_provider_sandbox_id,
                    user_id=owner_user_id,
                    started_at=candidate_usage_started_at,
                    opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
                    event_id=(
                        f"provider-binding-start:{sandbox.id}:{candidate_provider_sandbox_id}"
                    ),
                )
            except BaseException:
                # Roll back staged writes and destroy only the unbound candidate.
                await db.rollback()
                await _destroy_unrecorded_candidate(
                    provider,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=candidate_provider_sandbox_id,
                )
                raise
            # After this ambiguous commit boundary, failure persistence adopts
            # either the candidate or the prior absent binding under this epoch.
            failure_expected_provider_sandbox_ids = (candidate_provider_sandbox_id, None)
            ambiguous_candidate_provider_sandbox_id = candidate_provider_sandbox_id
            ambiguous_candidate_usage_started_at = candidate_usage_started_at
            await db.commit()
            ambiguous_candidate_provider_sandbox_id = None
            ambiguous_candidate_usage_started_at = None
            sandbox = refreshed
            provider_sandbox_id = candidate_provider_sandbox_id
            failure_expected_provider_sandbox_ids = (provider_sandbox_id,)
            candidate_resume_started_at = utcnow()
            try:
                provider_sandbox, resume_interrupted = await _resume_provider_sandbox(
                    provider,
                    provider_sandbox_id,
                )
            except _ProviderResumeObservedActiveError as active_error:
                failure_ensure_usage = (
                    provider_sandbox_id,
                    owner_user_id,
                    candidate_resume_started_at,
                )
                raise active_error.original_error from active_error
            except SandboxProviderTargetUnavailableError as missing_error:
                failure_error_override = missing_error
                failure_close_usage_provider_sandbox_id = provider_sandbox_id
                missing_ended_at = utcnow()
                refreshed = await detach_missing_provider(
                    db,
                    sandbox_id=sandbox.id,
                    provider_sandbox_id=provider_sandbox_id,
                    materialization_attempt=failure_expected_materialization_attempt,
                    observation_started_at=candidate_resume_started_at,
                    ended_at=missing_ended_at,
                )
                if refreshed is None:
                    failure_expected_provider_sandbox_ids = ()
                    failure_close_usage_provider_sandbox_id = None
                    failure_error_override = None
                    raise CloudMaterializationCommandError(
                        "Cloud sandbox provider binding changed while recovering."
                    ) from missing_error
                failure_detach_missing_provider = (
                    provider_sandbox_id,
                    candidate_resume_started_at,
                    missing_ended_at,
                )
                sandbox = refreshed
                failure_expected_provider_sandbox_ids = (None, provider_sandbox_id)
                provider_sandbox_id = None
                await db.commit()
                failure_expected_provider_sandbox_ids = (None,)
                failure_close_usage_provider_sandbox_id = None
                raise CloudMaterializationCommandError(
                    "New provider sandbox disappeared before materialization."
                ) from missing_error
            else:
                accepted_resume_started_at = candidate_resume_started_at
                failure_ensure_usage = (
                    provider_sandbox_id,
                    owner_user_id,
                    utcnow(),
                )
                if resume_interrupted is not None:
                    raise resume_interrupted

        if (
            provider_sandbox is None
            or provider_sandbox_id is None
            or accepted_resume_started_at is None
        ):
            raise CloudMaterializationCommandError(
                "Cloud sandbox provider did not return a running sandbox."
            )

        # Resolve overlapping provider evidence, then ensure exact resume usage.
        try:
            active = await accept_resumed_provider(
                db,
                provider=provider,
                sandbox_id=sandbox.id,
                provider_sandbox_id=provider_sandbox_id,
                materialization_attempt=failure_expected_materialization_attempt,
                resume_started_at=accepted_resume_started_at,
            )
        except ProviderInactiveAfterResume as inactive_error:
            failure_ensure_usage = None
            failure_close_usage_provider_sandbox_id = provider_sandbox_id
            if inactive_error.commit_error is not None:
                raise inactive_error.commit_error from inactive_error
            raise CloudMaterializationCommandError(
                "Cloud sandbox provider remained inactive after resume."
            ) from inactive_error
        except ProviderMissingAfterResume as missing_error:
            refreshed = await detach_missing_provider(
                db,
                sandbox_id=sandbox.id,
                provider_sandbox_id=provider_sandbox_id,
                materialization_attempt=failure_expected_materialization_attempt,
                observation_started_at=missing_error.observation_started_at,
                ended_at=missing_error.ended_at,
            )
            if refreshed is None:
                failure_expected_provider_sandbox_ids = ()
                raise CloudMaterializationCommandError(
                    "Cloud sandbox provider binding changed while recovering."
                ) from missing_error
            sandbox = refreshed
            failure_expected_provider_sandbox_ids = (None, provider_sandbox_id)
            failure_error_override = missing_error
            failure_close_usage_provider_sandbox_id = provider_sandbox_id
            failure_ensure_usage = None
            failure_detach_missing_provider = (
                provider_sandbox_id,
                missing_error.observation_started_at,
                missing_error.ended_at,
            )
            provider_sandbox_id = None
            await db.commit()
            failure_expected_provider_sandbox_ids = (None,)
            failure_close_usage_provider_sandbox_id = None
            raise
        if active is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox changed while resuming its provider."
            )
        sandbox = active
        await open_cloud_sandbox_provider_usage(
            db,
            sandbox_id=sandbox.id,
            provider_sandbox_id=provider_sandbox_id,
            user_id=owner_user_id,
            started_at=utcnow(),
            opened_by=USAGE_SEGMENT_OPENED_BY_RESUME,
            event_id=f"provider-resume-start:{sandbox.id}:{provider_sandbox_id}",
        )
        await db.commit()

        endpoint = await provider.resolve_runtime_endpoint(provider_sandbox)
        runtime_context = await provider.resolve_runtime_context(provider_sandbox)
        runtime_token = _runtime_token(sandbox)
        data_key = _runtime_data_key(sandbox)

        if runtime_token is not None and data_key is not None:
            try:
                await wait_for_runtime_health(
                    endpoint.runtime_url,
                    workspace_id=sandbox.id,
                    total_attempts=4,
                    delay_seconds=0.5,
                )
                await verify_runtime_auth_enforced(
                    endpoint.runtime_url,
                    runtime_token,
                    workspace_id=sandbox.id,
                )
            except Exception:
                await _launch_anyharness_runtime(
                    db,
                    provider=provider,
                    provider_sandbox=provider_sandbox,
                    provider_sandbox_id=provider_sandbox_id,
                    sandbox_record=sandbox,
                    endpoint=endpoint,
                    runtime_context=runtime_context,
                    runtime_token=runtime_token,
                    anyharness_data_key=data_key,
                )
        else:
            runtime_token = secrets.token_urlsafe(32)
            data_key = generate_anyharness_data_key()
            await _launch_anyharness_runtime(
                db,
                provider=provider,
                provider_sandbox=provider_sandbox,
                provider_sandbox_id=provider_sandbox_id,
                sandbox_record=sandbox,
                endpoint=endpoint,
                runtime_context=runtime_context,
                runtime_token=runtime_token,
                anyharness_data_key=data_key,
            )

        # Always finish the attempt with an exact-binding CAS. This clears a
        # previous receipt even when the runtime URL and credentials were reused.
        ready = await cloud_sandboxes_store.mark_cloud_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=provider_sandbox_id,
            e2b_template_ref=provider.template_version,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=(
                sandbox.anyharness_bearer_token_ciphertext or encrypt_text(runtime_token)
            ),
            anyharness_data_key_ciphertext=(
                sandbox.anyharness_data_key_ciphertext or encrypt_text(data_key)
            ),
            expected_materialization_attempt=failure_expected_materialization_attempt,
        )
        if ready is None:
            raise CloudMaterializationCommandError(
                "Cloud sandbox provider binding changed while connecting."
            )
        await db.commit()

        return SandboxIOTarget(
            provider=provider,
            sandbox=provider_sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
        )
    except asyncio.CancelledError as exc:
        await _persist_failure(exc)
        raise
    except Exception as exc:
        await _persist_failure(exc)
        raise
