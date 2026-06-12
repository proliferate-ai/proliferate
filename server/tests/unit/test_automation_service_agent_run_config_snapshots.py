from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.server.automations import service as automation_service
from proliferate.server.automations.models import (
    AutomationScheduleRequest,
    CreateAutomationRequest,
)


async def _add_user(session, user_id: uuid.UUID) -> None:  # type: ignore[no-untyped-def]
    session.add(
        User(
            id=user_id,
            email=f"automation-alias-{user_id}@example.com",
            hashed_password="!",
            is_active=True,
            is_superuser=False,
            is_verified=True,
        )
    )
    await session.flush()


async def _create_run_config(session, user_id: uuid.UUID) -> CloudAgentRunConfig:  # type: ignore[no-untyped-def]
    config = CloudAgentRunConfig(
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        name="Cursor canonical config",
        agent_kind="cursor",
        model_id="gpt-5.3-codex",
        control_values_json={},
        usable_in_personal_sandboxes=True,
        usable_in_shared_sandboxes=False,
        seed_key=None,
        system_default_rank=None,
        status="active",
    )
    session.add(config)
    await session.flush()
    return config


@pytest.mark.asyncio
async def test_manual_run_snapshot_resolves_canonical_model_id(
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
            await _add_user(session, user_id)
            run_config = await _create_run_config(session, user_id)
            automation = await automation_service.create_automation(
                session,
                user_id,
                CreateAutomationRequest(
                    title="Cursor check",
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

        assert run.agent_run_config_snapshot_json is not None
        assert run.agent_run_config_snapshot_json["model_id"] == "gpt-5.3-codex"
        assert run.model_id == "gpt-5.3-codex"
    finally:
        engine_module.async_session_factory = original_factory
