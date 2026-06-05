from datetime import UTC, datetime
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_QUEUED,
    AUTOMATION_TARGET_MODE_LOCAL,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.automation_runs import create_manual_run_for_user
from proliferate.server.automations.local_executor import (
    claim_local_runs as claim_local_runs_service,
)
from proliferate.server.automations.models import (
    LocalAutomationClaimRequest,
    LocalExecutorRepositoryIdentity,
)


def _agent_snapshot(config: CloudAgentRunConfig) -> dict[str, object]:
    return {
        "config_id": str(config.id),
        "config_name": config.name,
        "agent_kind": config.agent_kind,
        "model_id": config.model_id,
        "control_values": dict(config.control_values_json or {}),
        "owner_scope_at_snapshot": config.owner_scope,
    }


async def _create_local_automation(user_id: uuid.UUID, now: datetime) -> uuid.UUID:
    async with engine_module.async_session_factory() as session:
        session.add(
            User(
                id=user_id,
                email=f"automation-local-threading-{user_id}@example.com",
                hashed_password="!",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            )
        )
        await session.flush()
        repo = CloudRepoConfig(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
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
        run_config = CloudAgentRunConfig(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
            owner_user_id=user_id,
            organization_id=None,
            created_by_user_id=user_id,
            name="Local automation config",
            agent_kind="codex",
            model_id="auto",
            control_values_json={},
            usable_in_personal_sandboxes=True,
            usable_in_shared_sandboxes=False,
            seed_key=None,
            system_default_rank=None,
            status="active",
            archived_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(run_config)
        await session.flush()
        automation = Automation(
            owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
            owner_user_id=user_id,
            organization_id=None,
            created_by_user_id=user_id,
            cloud_repo_config_id=repo.id,
            title="Local check",
            prompt="Check locally",
            schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            schedule_timezone="UTC",
            schedule_summary="Daily at 09:00 in UTC",
            target_mode=AUTOMATION_TARGET_MODE_LOCAL,
            cloud_agent_run_config_id=run_config.id,
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
        automation = await session.get(Automation, automation_id)
        assert automation is not None
        run_config = await session.get(CloudAgentRunConfig, automation.cloud_agent_run_config_id)
        assert run_config is not None
        run = await create_manual_run_for_user(
            session,
            user_id=user_id,
            automation_id=automation_id,
            agent_run_config_snapshot_json=_agent_snapshot(run_config),
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
