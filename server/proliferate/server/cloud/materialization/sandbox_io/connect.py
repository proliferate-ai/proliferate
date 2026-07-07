"""Connect to, wake, and launch the AnyHarness process inside a CloudSandbox."""

from __future__ import annotations

import secrets
import shlex
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandboxes as cloud_sandboxes_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sandboxes import CloudSandboxValue
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProvider,
    SandboxRuntimeContext,
    get_sandbox_provider,
)
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
    SandboxIOTarget,
)
from proliferate.server.cloud.materialization.sandbox_io.worker_sidecar import (
    launch_worker_sidecar,
)
from proliferate.server.cloud.runtime.bootstrap import (
    build_runtime_env,
    build_runtime_launch_script,
)
from proliferate.server.cloud.runtime.data_key import generate_anyharness_data_key
from proliferate.server.cloud.runtime.liveness_health import (
    verify_runtime_auth_enforced,
    wait_for_runtime_health,
)
from proliferate.server.cloud.runtime.sandbox_exec import (
    assert_command_succeeded,
    build_detached_runtime_launch_command,
    run_sandbox_command_logged,
    runtime_launcher_path,
)
from proliferate.utils.crypto import decrypt_text, encrypt_text


def _runtime_token(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_bearer_token_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_bearer_token_ciphertext)


def _runtime_data_key(sandbox: CloudSandboxValue) -> str | None:
    if not sandbox.anyharness_data_key_ciphertext:
        return None
    return decrypt_text(sandbox.anyharness_data_key_ciphertext)


async def _resolve_owner_organization_id(
    db: AsyncSession,
    sandbox: CloudSandboxValue,
) -> UUID | None:
    """Resolve the sandbox's owning organization for observability identity tags.

    The cloud_sandbox row has no organization column, but the owner is one
    membership lookup away. Uses the owner's current (first active)
    membership; best-effort — identity tags must never block a launch.
    """
    if sandbox.organization_id is not None:
        return sandbox.organization_id
    if sandbox.owner_user_id is None:
        return None
    try:
        record = await organizations_store.get_current_membership_for_user(
            db, sandbox.owner_user_id
        )
    except Exception:  # noqa: BLE001 - identity tagging is best-effort.
        return None
    return record.organization.id if record is not None else None


async def connect_ready_sandbox(
    db: AsyncSession,
    *,
    sandbox: CloudSandboxValue,
) -> SandboxIOTarget:
    if sandbox.destroyed_at is not None or sandbox.status == "destroyed":
        raise CloudMaterializationCommandError("Cloud sandbox has been destroyed.")

    provider = get_sandbox_provider(sandbox.e2b_template_ref)
    provider_sandbox_id = sandbox.e2b_sandbox_id
    if provider_sandbox_id is None:
        handle = await provider.create_sandbox(
            metadata={
                "proliferate_cloud_sandbox_id": str(sandbox.id),
                "proliferate_owner_user_id": str(sandbox.owner_user_id or ""),
            }
        )
        provider_sandbox_id = handle.sandbox_id
        refreshed = await cloud_sandboxes_store.record_cloud_sandbox_provider_sandbox(
            db,
            sandbox.id,
            e2b_sandbox_id=provider_sandbox_id,
            e2b_template_ref=provider.template_version,
        )
        if refreshed is not None:
            sandbox = refreshed
        await db.commit()

    provider_sandbox = await provider.resume_sandbox(provider_sandbox_id)
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

    if sandbox.anyharness_base_url != endpoint.runtime_url:
        await cloud_sandboxes_store.mark_cloud_sandbox_ready(
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
        )
        await db.commit()

    return SandboxIOTarget(
        provider=provider,
        sandbox=provider_sandbox,
        endpoint=endpoint,
        runtime_context=runtime_context,
    )


async def _launch_anyharness_runtime(
    db: AsyncSession,
    *,
    provider: SandboxProvider,
    provider_sandbox: object,
    provider_sandbox_id: str,
    sandbox_record: CloudSandboxValue,
    endpoint: RuntimeEndpoint,
    runtime_context: SandboxRuntimeContext,
    runtime_token: str,
    anyharness_data_key: str,
) -> None:
    launcher_path = runtime_launcher_path(runtime_context)
    organization_id = await _resolve_owner_organization_id(db, sandbox_record)
    await provider.write_file(
        provider_sandbox,
        launcher_path,
        build_runtime_launch_script(
            provider,
            runtime_context,
            build_runtime_env(
                runtime_token,
                anyharness_data_key=anyharness_data_key,
                organization_id=organization_id,
                sandbox_id=provider_sandbox_id,
                user_id=sandbox_record.owner_user_id,
            ),
        ),
    )
    chmod_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_chmod_anyharness_launcher",
        command=f"chmod 700 {shlex.quote(launcher_path)}",
        runtime_context=runtime_context,
        timeout_seconds=30,
    )
    assert_command_succeeded(chmod_result, "AnyHarness launcher chmod failed")

    start_result = await run_sandbox_command_logged(
        provider,
        provider_sandbox,
        workspace_id=sandbox_record.id,
        label="materialization_launch_anyharness",
        command=build_detached_runtime_launch_command(runtime_context),
        runtime_context=runtime_context,
        cwd=runtime_context.runtime_workdir,
        timeout_seconds=30,
        log_output_on_success=True,
    )
    assert_command_succeeded(start_result, "AnyHarness launch failed")
    await wait_for_runtime_health(
        endpoint.runtime_url,
        workspace_id=sandbox_record.id,
        total_attempts=30,
        delay_seconds=0.5,
    )
    await verify_runtime_auth_enforced(
        endpoint.runtime_url,
        runtime_token,
        workspace_id=sandbox_record.id,
    )
    await launch_worker_sidecar(
        provider=provider,
        provider_sandbox=provider_sandbox,
        sandbox_record=sandbox_record,
        runtime_context=runtime_context,
        runtime_bearer_token=runtime_token,
    )
    await cloud_sandboxes_store.mark_cloud_sandbox_ready(
        db,
        sandbox_record.id,
        e2b_sandbox_id=provider_sandbox_id,
        e2b_template_ref=provider.template_version,
        anyharness_base_url=endpoint.runtime_url,
        anyharness_bearer_token_ciphertext=encrypt_text(runtime_token),
        anyharness_data_key_ciphertext=encrypt_text(anyharness_data_key),
    )
    await db.commit()
