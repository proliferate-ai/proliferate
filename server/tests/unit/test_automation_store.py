from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import AUTOMATION_EXECUTION_TARGET_CLOUD
from proliferate.constants.automations import AUTOMATION_RUN_STATUS_QUEUED
from proliferate.constants.automations import AUTOMATION_RUN_TRIGGER_SCHEDULED
from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.automations import (
    AutomationScheduleAdvance,
    create_due_scheduled_runs_batch,
)


@pytest.mark.asyncio
async def test_due_scheduler_disables_bad_schedule_and_continues_batch(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            good_repo = CloudRepoConfig(
                user_id=user_id,
                git_owner="proliferate-ai",
                git_repo_name="good",
                configured=True,
                configured_at=now,
                default_branch="main",
                env_vars_ciphertext="",
                env_vars_version=0,
                setup_script="",
                setup_script_version=0,
                files_version=0,
                created_at=now,
                updated_at=now,
            )
            bad_repo = CloudRepoConfig(
                user_id=user_id,
                git_owner="proliferate-ai",
                git_repo_name="bad",
                configured=True,
                configured_at=now,
                default_branch="main",
                env_vars_ciphertext="",
                env_vars_version=0,
                setup_script="",
                setup_script_version=0,
                files_version=0,
                created_at=now,
                updated_at=now,
            )
            session.add_all([good_repo, bad_repo])
            await session.flush()
            good_automation = Automation(
                user_id=user_id,
                cloud_repo_config_id=good_repo.id,
                title="Good",
                prompt="Run good",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                schedule_timezone="UTC",
                schedule_summary="Hourly at :00 in UTC",
                execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
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
            bad_automation = Automation(
                user_id=user_id,
                cloud_repo_config_id=bad_repo.id,
                title="Bad",
                prompt="Run bad",
                schedule_rrule="bad",
                schedule_timezone="UTC",
                schedule_summary="Bad",
                execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
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
            session.add_all([good_automation, bad_automation])
            await session.commit()
            good_id = good_automation.id
            bad_id = bad_automation.id

        def _advance(fields, _now):  # type: ignore[no-untyped-def]
            if fields.schedule_rrule == "bad":
                raise ValueError("invalid schedule")
            return AutomationScheduleAdvance(
                scheduled_for=now,
                next_run_at=now + timedelta(hours=1),
            )

        async with engine_module.async_session_factory() as session, session.begin():
            created = await create_due_scheduled_runs_batch(
                session,
                now=now,
                limit=10,
                schedule_advance_resolver=_advance,
            )

        async with engine_module.async_session_factory() as session:
            good = await session.get(Automation, good_id)
            bad = await session.get(Automation, bad_id)
            runs = list(
                (
                    await session.execute(
                        select(AutomationRun).order_by(AutomationRun.created_at.asc())
                    )
                )
                .scalars()
                .all()
            )

        assert created == 1
        assert good is not None
        assert good.last_scheduled_at == now
        assert good.next_run_at == now + timedelta(hours=1)
        assert bad is not None
        assert bad.enabled is False
        assert bad.paused_at == now
        assert bad.next_run_at is None
        assert [run.automation_id for run in runs] == [good_id]
        assert runs[0].title_snapshot == "Good"
        assert runs[0].prompt_snapshot == "Run good"
        assert runs[0].git_owner_snapshot == "proliferate-ai"
        assert runs[0].git_repo_name_snapshot == "good"
        assert runs[0].agent_kind_snapshot == "codex"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_due_scheduler_advances_after_duplicate_scheduled_slot(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            repo = CloudRepoConfig(
                user_id=user_id,
                git_owner="proliferate-ai",
                git_repo_name="duplicate-slot",
                configured=True,
                configured_at=now,
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
                title="Duplicate slot",
                prompt="Run once",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                schedule_timezone="UTC",
                schedule_summary="Hourly at :00 in UTC",
                execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
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
            await session.flush()
            duplicate_run = AutomationRun(
                automation_id=automation.id,
                user_id=user_id,
                trigger_kind=AUTOMATION_RUN_TRIGGER_SCHEDULED,
                scheduled_for=now,
                execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
                status=AUTOMATION_RUN_STATUS_QUEUED,
                title_snapshot=automation.title,
                prompt_snapshot=automation.prompt,
                git_provider_snapshot="github",
                git_owner_snapshot=repo.git_owner,
                git_repo_name_snapshot=repo.git_repo_name,
                cloud_repo_config_id_snapshot=repo.id,
                agent_kind_snapshot=automation.agent_kind,
                model_id_snapshot=automation.model_id,
                mode_id_snapshot=automation.mode_id,
                reasoning_effort_snapshot=automation.reasoning_effort,
                executor_kind=None,
                executor_id=None,
                claim_id=None,
                claimed_at=None,
                claim_expires_at=None,
                last_heartbeat_at=None,
                dispatch_started_at=None,
                dispatched_at=None,
                failed_at=None,
                cloud_workspace_id=None,
                anyharness_workspace_id=None,
                anyharness_session_id=None,
                cancelled_at=None,
                last_error_code=None,
                last_error_message=None,
                created_at=now,
                updated_at=now,
            )
            session.add(duplicate_run)
            await session.commit()
            automation_id = automation.id

        def _advance(fields, _now):  # type: ignore[no-untyped-def]
            return AutomationScheduleAdvance(
                scheduled_for=fields.next_run_at,
                next_run_at=now + timedelta(hours=1),
            )

        async with engine_module.async_session_factory() as session, session.begin():
            created = await create_due_scheduled_runs_batch(
                session,
                now=now,
                limit=10,
                schedule_advance_resolver=_advance,
            )

        async with engine_module.async_session_factory() as session:
            automation = await session.get(Automation, automation_id)
            runs = list(
                (
                    await session.execute(
                        select(AutomationRun).where(AutomationRun.automation_id == automation_id)
                    )
                )
                .scalars()
                .all()
            )

        assert created == 0
        assert automation is not None
        assert automation.next_run_at == now + timedelta(hours=1)
        assert automation.last_scheduled_at is None
        assert len(runs) == 1
        assert runs[0].scheduled_for == now
    finally:
        engine_module.async_session_factory = original_factory
