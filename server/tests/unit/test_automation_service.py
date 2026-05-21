from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.cloud.targets import (
    CloudTarget,
    CloudTargetStatus as CloudTargetStatusRow,
)
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.errors import ProliferateError
from proliferate.server.automations import service as automation_service
from proliferate.server.automations.errors import AutomationInvalidField, AutomationServiceError
from proliferate.server.automations.models import (
    AutomationScheduleRequest,
    CreateAutomationRequest,
)


async def _add_user(session, user_id: uuid.UUID, *, email: str = "automation@example.com") -> None:  # type: ignore[no-untyped-def]
    session.add(
        User(
            id=user_id,
            email=email,
            hashed_password="!",
            is_active=True,
            is_superuser=False,
            is_verified=True,
        )
    )
    await session.flush()


async def _create_online_target(  # type: ignore[no-untyped-def]
    session,
    *,
    user_id: uuid.UUID,
    kind: str = CloudTargetKind.managed_cloud.value,
):
    target = await targets_store.create_target(
        session,
        display_name="Automation target",
        kind=kind,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        default_workspace_root="~/work",
    )
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    await session.execute(
        update(CloudTarget)
        .where(CloudTarget.id == target.id)
        .values(status=CloudTargetStatus.online.value, updated_at=now)
    )
    await session.execute(
        update(CloudTargetStatusRow)
        .where(CloudTargetStatusRow.target_id == target.id)
        .values(
            status=CloudTargetStatus.online.value,
            last_seen_at=now,
            last_heartbeat_at=now,
            updated_at=now,
        )
    )
    await session.flush()
    return target


def test_automation_service_error_is_product_error() -> None:
    error = AutomationServiceError(
        "automation_failed",
        "Automation failed.",
        status_code=409,
    )

    assert isinstance(error, ProliferateError)
    assert error.code == "automation_failed"
    assert error.message == "Automation failed."
    assert error.status_code == 409
    assert str(error) == "Automation failed."


@pytest.mark.asyncio
async def test_create_automation_bootstraps_repo_config(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-repo-config@example.com")
            target = await _create_online_target(session, user_id=user_id)
            response = await automation_service.create_automation(
                session,
                user_id,
                CreateAutomationRequest(
                    title="Daily check",
                    prompt="Check the repo.",
                    gitOwner="proliferate-ai",
                    gitRepoName="proliferate",
                    schedule=AutomationScheduleRequest(
                        rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                        timezone="UTC",
                    ),
                    executionTarget="cloud",
                    targetId=target.id,
                    agentKind="codex",
                ),
            )

        async with engine_module.async_session_factory() as session:
            repo_config = (
                await session.execute(
                    select(CloudRepoConfig).where(
                        CloudRepoConfig.user_id == user_id,
                        CloudRepoConfig.git_owner == "proliferate-ai",
                        CloudRepoConfig.git_repo_name == "proliferate",
                    )
                )
            ).scalar_one()

        assert response.git_owner == "proliferate-ai"
        assert response.git_repo_name == "proliferate"
        assert repo_config.configured is True
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_create_automation_repo_bootstrap_uses_request_transaction(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            await _add_user(session, user_id, email="automation-rollback@example.com")
            target = await _create_online_target(session, user_id=user_id)
            await automation_service.create_automation(
                session,
                user_id,
                CreateAutomationRequest(
                    title="Daily check",
                    prompt="Check the repo.",
                    gitOwner="proliferate-ai",
                    gitRepoName="proliferate",
                    schedule=AutomationScheduleRequest(
                        rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                        timezone="UTC",
                    ),
                    executionTarget="cloud",
                    targetId=target.id,
                    agentKind="codex",
                ),
            )
            await session.rollback()

        async with engine_module.async_session_factory() as session:
            repo_config = (
                await session.execute(
                    select(CloudRepoConfig).where(
                        CloudRepoConfig.user_id == user_id,
                        CloudRepoConfig.git_owner == "proliferate-ai",
                        CloudRepoConfig.git_repo_name == "proliferate",
                    )
                )
            ).scalar_one_or_none()
            billing_subject = (
                await session.execute(
                    select(BillingSubject).where(BillingSubject.user_id == user_id)
                )
            ).scalar_one_or_none()

        assert repo_config is None
        assert billing_subject is None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_resume_cloud_automation_requires_agent_kind(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    automation_id = uuid.uuid4()
    repo_config_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            session.add(
                CloudRepoConfig(
                    id=repo_config_id,
                    user_id=user_id,
                    git_owner="proliferate-ai",
                    git_repo_name="proliferate",
                    configured=True,
                )
            )
            await session.flush()
            session.add(
                Automation(
                    id=automation_id,
                    user_id=user_id,
                    cloud_repo_config_id=repo_config_id,
                    title="Daily check",
                    prompt="Check the repo.",
                    schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                    schedule_timezone="UTC",
                    schedule_summary="Daily at 09:00 UTC",
                    execution_target="cloud",
                    agent_kind=None,
                    enabled=False,
                    paused_at=datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
                    next_run_at=None,
                )
            )
            await session.commit()

        async with engine_module.async_session_factory() as session:
            with pytest.raises(AutomationInvalidField) as exc:
                await automation_service.resume_automation(session, user_id, automation_id)

        assert exc.value.code == "automation_agent_required"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_create_cloud_automation_requires_agent_kind(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-agent-required@example.com")
            target = await _create_online_target(session, user_id=user_id)
            with pytest.raises(AutomationInvalidField) as exc:
                await automation_service.create_automation(
                    session,
                    user_id,
                    CreateAutomationRequest(
                        title="Daily check",
                        prompt="Check the repo.",
                        gitOwner="proliferate-ai",
                        gitRepoName="proliferate",
                        schedule=AutomationScheduleRequest(
                            rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                            timezone="UTC",
                        ),
                        executionTarget="cloud",
                        targetId=target.id,
                    ),
                )

        assert exc.value.code == "automation_agent_required"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_snapshots_selected_target(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-target@example.com")
            target = await _create_online_target(
                session,
                user_id=user_id,
                kind=CloudTargetKind.ssh.value,
            )

            automation = await automation_service.create_automation(
                session,
                user_id,
                CreateAutomationRequest(
                    title="Daily check",
                    prompt="Check the repo.",
                    gitOwner="proliferate-ai",
                    gitRepoName="proliferate",
                    schedule=AutomationScheduleRequest(
                        rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                        timezone="UTC",
                    ),
                    executionTarget="cloud",
                    targetId=target.id,
                    agentKind="codex",
                ),
            )
            run = await automation_service.run_automation_now(session, user_id, automation.id)

        assert automation.cloud_target_id == target.id
        assert automation.cloud_target_kind == CloudTargetKind.ssh.value
        assert run.cloud_target_id_snapshot == target.id
        assert run.cloud_target_kind_snapshot == CloudTargetKind.ssh.value
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_uses_online_managed_target_default(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-default-target@example.com")
            target = await _create_online_target(session, user_id=user_id)

            automation = await automation_service.create_automation(
                session,
                user_id,
                CreateAutomationRequest(
                    title="Daily check",
                    prompt="Check the repo.",
                    gitOwner="proliferate-ai",
                    gitRepoName="proliferate",
                    schedule=AutomationScheduleRequest(
                        rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                        timezone="UTC",
                    ),
                    executionTarget="cloud",
                    agentKind="codex",
                ),
            )
            run = await automation_service.run_automation_now(session, user_id, automation.id)

        assert automation.cloud_target_id == target.id
        assert automation.cloud_target_kind == CloudTargetKind.managed_cloud.value
        assert run.cloud_target_id_snapshot == target.id
        assert run.cloud_target_kind_snapshot == CloudTargetKind.managed_cloud.value
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_manual_run_resolves_target_for_legacy_cloud_automation(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()
    repo_config_id = uuid.uuid4()
    automation_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-legacy-target@example.com")
            target = await _create_online_target(session, user_id=user_id)
            session.add(
                CloudRepoConfig(
                    id=repo_config_id,
                    user_id=user_id,
                    git_owner="proliferate-ai",
                    git_repo_name="proliferate",
                    configured=True,
                )
            )
            await session.flush()
            session.add(
                Automation(
                    id=automation_id,
                    user_id=user_id,
                    cloud_repo_config_id=repo_config_id,
                    title="Legacy target",
                    prompt="Check the repo.",
                    schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                    schedule_timezone="UTC",
                    schedule_summary="Daily at 09:00 UTC",
                    execution_target="cloud",
                    cloud_target_id=None,
                    cloud_target_kind_snapshot=None,
                    agent_kind="codex",
                    enabled=True,
                    paused_at=None,
                    next_run_at=None,
                    last_scheduled_at=None,
                )
            )

            run = await automation_service.run_automation_now(session, user_id, automation_id)

        assert run.cloud_target_id_snapshot == target.id
        assert run.cloud_target_kind_snapshot == CloudTargetKind.managed_cloud.value
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_requires_target_when_no_default(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-no-target@example.com")

            with pytest.raises(AutomationServiceError) as exc:
                await automation_service.create_automation(
                    session,
                    user_id,
                    CreateAutomationRequest(
                        title="Daily check",
                        prompt="Check the repo.",
                        gitOwner="proliferate-ai",
                        gitRepoName="proliferate",
                        schedule=AutomationScheduleRequest(
                            rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                            timezone="UTC",
                        ),
                        executionTarget="cloud",
                        agentKind="codex",
                    ),
                )

        assert exc.value.code == "target_required"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_rejects_offline_target(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session, session.begin():
            await _add_user(session, user_id, email="automation-offline-target@example.com")
            target = await targets_store.create_target(
                session,
                display_name="Offline target",
                kind=CloudTargetKind.ssh.value,
                owner_scope="personal",
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                default_workspace_root="~/work",
            )

            with pytest.raises(AutomationServiceError) as exc:
                await automation_service.create_automation(
                    session,
                    user_id,
                    CreateAutomationRequest(
                        title="Daily check",
                        prompt="Check the repo.",
                        gitOwner="proliferate-ai",
                        gitRepoName="proliferate",
                        schedule=AutomationScheduleRequest(
                            rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                            timezone="UTC",
                        ),
                        executionTarget="cloud",
                        targetId=target.id,
                        agentKind="codex",
                    ),
                )

        assert exc.value.code == "target_offline"
    finally:
        engine_module.async_session_factory = original_factory
