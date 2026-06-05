from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.background.config import (
    AUTOMATIONS_EXECUTE_RUN_TASK,
    AUTOMATIONS_EXECUTION_QUEUE,
)
from proliferate.constants.cloud import CloudTargetKind, CloudTargetStatus
from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation
from proliferate.db.models.auth import User
from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
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


async def _create_agent_run_config(
    session,  # type: ignore[no-untyped-def]
    *,
    user_id: uuid.UUID,
    agent_kind: str = "codex",
    model_id: str = "gpt-5.4",
    control_values: dict[str, object] | None = None,
) -> CloudAgentRunConfig:
    config = CloudAgentRunConfig(
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        name="Automation test config",
        agent_kind=agent_kind,
        model_id=model_id,
        control_values_json=control_values or {"mode": "auto", "effort": "medium"},
        usable_in_personal_sandboxes=True,
        usable_in_shared_sandboxes=False,
        seed_key=None,
        system_default_rank=None,
        status="active",
    )
    session.add(config)
    await session.flush()
    return config


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
            run_config = await _create_agent_run_config(session, user_id=user_id)
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
                    targetMode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloudAgentRunConfigId=run_config.id,
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
            run_config = await _create_agent_run_config(session, user_id=user_id)
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
                    targetMode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloudAgentRunConfigId=run_config.id,
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
async def test_resume_cloud_automation_with_run_config(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    automation_id = uuid.uuid4()
    repo_config_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            await _add_user(session, user_id, email="automation-resume@example.com")
            session.add(
                CloudRepoConfig(
                    id=repo_config_id,
                    owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                    user_id=user_id,
                    git_owner="proliferate-ai",
                    git_repo_name="proliferate",
                    configured=True,
                )
            )
            await session.flush()
            run_config = await _create_agent_run_config(session, user_id=user_id)
            session.add(
                Automation(
                    id=automation_id,
                    owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                    owner_user_id=user_id,
                    organization_id=None,
                    created_by_user_id=user_id,
                    cloud_repo_config_id=repo_config_id,
                    title="Daily check",
                    prompt="Check the repo.",
                    schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                    schedule_timezone="UTC",
                    schedule_summary="Daily at 09:00 UTC",
                    target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloud_agent_run_config_id=run_config.id,
                    enabled=False,
                    paused_at=datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
                    next_run_at=None,
                )
            )
            await session.commit()

        async with engine_module.async_session_factory() as session:
            resumed = await automation_service.resume_automation(session, user_id, automation_id)

        assert resumed.enabled is True
        assert resumed.next_run_at is not None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_create_cloud_automation_requires_run_config(
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
                        targetMode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                        cloudAgentRunConfigId=uuid.uuid4(),
                    ),
                )

        assert exc.value.code == "agent_run_config_not_found"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_snapshots_selected_run_config(
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
            run_config = await _create_agent_run_config(session, user_id=user_id)

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
                    targetMode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloudAgentRunConfigId=run_config.id,
                ),
            )
            run = await automation_service.run_automation_now(session, user_id, automation.id)

        async with engine_module.async_session_factory() as session:
            outbox_task = (
                await session.execute(
                    select(BackgroundOutboxTask).where(
                        BackgroundOutboxTask.idempotency_key
                        == f"{AUTOMATIONS_EXECUTE_RUN_TASK}:{run.id}"
                    )
                )
            ).scalar_one()

        assert automation.cloud_agent_run_config_id == run_config.id
        assert run.agent_run_config_snapshot_json is not None
        assert run.agent_run_config_snapshot_json["config_id"] == str(run_config.id)
        assert run.agent_kind == "codex"
        assert run.model_id == "gpt-5.4"
        assert outbox_task.task_name == AUTOMATIONS_EXECUTE_RUN_TASK
        assert outbox_task.queue == AUTOMATIONS_EXECUTION_QUEUE
        assert outbox_task.status == "pending"
        assert outbox_task.idempotency_key == f"{AUTOMATIONS_EXECUTE_RUN_TASK}:{run.id}"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_automation_uses_personal_cloud_target_mode_default(
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
            run_config = await _create_agent_run_config(session, user_id=user_id)

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
                    cloudAgentRunConfigId=run_config.id,
                ),
            )
            run = await automation_service.run_automation_now(session, user_id, automation.id)

        assert automation.target_mode == AUTOMATION_TARGET_MODE_PERSONAL_CLOUD
        assert run.target_mode == AUTOMATION_TARGET_MODE_PERSONAL_CLOUD
        assert run.agent_run_config_snapshot_json is not None
        assert run.agent_run_config_snapshot_json["config_id"] == str(run_config.id)
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_manual_run_for_existing_automation_uses_current_run_config(
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
            session.add(
                CloudRepoConfig(
                    id=repo_config_id,
                    owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                    user_id=user_id,
                    git_owner="proliferate-ai",
                    git_repo_name="proliferate",
                    configured=True,
                )
            )
            await session.flush()
            run_config = await _create_agent_run_config(session, user_id=user_id)
            session.add(
                Automation(
                    id=automation_id,
                    owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                    owner_user_id=user_id,
                    organization_id=None,
                    created_by_user_id=user_id,
                    cloud_repo_config_id=repo_config_id,
                    title="Existing automation",
                    prompt="Check the repo.",
                    schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                    schedule_timezone="UTC",
                    schedule_summary="Daily at 09:00 UTC",
                    target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloud_agent_run_config_id=run_config.id,
                    enabled=True,
                    paused_at=None,
                    next_run_at=None,
                    last_scheduled_at=None,
                )
            )

            run = await automation_service.run_automation_now(session, user_id, automation_id)

        assert run.agent_run_config_snapshot_json is not None
        assert run.agent_run_config_snapshot_json["config_id"] == str(run_config.id)
        assert run.agent_kind == "codex"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_personal_automation_rejects_shared_cloud_target_mode(
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
            run_config = await _create_agent_run_config(session, user_id=user_id)

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
                        targetMode="shared_cloud",
                        cloudAgentRunConfigId=run_config.id,
                    ),
                )

        assert exc.value.code == "automation_invalid_field"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_create_automation_rejects_run_config_not_usable_for_personal_cloud(
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
            run_config = await _create_agent_run_config(session, user_id=user_id)
            run_config.usable_in_personal_sandboxes = False
            await session.flush()

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
                        targetMode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                        cloudAgentRunConfigId=run_config.id,
                    ),
                )

        assert exc.value.code == "agent_run_config_not_usable"
    finally:
        engine_module.async_session_factory = original_factory
