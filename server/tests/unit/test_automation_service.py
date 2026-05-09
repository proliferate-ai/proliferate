from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.errors import ProliferateError
from proliferate.server.automations import service as automation_service
from proliferate.server.automations.errors import AutomationAgentRequired, AutomationServiceError
from proliferate.server.automations.models import (
    AutomationScheduleRequest,
    CreateAutomationRequest,
)


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
        async with engine_module.async_session_factory() as session:
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
                    agentKind="codex",
                ),
            )
            await session.commit()

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
            with pytest.raises(AutomationAgentRequired) as exc:
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
        async with engine_module.async_session_factory() as session:
            with pytest.raises(AutomationAgentRequired) as exc:
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
                    ),
                )

        assert exc.value.code == "automation_agent_required"
    finally:
        engine_module.async_session_factory = original_factory
