from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_QUEUED,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.automations import create_manual_run_for_user
from proliferate.server.automations.local_executor_service import (
    claim_local_runs as claim_local_runs_service,
)
from proliferate.server.automations.models import (
    LocalAutomationClaimRequest,
    LocalExecutorRepositoryIdentity,
)


async def _create_local_automation(user_id: uuid.UUID, now: datetime) -> uuid.UUID:
    async with engine_module.async_session_factory() as session:
        repo = CloudRepoConfig(
            user_id=user_id,
            git_owner="Proliferate-AI",
            git_repo_name="Proliferate",
            configured=False,
            configured_at=None,
            default_branch="main",
            env_vars_ciphertext="",
            env_vars_version=0,
            setup_script="",
            setup_script_version=0,
            files_version=0,
            created_at=now,
            updated_at=now,
        )
        session.add(repo)
        await session.flush()
        automation = Automation(
            user_id=user_id,
            cloud_repo_config_id=repo.id,
            title="Local check",
            prompt="Check locally",
            schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            schedule_timezone="UTC",
            schedule_summary="Daily at 09:00 in UTC",
            execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
            agent_kind="codex",
            model_id=None,
            mode_id=None,
            reasoning_effort=None,
            enabled=True,
            paused_at=None,
            next_run_at=now,
            last_scheduled_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(automation)
        await session.commit()
        return automation.id


async def _create_manual_run(user_id: uuid.UUID, automation_id: uuid.UUID):
    async with engine_module.async_session_factory() as session:
        run = await create_manual_run_for_user(
            session,
            user_id=user_id,
            automation_id=automation_id,
        )
        await session.commit()
        return run


@pytest.mark.asyncio
async def test_local_claim_service_uses_request_scoped_db_session(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_local_automation(user_id, now)
        run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        assert run is not None

        request = LocalAutomationClaimRequest(
            executor_id="desktop-1",
            available_repositories=[
                LocalExecutorRepositoryIdentity(
                    provider="github",
                    owner="proliferate-ai",
                    name="proliferate",
                )
            ],
            limit=1,
        )
        async with engine_module.async_session_factory() as request_db:
            response = await claim_local_runs_service(request_db, user_id, request)
            assert len(response.runs) == 1

            async with engine_module.async_session_factory() as observer:
                uncommitted_record = await observer.get(AutomationRun, run.id)
                assert uncommitted_record is not None
                assert uncommitted_record.status == AUTOMATION_RUN_STATUS_QUEUED
                assert uncommitted_record.claim_id is None

            await request_db.commit()

        async with engine_module.async_session_factory() as observer:
            committed_record = await observer.get(AutomationRun, run.id)
            assert committed_record is not None
            assert committed_record.status == AUTOMATION_RUN_STATUS_CLAIMED
            assert committed_record.claim_id == uuid.UUID(response.runs[0].claim_id)
    finally:
        engine_module.async_session_factory = original_factory
