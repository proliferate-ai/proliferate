from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
)
from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus, CloudTargetKind
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.organizations import Organization
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.automation_run_claim_values import AutomationRunClaimValue
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.automations.worker.cloud_executor_commands import (
    enqueue_automation_command,
    load_command,
    wait_for_command_result,
)


def _claim(*, run_id: uuid.UUID, user_id: uuid.UUID) -> AutomationRunClaimValue:
    return AutomationRunClaimValue(
        id=run_id,
        automation_id=uuid.uuid4(),
        user_id=user_id,
        status="creating_session",
        execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        title="Daily check",
        prompt="Check the repo",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        cloud_target_id_snapshot=None,
        cloud_target_kind_snapshot=None,
        agent_kind="codex",
        model_id="gpt-5.4",
        mode_id="code",
        reasoning_effort="medium",
        executor_kind=AUTOMATION_EXECUTOR_KIND_CLOUD,
        executor_id="cloud:worker",
        claim_id=uuid.uuid4(),
        claim_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        cloud_workspace_id=uuid.uuid4(),
        anyharness_workspace_id="workspace-1",
        anyharness_session_id=None,
    )


@pytest.mark.asyncio
async def test_cloud_executor_enqueues_idempotent_automation_command(
    test_engine: AsyncEngine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            session.add(
                User(
                    id=user_id,
                    email="automation-worker-command@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            target = await targets_store.create_target(
                session,
                display_name="Managed cloud",
                kind=CloudTargetKind.managed_cloud.value,
                owner_scope="personal",
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                default_workspace_root=None,
            )

        claim = _claim(run_id=uuid.uuid4(), user_id=user_id)
        first = await enqueue_automation_command(
            claim,
            target_id=target.id,
            stage="start-session",
            kind=CloudCommandKind.start_session.value,
            workspace_id="workspace-1",
            payload={"workspaceId": "workspace-1", "agentKind": "codex"},
        )
        duplicate = await enqueue_automation_command(
            claim,
            target_id=target.id,
            stage="start-session",
            kind=CloudCommandKind.start_session.value,
            workspace_id="workspace-1",
            payload={"workspaceId": "workspace-1", "agentKind": "codex"},
        )
        reclaimed_claim = replace(claim, claim_id=uuid.uuid4())
        duplicate_from_reclaim = await enqueue_automation_command(
            reclaimed_claim,
            target_id=target.id,
            stage="start-session",
            kind=CloudCommandKind.start_session.value,
            workspace_id="workspace-1",
            payload={"workspaceId": "workspace-1", "agentKind": "codex"},
        )

        assert duplicate.id == first.id
        assert duplicate_from_reclaim.id == first.id
        assert first.kind == "start_session"
        assert first.actor_kind == "automation"
        assert first.source == "automation"
        assert first.target_id == target.id
        assert first.workspace_id == "workspace-1"
        assert first.session_id is None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_executor_preflight_rejects_unapplied_managed_target(
    test_engine: AsyncEngine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            session.add(
                User(
                    id=user_id,
                    email="automation-worker-runtime-config@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
                session,
                user_id=user_id,
                created_by_user_id=user_id,
            )
            target = await targets_store.ensure_primary_profile_target(
                session,
                sandbox_profile_id=profile.id,
                created_by_user_id=user_id,
            )

        claim = _claim(run_id=uuid.uuid4(), user_id=user_id)
        with pytest.raises(CloudApiError) as exc:
            await enqueue_automation_command(
                claim,
                target_id=target.id,
                stage="start-session",
                kind=CloudCommandKind.start_session.value,
                workspace_id="workspace-1",
                payload={"workspaceId": "workspace-1", "agentKind": "proliferate"},
            )

        assert exc.value.code == "cloud_command_agent_auth_not_ready"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_executor_command_preserves_target_organization_id(
    test_engine: AsyncEngine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            session.add(
                User(
                    id=user_id,
                    email="automation-worker-command-org@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            session.add(
                Organization(
                    id=organization_id,
                    name="Engineering",
                    logo_domain=None,
                    logo_image=None,
                )
            )
            await session.flush()
            target = await targets_store.create_target(
                session,
                display_name="Managed cloud",
                kind=CloudTargetKind.managed_cloud.value,
                owner_scope="organization",
                owner_user_id=None,
                organization_id=organization_id,
                created_by_user_id=user_id,
                default_workspace_root=None,
            )

        claim = _claim(run_id=uuid.uuid4(), user_id=user_id)
        command = await enqueue_automation_command(
            claim,
            target_id=target.id,
            organization_id=organization_id,
            stage="start-session",
            kind=CloudCommandKind.start_session.value,
            workspace_id="workspace-1",
            payload={"workspaceId": "workspace-1", "agentKind": "codex"},
        )

        assert command.organization_id == organization_id
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_executor_expires_timed_out_automation_command(
    test_engine: AsyncEngine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            session.add(
                User(
                    id=user_id,
                    email="automation-worker-command-timeout@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            target = await targets_store.create_target(
                session,
                display_name="Managed cloud",
                kind=CloudTargetKind.managed_cloud.value,
                owner_scope="personal",
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                default_workspace_root=None,
            )

        claim = _claim(run_id=uuid.uuid4(), user_id=user_id)
        command = await enqueue_automation_command(
            claim,
            target_id=target.id,
            stage="send-prompt",
            kind=CloudCommandKind.send_prompt.value,
            workspace_id="workspace-1",
            session_id="session-1",
            payload={"blocks": [{"type": "text", "text": "hello"}]},
        )

        with pytest.raises(TimeoutError):
            await wait_for_command_result(command, timeout=timedelta(seconds=0))

        expired = await load_command(command.id)
        assert expired is not None
        assert expired.status == "expired"
        assert expired.error_code == "automation_command_timeout"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_executor_expires_delivered_command_on_timeout(
    test_engine: AsyncEngine,
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            session.add(
                User(
                    id=user_id,
                    email="automation-worker-command-delivered-timeout@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            target = await targets_store.create_target(
                session,
                display_name="Managed cloud",
                kind=CloudTargetKind.managed_cloud.value,
                owner_scope="personal",
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                default_workspace_root=None,
            )

        claim = _claim(run_id=uuid.uuid4(), user_id=user_id)
        command = await enqueue_automation_command(
            claim,
            target_id=target.id,
            stage="send-prompt",
            kind=CloudCommandKind.send_prompt.value,
            workspace_id="workspace-1",
            session_id="session-1",
            payload={"blocks": [{"type": "text", "text": "hello"}]},
        )
        async with engine_module.async_session_factory() as session, session.begin():
            row = await session.get(CloudCommand, command.id)
            assert row is not None
            row.status = CloudCommandStatus.delivered.value
            row.delivered_at = datetime.now(UTC)

        delivered = await load_command(command.id)
        assert delivered is not None
        assert delivered.status == CloudCommandStatus.delivered.value

        with pytest.raises(TimeoutError):
            await wait_for_command_result(command, timeout=timedelta(seconds=0))

        current = await load_command(command.id)
        assert current is not None
        assert current.status == CloudCommandStatus.expired.value
        assert current.error_code == "automation_command_timeout"
    finally:
        engine_module.async_session_factory = original_factory
