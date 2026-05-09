from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_TRIGGER_MANUAL,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.server.automations.domain.claim_lifecycle import (
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
)
from proliferate.server.automations.worker import service as worker_service


@pytest.mark.asyncio
async def test_scheduler_tick_commits_sweep_before_due_batch_failure(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    async def _fail_due_batch(*args, **kwargs) -> int:  # type: ignore[no-untyped-def]
        raise RuntimeError("due batch failed")

    monkeypatch.setattr(worker_service, "utcnow", lambda: now)
    monkeypatch.setattr(worker_service, "create_due_scheduled_runs_batch", _fail_due_batch)

    try:
        async with engine_module.async_session_factory() as session:
            repo = CloudRepoConfig(
                user_id=user_id,
                git_owner="proliferate-ai",
                git_repo_name="proliferate",
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
                title="Daily check",
                prompt="Original prompt",
                schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                schedule_timezone="UTC",
                schedule_summary="Daily at 09:00 in UTC",
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
            run = AutomationRun(
                automation_id=automation.id,
                user_id=user_id,
                trigger_kind=AUTOMATION_RUN_TRIGGER_MANUAL,
                scheduled_for=None,
                execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
                status=AUTOMATION_RUN_STATUS_DISPATCHING,
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
                executor_kind="cloud",
                executor_id="executor-1",
                claim_id=uuid.uuid4(),
                claimed_at=now - timedelta(minutes=10),
                claim_expires_at=now - timedelta(seconds=1),
                last_heartbeat_at=now - timedelta(minutes=10),
                dispatch_started_at=now - timedelta(minutes=5),
                dispatched_at=None,
                failed_at=None,
                cloud_workspace_id=None,
                anyharness_workspace_id=None,
                anyharness_session_id=None,
                cancelled_at=None,
                last_error_code=None,
                last_error_message=None,
                created_at=now - timedelta(minutes=10),
                updated_at=now - timedelta(minutes=10),
            )
            session.add(run)
            await session.commit()
            run_id = run.id

        with pytest.raises(RuntimeError, match="due batch failed"):
            await worker_service.run_scheduler_tick(
                session_factory=engine_module.async_session_factory,
                batch_size=1,
            )

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run_id)

        assert record is not None
        assert record.status == "failed"
        assert record.failed_at == now
        assert record.last_error_code == AUTOMATION_ERROR_DISPATCH_UNCERTAIN
        assert record.claim_id is None
        assert record.executor_id is None
    finally:
        engine_module.async_session_factory = original_factory
