"""Sandbox lifecycle helpers for cloud runtime provisioning."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from proliferate.constants.billing import USAGE_SEGMENT_OPENED_BY_PROVISION
from proliferate.constants.cloud import CloudWorkspaceStatus
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_sandboxes
from proliferate.db.store.cloud_runtime_environments import (
    load_runtime_environment_with_sandbox,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_sandboxes import (
    bind_allocated_sandbox,
    save_sandbox_provider_state,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.integrations.sandbox import SandboxHandle, SandboxProvider
from proliferate.server.billing.service import record_cloud_sandbox_usage_started
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.runtime.domain.reconnect_policy import (
    SandboxReconnectAction,
    reconnect_action_for_sandbox_state,
)
from proliferate.server.cloud.runtime.domain.runtime_state import runtime_connected_sandbox_update
from proliferate.server.cloud.runtime.models import (
    CloudProvisionInput,
    ConnectedSandbox,
    ProvisionStep,
)
from proliferate.server.cloud.runtime.provisioning.step_tracker import ProvisionStepTracker
from proliferate.utils.crypto import decrypt_text
from proliferate.utils.time import utcnow


async def create_and_connect_sandbox(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
    *,
    sandbox_record: cloud_sandboxes.CloudSandboxSnapshot,
    set_workspace_status: Callable[..., Awaitable[None]],
) -> ConnectedSandbox:
    tracker.begin(
        ProvisionStep.create_sandbox,
        provider=provider.kind,
        template_version=provider.template_version,
        repo=ctx.repo_label,
    )
    handle = await provider.create_sandbox(
        metadata={
            "user_id": str(ctx.user_id),
            "workspace_id": str(ctx.workspace_id),
            "runtime_environment_id": str(ctx.runtime_environment_id),
            "sandbox_profile_id": str(ctx.sandbox_profile_id),
            "target_id": str(ctx.target_id),
            "cloud_sandbox_id": str(sandbox_record.id),
            "billing_subject_id": str(sandbox_record.billing_subject_id),
        }
    )
    tracker.complete(sandbox_id=handle.sandbox_id)
    started_at = utcnow()
    async with db_engine.async_session_factory() as db, db.begin():
        await bind_allocated_sandbox(
            db,
            sandbox_record.id,
            external_sandbox_id=handle.sandbox_id,
            status="provisioning",
            started_at=started_at,
        )
    await record_cloud_sandbox_usage_started(
        user_id=ctx.user_id,
        runtime_environment_id=ctx.runtime_environment_id,
        workspace_id=ctx.workspace_id,
        sandbox_id=sandbox_record.id,
        external_sandbox_id=handle.sandbox_id,
        sandbox_execution_id=None,
        started_at=started_at,
        opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
    )

    await set_workspace_status(
        ctx.workspace_id,
        CloudWorkspaceStatus.materializing,
        detail="Connecting to sandbox",
    )
    tracker.begin(ProvisionStep.connect_sandbox, sandbox_id=handle.sandbox_id)
    sandbox = await provider.connect_running_sandbox(handle.sandbox_id)
    runtime_context = await provider.resolve_runtime_context(sandbox)
    endpoint = await provider.resolve_runtime_endpoint(sandbox)
    tracker.complete(runtime_url=endpoint.runtime_url)

    return ConnectedSandbox(
        handle=handle,
        sandbox=sandbox,
        endpoint=endpoint,
        runtime_context=runtime_context,
    )


async def persist_target_runtime_access(
    ctx: CloudProvisionInput,
    *,
    sandbox_record_id: UUID,
    runtime_url: str,
    runtime_token_ciphertext: str | None,
    anyharness_data_key_ciphertext: str | None,
) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        runtime_access = await targets_store.update_target_runtime_access(
            db,
            target_id=ctx.target_id,
            sandbox_profile_id=ctx.sandbox_profile_id,
            cloud_sandbox_id=sandbox_record_id,
            anyharness_base_url=runtime_url,
            runtime_token_ciphertext=runtime_token_ciphertext,
            anyharness_data_key_ciphertext=anyharness_data_key_ciphertext,
            worker_id=None,
            heartbeat_at=utcnow(),
        )
        if runtime_access is None:
            raise RuntimeError("Managed target runtime access rejected inactive target state.")


async def mark_sandbox_running(sandbox_id: UUID, started_at: object) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await save_sandbox_provider_state(
            db, sandbox_id, status="running", started_at=started_at or utcnow(), stopped_at=None
        )


async def save_runtime_environment_updates(
    runtime_environment_id: UUID, updates: dict[str, object]
) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        await save_runtime_environment_state(db, runtime_environment_id, **updates)


async def connect_existing_profile_sandbox(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
) -> tuple[ConnectedSandbox, UUID, str] | None:
    async with db_engine.async_session_factory() as db:
        active_sandbox = await cloud_sandboxes.load_active_sandbox_for_profile_target(
            db,
            sandbox_profile_id=ctx.sandbox_profile_id,
            target_id=ctx.target_id,
        )
        runtime_access = await targets_store.load_active_runtime_access_for_target(
            db,
            target_id=ctx.target_id,
        )
    if active_sandbox is None or not active_sandbox.external_sandbox_id:
        return None
    if active_sandbox.provider != provider.kind.value:
        return None
    if (
        runtime_access is None
        or runtime_access.cloud_sandbox_id != active_sandbox.id
        or not runtime_access.runtime_token_ciphertext
        or not runtime_access.anyharness_data_key_ciphertext
    ):
        return None

    tracker.begin(
        ProvisionStep.connect_sandbox,
        sandbox_id=active_sandbox.external_sandbox_id,
        reused_sandbox=True,
        reused_profile_sandbox=True,
    )
    try:
        provider_state = await provider.get_sandbox_state(active_sandbox.external_sandbox_id)
        if provider_state is None:
            tracker.complete(reused_sandbox=False, reason="provider_state_missing")
            return None

        observed_state = provider_state.state.strip().lower()
        reconnect_action = reconnect_action_for_sandbox_state(observed_state)
        if reconnect_action == SandboxReconnectAction.connect:
            sandbox = await provider.connect_running_sandbox(active_sandbox.external_sandbox_id)
        elif reconnect_action == SandboxReconnectAction.resume:
            sandbox = await provider.resume_sandbox(active_sandbox.external_sandbox_id)
        else:
            tracker.complete(reused_sandbox=False, provider_state=observed_state)
            return None

        runtime_context = await provider.resolve_runtime_context(sandbox)
        endpoint = await provider.resolve_runtime_endpoint(sandbox)
    except Exception:
        log_cloud_event(
            "cloud profile target sandbox reuse failed",
            level=logging.WARNING,
            workspace_id=ctx.workspace_id,
            target_id=ctx.target_id,
            sandbox_id=active_sandbox.id,
            external_sandbox_id=active_sandbox.external_sandbox_id,
        )
        tracker.complete(reused_sandbox=False, reason="connect_failed")
        return None

    await mark_sandbox_running(active_sandbox.id, provider_state.started_at)
    await persist_target_runtime_access(
        ctx,
        sandbox_record_id=active_sandbox.id,
        runtime_url=endpoint.runtime_url,
        runtime_token_ciphertext=runtime_access.runtime_token_ciphertext,
        anyharness_data_key_ciphertext=runtime_access.anyharness_data_key_ciphertext,
    )
    update = runtime_connected_sandbox_update(
        runtime_url=endpoint.runtime_url, active_sandbox_id=active_sandbox.id
    )
    await save_runtime_environment_updates(ctx.runtime_environment_id, update)
    tracker.complete(runtime_url=endpoint.runtime_url, reused_sandbox=True)

    return (
        ConnectedSandbox(
            handle=SandboxHandle(
                provider=provider.kind,
                sandbox_id=active_sandbox.external_sandbox_id,
                template_version=active_sandbox.template_version or provider.template_version,
            ),
            sandbox=sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
        ),
        active_sandbox.id,
        decrypt_text(runtime_access.runtime_token_ciphertext),
    )


async def connect_existing_environment_sandbox(
    tracker: ProvisionStepTracker,
    ctx: CloudProvisionInput,
    provider: SandboxProvider,
) -> tuple[ConnectedSandbox, UUID, str] | None:
    async with db_engine.async_session_factory() as db:
        runtime = await load_runtime_environment_with_sandbox(db, ctx.runtime_environment_id)
    sandbox_record = runtime.sandbox if runtime is not None else None
    if sandbox_record is None or not sandbox_record.external_sandbox_id:
        return None
    if runtime is None or not runtime.environment.runtime_token_ciphertext:
        return None
    if sandbox_record.provider != provider.kind.value:
        return None
    if (
        sandbox_record.sandbox_profile_id != ctx.sandbox_profile_id
        or sandbox_record.target_id != ctx.target_id
    ):
        return None

    tracker.begin(
        ProvisionStep.connect_sandbox,
        sandbox_id=sandbox_record.external_sandbox_id,
        reused_sandbox=True,
    )
    try:
        provider_state = await provider.get_sandbox_state(sandbox_record.external_sandbox_id)
        if provider_state is None:
            tracker.complete(reused_sandbox=False, reason="provider_state_missing")
            return None

        observed_state = provider_state.state.strip().lower()
        reconnect_action = reconnect_action_for_sandbox_state(observed_state)
        if reconnect_action == SandboxReconnectAction.connect:
            sandbox = await provider.connect_running_sandbox(sandbox_record.external_sandbox_id)
        elif reconnect_action == SandboxReconnectAction.resume:
            sandbox = await provider.resume_sandbox(sandbox_record.external_sandbox_id)
        else:
            tracker.complete(reused_sandbox=False, provider_state=observed_state)
            return None

        runtime_context = await provider.resolve_runtime_context(sandbox)
        endpoint = await provider.resolve_runtime_endpoint(sandbox)
    except Exception:
        log_cloud_event(
            "cloud runtime environment sandbox reuse failed",
            level=logging.WARNING,
            workspace_id=ctx.workspace_id,
            runtime_environment_id=ctx.runtime_environment_id,
            sandbox_id=sandbox_record.id,
            external_sandbox_id=sandbox_record.external_sandbox_id,
        )
        tracker.complete(reused_sandbox=False, reason="connect_failed")
        return None

    await mark_sandbox_running(sandbox_record.id, provider_state.started_at)
    await persist_target_runtime_access(
        ctx,
        sandbox_record_id=sandbox_record.id,
        runtime_url=endpoint.runtime_url,
        runtime_token_ciphertext=runtime.environment.runtime_token_ciphertext,
        anyharness_data_key_ciphertext=runtime.environment.anyharness_data_key_ciphertext,
    )
    update = runtime_connected_sandbox_update(
        runtime_url=endpoint.runtime_url, active_sandbox_id=sandbox_record.id
    )
    await save_runtime_environment_updates(ctx.runtime_environment_id, update)
    tracker.complete(runtime_url=endpoint.runtime_url, reused_sandbox=True)

    return (
        ConnectedSandbox(
            handle=SandboxHandle(
                provider=provider.kind,
                sandbox_id=sandbox_record.external_sandbox_id,
                template_version=sandbox_record.template_version or provider.template_version,
            ),
            sandbox=sandbox,
            endpoint=endpoint,
            runtime_context=runtime_context,
        ),
        sandbox_record.id,
        decrypt_text(runtime.environment.runtime_token_ciphertext),
    )
