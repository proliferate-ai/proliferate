from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.cloud import CloudRepoConfig
from proliferate.server.automations import service as automation_service
from proliferate.server.automations.models import (
    AutomationScheduleRequest,
    CreateAutomationRequest,
)


@pytest.mark.asyncio
async def test_create_automation_bootstraps_repo_config(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    monkeypatch.setattr(automation_service.settings, "automations_enabled", True)
    monkeypatch.setattr(
        automation_service,
        "utcnow",
        lambda: datetime(2026, 4, 20, 12, 0, tzinfo=UTC),
    )
    user_id = uuid.uuid4()

    try:
        response = await automation_service.create_automation(
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
