from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    AUTOMATION_RUN_TRIGGER_MANUAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.constants.cloud import GitProvider, RepoEnvironmentKind
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.store.cloud_agent_run_config import CloudAgentRunConfigRecord
from proliferate.server.automations.domain.claim_lifecycle import (
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
)
from proliferate.server.automations.worker import service as worker_service
from proliferate.server.cloud.errors import CloudApiError


def _run_config_record(*, user_id: uuid.UUID) -> CloudAgentRunConfigRecord:
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    return CloudAgentRunConfigRecord(
        id=uuid.uuid4(),
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        name="Retired model config",
        agent_kind="codex",
        model_id="retired-model",
        control_values_json={},
        usable_in_personal_sandboxes=True,
        usable_in_shared_sandboxes=False,
        seed_key=None,
        system_default_rank=None,
        status="active",
        created_at=now,
        updated_at=now,
        archived_at=None,
    )


async def _create_cloud_repo_environment(  # type: ignore[no-untyped-def]
    session,
    *,
    user_id: uuid.UUID,
    now: datetime,
) -> RepoEnvironment:
    repo_config = RepoConfig(
        user_id=user_id,
        git_provider=GitProvider.github,
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        created_at=now,
        updated_at=now,
    )
    session.add(repo_config)
    await session.flush()
    repo_environment = RepoEnvironment(
        repo_config_id=repo_config.id,
        environment_kind=RepoEnvironmentKind.cloud,
        desktop_install_id=None,
        local_path=None,
        default_branch="main",
        setup_script="",
        run_command="",
        created_at=now,
        updated_at=now,
    )
    session.add(repo_environment)
    await session.flush()
    return repo_environment


def test_scheduled_snapshot_wrapper_skips_cloud_api_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid.uuid4()

    def _raise_cloud_api_error(_config: CloudAgentRunConfigRecord) -> dict[str, object]:
        raise CloudApiError(
            "model_unavailable",
            "Model is not available for this agent.",
            status_code=400,
        )

    monkeypatch.setattr(
        worker_service,
        "agent_run_config_snapshot_json",
        _raise_cloud_api_error,
    )

    assert (
        worker_service._scheduled_agent_run_config_snapshot_json(
            _run_config_record(user_id=user_id),
        )
        is None
    )


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
            session.add(
                User(
                    id=user_id,
                    email=f"automation-worker-scheduler-{user_id}@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            repo_environment = await _create_cloud_repo_environment(
                session,
                user_id=user_id,
                now=now,
            )
            run_config = CloudAgentRunConfig(
                owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                name="Automation worker scheduler config",
                agent_kind="codex",
                model_id="gpt-5.4",
                control_values_json={},
                usable_in_personal_sandboxes=True,
                usable_in_shared_sandboxes=False,
                seed_key=None,
                system_default_rank=None,
                status="active",
            )
            session.add(run_config)
            await session.flush()
            automation = Automation(
                owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                repo_environment_id=repo_environment.id,
                title="Daily check",
                prompt="Original prompt",
                schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
                schedule_timezone="UTC",
                schedule_summary="Daily at 09:00 in UTC",
                target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                cloud_agent_run_config_id=run_config.id,
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
                owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                trigger_kind=AUTOMATION_RUN_TRIGGER_MANUAL,
                scheduled_for=None,
                target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                status=AUTOMATION_RUN_STATUS_DISPATCHING,
                title_snapshot=automation.title,
                prompt_snapshot=automation.prompt,
                git_provider_snapshot="github",
                git_owner_snapshot="proliferate-ai",
                git_repo_name_snapshot="proliferate",
                repo_environment_id_snapshot=repo_environment.id,
                agent_run_config_snapshot_json={
                    "config_id": str(run_config.id),
                    "config_name": run_config.name,
                    "agent_kind": run_config.agent_kind,
                    "model_id": run_config.model_id,
                    "control_values": {},
                    "owner_scope_at_snapshot": run_config.owner_scope,
                },
                cascade_attempt=0,
                last_cascade_command_id=None,
                last_cascade_reason=None,
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


@pytest.mark.asyncio
async def test_scheduler_tick_creates_cloud_run_without_legacy_outbox(
    monkeypatch: pytest.MonkeyPatch,
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()
    monkeypatch.setattr(worker_service, "utcnow", lambda: now)

    try:
        async with engine_module.async_session_factory() as session:
            session.add(
                User(
                    id=user_id,
                    email=f"automation-worker-outbox-{user_id}@example.com",
                    hashed_password="!",
                    is_active=True,
                    is_superuser=False,
                    is_verified=True,
                )
            )
            await session.flush()
            repo_environment = await _create_cloud_repo_environment(
                session,
                user_id=user_id,
                now=now,
            )
            run_config = CloudAgentRunConfig(
                owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                name="Automation worker outbox config",
                agent_kind="codex",
                model_id="gpt-5.4",
                control_values_json={},
                usable_in_personal_sandboxes=True,
                usable_in_shared_sandboxes=False,
                seed_key=None,
                system_default_rank=None,
                status="active",
            )
            session.add(run_config)
            await session.flush()
            session.add(
                Automation(
                    owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                    owner_user_id=user_id,
                    organization_id=None,
                    created_by_user_id=user_id,
                    repo_environment_id=repo_environment.id,
                    title="Daily check",
                    prompt="Original prompt",
                    schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=12;BYMINUTE=0",
                    schedule_timezone="UTC",
                    schedule_summary="Daily at 12:00 in UTC",
                    target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                    cloud_agent_run_config_id=run_config.id,
                    enabled=True,
                    paused_at=None,
                    next_run_at=now,
                    last_scheduled_at=None,
                    created_at=now,
                    updated_at=now,
                )
            )
            await session.commit()

        result = await worker_service.run_scheduler_tick(
            session_factory=engine_module.async_session_factory,
            batch_size=1,
        )

        async with engine_module.async_session_factory() as session:
            run = (await session.execute(select(AutomationRun))).scalar_one()

        assert result.created_runs == 1
        assert run.repo_environment_id_snapshot == repo_environment.id
    finally:
        engine_module.async_session_factory = original_factory
