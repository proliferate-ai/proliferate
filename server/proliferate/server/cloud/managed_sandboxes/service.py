"""Managed cloud sandbox orchestration."""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.config import settings
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.managed_sandboxes import (
    ManagedSandboxValue,
    acquire_managed_sandbox_owner_lock,
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_destroyed,
    mark_managed_sandbox_ready,
    record_managed_sandbox_provider_sandbox,
    update_managed_sandbox_status,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxProviderError,
    get_configured_sandbox_provider,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
from proliferate.server.cloud.managed_sandboxes.transactions import (
    commit_managed_sandbox_session,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
    build_supervised_runtime_stop_command,
)
from proliferate.server.cloud.runtime.liveness.health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.provisioning.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow

_IN_FLIGHT_STATUSES = {"creating", "starting", "destroying"}
_STARTING_LEASE_SECONDS = 10 * 60
_WAIT_ATTEMPTS = 120
_WAIT_DELAY_SECONDS = 1.0


class _UserWithId(Protocol):
    id: UUID


@dataclass(frozen=True)
class _SandboxStartClaim:
    sandbox: ManagedSandboxValue
    action: Literal["start", "reuse", "wait"]


def _template_ref() -> str:
    value = settings.e2b_template_name.strip()
    if not value:
        raise CloudApiError(
            "e2b_template_required",
            "E2B_TEMPLATE_NAME is required before creating a managed cloud sandbox.",
            status_code=500,
        )
    return value


def _runtime_access_ready(sandbox: ManagedSandboxValue) -> bool:
    return bool(
        sandbox.e2b_sandbox_id
        and sandbox.anyharness_base_url
        and sandbox.anyharness_bearer_token_ciphertext
        and sandbox.anyharness_data_key_ciphertext
    )


def _in_flight_status_is_fresh(sandbox: ManagedSandboxValue) -> bool:
    if sandbox.status not in _IN_FLIGHT_STATUSES:
        return False
    return utcnow() - sandbox.updated_at < timedelta(seconds=_STARTING_LEASE_SECONDS)


async def _claim_managed_sandbox_start(
    db: AsyncSession,
    *,
    user: _UserWithId,
    billing_subject_id: UUID,
    template_ref: str,
    allow_reuse: bool = True,
) -> _SandboxStartClaim:
    await acquire_managed_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    existing = await load_personal_managed_sandbox(db, user.id, lock_row=True)
    if existing is None:
        created = await ensure_personal_managed_sandbox(
            db,
            user_id=user.id,
            created_by_user_id=user.id,
            billing_subject_id=billing_subject_id,
            e2b_template_ref=template_ref,
        )
        claimed = await update_managed_sandbox_status(
            db,
            created.id,
            status="starting",
            last_error=None,
        )
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=claimed or created, action="start")

    if _in_flight_status_is_fresh(existing):
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=existing, action="wait")

    if (
        allow_reuse
        and existing.status == "ready"
        and existing.e2b_template_ref == template_ref
        and _runtime_access_ready(existing)
    ):
        await commit_managed_sandbox_session(db)
        return _SandboxStartClaim(sandbox=existing, action="reuse")

    claimed = await update_managed_sandbox_status(
        db,
        existing.id,
        status="starting",
        last_error=None,
    )
    await commit_managed_sandbox_session(db)
    return _SandboxStartClaim(sandbox=claimed or existing, action="start")


async def _wait_for_in_flight_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    for _ in range(_WAIT_ATTEMPTS):
        await asyncio.sleep(_WAIT_DELAY_SECONDS)
        current = await load_personal_managed_sandbox(db, user.id)
        if current is None:
            return None
        if current.status == "ready" and _runtime_access_ready(current):
            return current
        if current.status == "error":
            return None
        if current.status in _IN_FLIGHT_STATUSES and _in_flight_status_is_fresh(current):
            continue
        return None
    return None


async def get_managed_sandbox_detail(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    return await load_personal_managed_sandbox(db, user.id)


async def ensure_managed_sandbox_ready(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue:
    provider = get_configured_sandbox_provider()
    template_ref = _template_ref()
    billing_subject = await ensure_personal_billing_subject(db, user.id)
    last_claim: _SandboxStartClaim | None = None

    for _ in range(2):
        claim = await _claim_managed_sandbox_start(
            db,
            user=user,
            billing_subject_id=billing_subject.id,
            template_ref=template_ref,
        )
        last_claim = claim
        if claim.action == "wait":
            waited = await _wait_for_in_flight_sandbox(db, user)
            if waited is not None:
                ready = await _reuse_ready_runtime_if_possible(
                    db,
                    provider,
                    waited,
                    template_ref=template_ref,
                )
                if ready is not None:
                    await _best_effort_reconcile_repos(
                        db,
                        user_id=ready.owner_user_id,
                        sandbox=ready,
                    )
                    return ready
                claim = await _claim_managed_sandbox_start(
                    db,
                    user=user,
                    billing_subject_id=billing_subject.id,
                    template_ref=template_ref,
                    allow_reuse=False,
                )
                if claim.action != "start":
                    continue
            else:
                continue

        if claim.action == "reuse":
            ready = await _reuse_ready_runtime_if_possible(
                db,
                provider,
                claim.sandbox,
                template_ref=template_ref,
            )
            if ready is not None:
                await _best_effort_reconcile_repos(db, user_id=ready.owner_user_id, sandbox=ready)
                return ready
            claim = await _claim_managed_sandbox_start(
                db,
                user=user,
                billing_subject_id=billing_subject.id,
                template_ref=template_ref,
                allow_reuse=False,
            )
            if claim.action != "start":
                continue

        try:
            return await _create_or_launch_runtime(
                db,
                provider,
                claim.sandbox,
                template_ref=template_ref,
            )
        except Exception as exc:
            message = format_exception_message(exc)
            await update_managed_sandbox_status(
                db,
                claim.sandbox.id,
                status="error",
                last_error=message,
            )
            await commit_managed_sandbox_session(db)
            if isinstance(exc, CloudApiError):
                raise
            raise CloudApiError(
                "managed_sandbox_start_failed",
                message or "Managed cloud sandbox failed to start.",
                status_code=502,
            ) from exc

    if last_claim is not None and last_claim.action == "wait":
        raise CloudApiError(
            "managed_sandbox_start_in_progress",
            "Managed cloud sandbox is still starting. Try again shortly.",
            status_code=409,
        )
    raise CloudApiError(
        "managed_sandbox_start_failed",
        "Managed cloud sandbox failed to reach a usable runtime.",
        status_code=502,
    )


async def wake_managed_sandbox(db: AsyncSession, user: _UserWithId) -> ManagedSandboxValue:
    return await ensure_managed_sandbox_ready(db, user)


async def destroy_managed_sandbox(
    db: AsyncSession,
    user: _UserWithId,
) -> ManagedSandboxValue | None:
    await acquire_managed_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    sandbox = await load_personal_managed_sandbox(db, user.id, lock_row=True)
    if sandbox is None:
        return None
    if sandbox.status in {"creating", "starting"} and _in_flight_status_is_fresh(sandbox):
        raise CloudApiError(
            "managed_sandbox_lifecycle_busy",
            "Managed cloud sandbox is still starting. Try destroy again after startup finishes.",
            status_code=409,
        )
    destroying = await update_managed_sandbox_status(
        db,
        sandbox.id,
        status="destroying",
        last_error=None,
    )
    await commit_managed_sandbox_session(db)
    sandbox = destroying or sandbox
    provider = get_configured_sandbox_provider()
    if sandbox.e2b_sandbox_id:
        try:
            await provider.destroy_sandbox(sandbox.e2b_sandbox_id)
        except Exception as exc:
            message = format_exception_message(exc)
            log_cloud_event(
                "managed sandbox destroy provider call failed",
                managed_sandbox_id=sandbox.id,
                e2b_sandbox_id=sandbox.e2b_sandbox_id,
                error=message,
                error_type=exc.__class__.__name__,
            )
            await update_managed_sandbox_status(
                db,
                sandbox.id,
                status="error",
                last_error=message,
            )
            await commit_managed_sandbox_session(db)
            if isinstance(exc, SandboxProviderError):
                raise CloudApiError(
                    "managed_sandbox_destroy_failed",
                    message or "Managed cloud sandbox destroy failed.",
                    status_code=502,
                ) from exc
            raise CloudApiError(
                "managed_sandbox_destroy_failed",
                message or "Managed cloud sandbox destroy failed.",
                status_code=502,
            ) from exc
    destroyed = await mark_managed_sandbox_destroyed(db, sandbox.id)
    await commit_managed_sandbox_session(db)
    return destroyed


async def load_managed_sandbox_runtime_access(
    sandbox: ManagedSandboxValue,
) -> tuple[str, str, str]:
    if not _runtime_access_ready(sandbox):
        raise CloudApiError(
            "managed_sandbox_runtime_not_ready",
            "Managed sandbox runtime access is not ready.",
            status_code=409,
        )
    return (
        sandbox.anyharness_base_url or "",
        decrypt_text(sandbox.anyharness_bearer_token_ciphertext or ""),
        decrypt_text(sandbox.anyharness_data_key_ciphertext or ""),
    )


async def _reuse_ready_runtime_if_possible(
    db: AsyncSession,
    provider: SandboxProvider,
    sandbox: ManagedSandboxValue,
    *,
    template_ref: str,
) -> ManagedSandboxValue | None:
    if sandbox.e2b_template_ref != template_ref:
        return None
    if not _runtime_access_ready(sandbox):
        return None
    token = decrypt_text(sandbox.anyharness_bearer_token_ciphertext or "")
    try:
        connected = await provider.connect_running_sandbox(sandbox.e2b_sandbox_id or "")
        endpoint = await provider.resolve_runtime_endpoint(connected)
        await wait_for_runtime_health(
            endpoint.runtime_url,
            required_successes=1,
            total_attempts=3,
            delay_seconds=0.25,
        )
        await verify_runtime_auth_enforced(endpoint.runtime_url, token)
        updated = await mark_managed_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id or "",
            e2b_template_ref=template_ref,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=sandbox.anyharness_bearer_token_ciphertext or "",
            anyharness_data_key_ciphertext=sandbox.anyharness_data_key_ciphertext or "",
        )
        await commit_managed_sandbox_session(db)
        return updated
    except Exception as exc:
        log_cloud_event(
            "managed sandbox ready runtime reuse failed",
            managed_sandbox_id=sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
    try:
        connected = await provider.resume_sandbox(sandbox.e2b_sandbox_id or "")
        endpoint = await provider.resolve_runtime_endpoint(connected)
        await wait_for_runtime_health(
            endpoint.runtime_url,
            required_successes=1,
            total_attempts=12,
            delay_seconds=0.5,
        )
        await verify_runtime_auth_enforced(endpoint.runtime_url, token)
        updated = await mark_managed_sandbox_ready(
            db,
            sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id or "",
            e2b_template_ref=template_ref,
            anyharness_base_url=endpoint.runtime_url,
            anyharness_bearer_token_ciphertext=sandbox.anyharness_bearer_token_ciphertext or "",
            anyharness_data_key_ciphertext=sandbox.anyharness_data_key_ciphertext or "",
        )
        await commit_managed_sandbox_session(db)
        return updated
    except Exception as exc:
        log_cloud_event(
            "managed sandbox paused runtime resume failed",
            managed_sandbox_id=sandbox.id,
            e2b_sandbox_id=sandbox.e2b_sandbox_id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
        return None


async def _create_or_launch_runtime(
    db: AsyncSession,
    provider: SandboxProvider,
    sandbox: ManagedSandboxValue,
    *,
    template_ref: str,
) -> ManagedSandboxValue:
    provider_sandbox: Any | None = None
    e2b_sandbox_id = sandbox.e2b_sandbox_id
    if e2b_sandbox_id and sandbox.e2b_template_ref != template_ref:
        try:
            await provider.destroy_sandbox(e2b_sandbox_id)
        except Exception as exc:
            log_cloud_event(
                "managed sandbox old template destroy failed",
                managed_sandbox_id=sandbox.id,
                e2b_sandbox_id=e2b_sandbox_id,
                old_template_ref=sandbox.e2b_template_ref,
                new_template_ref=template_ref,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
        e2b_sandbox_id = None
    if e2b_sandbox_id:
        try:
            provider_sandbox = await provider.resume_sandbox(e2b_sandbox_id)
        except Exception:
            provider_sandbox = None
    if provider_sandbox is None:
        handle = await provider.create_sandbox(
            metadata={
                "proliferate_managed_sandbox_id": str(sandbox.id),
                "proliferate_owner_scope": sandbox.owner_scope,
            }
        )
        e2b_sandbox_id = handle.sandbox_id
        recorded = await record_managed_sandbox_provider_sandbox(
            db,
            sandbox.id,
            e2b_sandbox_id=e2b_sandbox_id,
            e2b_template_ref=template_ref,
        )
        if recorded is None:
            try:
                await provider.destroy_sandbox(e2b_sandbox_id)
            except Exception as exc:
                log_cloud_event(
                    "managed sandbox orphan cleanup failed after row disappeared",
                    managed_sandbox_id=sandbox.id,
                    e2b_sandbox_id=e2b_sandbox_id,
                    error=format_exception_message(exc),
                    error_type=exc.__class__.__name__,
                )
            raise CloudApiError(
                "managed_sandbox_not_found",
                "Managed sandbox disappeared during provisioning.",
                status_code=404,
            )
        sandbox = recorded
        await commit_managed_sandbox_session(db)
        provider_sandbox = await provider.connect_running_sandbox(e2b_sandbox_id)

    runtime_context = await provider.resolve_runtime_context(provider_sandbox)
    endpoint = await provider.resolve_runtime_endpoint(provider_sandbox)
    runtime_token = secrets.token_urlsafe(32)
    data_key = generate_anyharness_data_key()
    runtime_env = build_runtime_env(runtime_token, anyharness_data_key=data_key)

    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_stop_previous",
            command=build_supervised_runtime_stop_command(runtime_context),
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox previous runtime stop failed",
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_prepare_workdir",
            command=f"mkdir -p {runtime_context.runtime_workdir}",
            runtime_context=runtime_context,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox runtime workdir prepare failed",
    )
    await provider.write_file(
        provider_sandbox,
        runtime_launcher_path(runtime_context),
        build_runtime_launch_script(provider, runtime_context, runtime_env),
    )
    assert_command_succeeded(
        await run_sandbox_command_logged(
            provider,
            provider_sandbox,
            workspace_id=sandbox.id,
            label="managed_runtime_launch",
            command=(
                f"chmod 700 {runtime_launcher_path(runtime_context)} && "
                f"{build_detached_runtime_launch_command(runtime_context)}"
            ),
            runtime_context=runtime_context,
            cwd=runtime_context.runtime_workdir,
            timeout_seconds=30,
            log_output_on_success=True,
        ),
        "Managed sandbox runtime launch failed",
    )
    await wait_for_runtime_health(
        endpoint.runtime_url,
        required_successes=1,
        total_attempts=40,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(endpoint.runtime_url, runtime_token)

    ready = await mark_managed_sandbox_ready(
        db,
        sandbox.id,
        e2b_sandbox_id=e2b_sandbox_id or "",
        e2b_template_ref=template_ref,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(data_key),
    )
    if ready is None:
        raise CloudApiError(
            "managed_sandbox_not_found",
            "Managed sandbox disappeared during provisioning.",
            status_code=404,
        )
    await commit_managed_sandbox_session(db)
    await _best_effort_reconcile_repos(db, user_id=ready.owner_user_id, sandbox=ready)
    return ready


async def _best_effort_reconcile_repos(
    db: AsyncSession,
    *,
    user_id: UUID | None,
    sandbox: ManagedSandboxValue,
) -> None:
    if user_id is None:
        return
    github_grant = await get_ready_github_grant_for_user(db, user_id=user_id)
    if github_grant is None:
        return
    from proliferate.server.cloud.managed_sandboxes.repo_materialization import (
        reconcile_configured_repos_for_sandbox,
    )

    try:
        await reconcile_configured_repos_for_sandbox(
            db,
            sandbox=sandbox,
            github_token=github_grant.access_token,
            run_setup=False,
        )
        await commit_managed_sandbox_session(db)
    except Exception as exc:
        log_cloud_event(
            "managed sandbox repo reconciliation failed",
            managed_sandbox_id=sandbox.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
