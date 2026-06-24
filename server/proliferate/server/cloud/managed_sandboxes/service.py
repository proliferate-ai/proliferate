"""Managed cloud sandbox orchestration."""

from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.config import settings
from proliferate.db import engine as db_session
from proliferate.db.models.auth import User
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.managed_sandboxes import (
    ManagedSandboxValue,
    acquire_managed_sandbox_owner_lock,
    ensure_personal_managed_sandbox,
    load_personal_managed_sandbox,
    mark_managed_sandbox_destroyed,
    mark_managed_sandbox_health,
    mark_managed_sandbox_ready,
    update_managed_sandbox_status,
)
from proliferate.integrations.sandbox import (
    SandboxProvider,
    SandboxProviderError,
    get_configured_sandbox_provider,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import format_exception_message, log_cloud_event
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


async def get_managed_sandbox_detail(
    db: AsyncSession,
    user: User,
) -> ManagedSandboxValue | None:
    return await load_personal_managed_sandbox(db, user.id)


async def ensure_managed_sandbox_ready(
    db: AsyncSession,
    user: User,
) -> ManagedSandboxValue:
    provider = get_configured_sandbox_provider()
    template_ref = _template_ref()
    billing_subject = await ensure_personal_billing_subject(db, user.id)
    await acquire_managed_sandbox_owner_lock(
        db,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
    )
    sandbox = await ensure_personal_managed_sandbox(
        db,
        user_id=user.id,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        e2b_template_ref=template_ref,
    )
    await db_session.commit_session(db)

    try:
        ready = await _reuse_ready_runtime_if_possible(db, provider, sandbox)
        if ready is not None:
            return ready

        await update_managed_sandbox_status(db, sandbox.id, status="starting", last_error=None)
        await db_session.commit_session(db)
        return await _create_or_launch_runtime(db, provider, sandbox, template_ref=template_ref)
    except Exception as exc:
        message = format_exception_message(exc)
        await update_managed_sandbox_status(db, sandbox.id, status="error", last_error=message)
        await db_session.commit_session(db)
        if isinstance(exc, CloudApiError):
            raise
        raise CloudApiError(
            "managed_sandbox_start_failed",
            message or "Managed cloud sandbox failed to start.",
            status_code=502,
        ) from exc


async def wake_managed_sandbox(db: AsyncSession, user: User) -> ManagedSandboxValue:
    return await ensure_managed_sandbox_ready(db, user)


async def destroy_managed_sandbox(db: AsyncSession, user: User) -> ManagedSandboxValue | None:
    sandbox = await load_personal_managed_sandbox(db, user.id, lock_row=True)
    if sandbox is None:
        return None
    provider = get_configured_sandbox_provider()
    if sandbox.e2b_sandbox_id:
        try:
            await provider.destroy_sandbox(sandbox.e2b_sandbox_id)
        except SandboxProviderError:
            raise
        except Exception as exc:
            log_cloud_event(
                "managed sandbox destroy provider call failed",
                managed_sandbox_id=sandbox.id,
                e2b_sandbox_id=sandbox.e2b_sandbox_id,
                error=format_exception_message(exc),
                error_type=exc.__class__.__name__,
            )
    return await mark_managed_sandbox_destroyed(db, sandbox.id)


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
) -> ManagedSandboxValue | None:
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
        updated = await mark_managed_sandbox_health(db, sandbox.id)
        await db_session.commit_session(db)
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
        updated = await mark_managed_sandbox_health(db, sandbox.id)
        await db_session.commit_session(db)
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
    await db_session.commit_session(db)
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
        await db_session.commit_session(db)
    except Exception as exc:
        log_cloud_event(
            "managed sandbox repo reconciliation failed",
            managed_sandbox_id=sandbox.id,
            error=format_exception_message(exc),
            error_type=exc.__class__.__name__,
        )
