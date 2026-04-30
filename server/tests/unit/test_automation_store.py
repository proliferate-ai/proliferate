from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud import CloudRepoConfig
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
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

        created = await create_due_scheduled_runs_batch(
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
    finally:
        engine_module.async_session_factory = original_factory
