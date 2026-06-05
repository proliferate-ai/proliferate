from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_STATUS_QUEUED,
    AUTOMATION_RUN_TRIGGER_SCHEDULED,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.store.cloud_agent_run_config import CloudAgentRunConfigRecord
from proliferate.db.store.automation_runs import (
    AutomationScheduleAdvance,
    create_due_scheduled_runs_batch,
)


async def _create_user(session, *, user_id: uuid.UUID) -> None:  # type: ignore[no-untyped-def]
    session.add(
        User(
            id=user_id,
            email=f"automation-store-{user_id}@example.com",
            hashed_password="!",
            is_active=True,
            is_superuser=False,
            is_verified=True,
        )
    )
    await session.flush()


async def _create_run_config(  # type: ignore[no-untyped-def]
    session,
    *,
    user_id: uuid.UUID,
    agent_kind: str = "codex",
    model_id: str = "gpt-5.4",
) -> CloudAgentRunConfig:
    config = CloudAgentRunConfig(
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        name="Automation store config",
        agent_kind=agent_kind,
        model_id=model_id,
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


def _automation_row(
    *,
    user_id: uuid.UUID,
    repo_id: uuid.UUID,
    run_config_id: uuid.UUID,
    title: str,
    prompt: str,
    schedule_rrule: str,
    next_run_at: datetime,
) -> Automation:
    return Automation(
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        cloud_repo_config_id=repo_id,
        title=title,
        prompt=prompt,
        schedule_rrule=schedule_rrule,
        schedule_timezone="UTC",
        schedule_summary="Hourly at :00 in UTC",
        target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        cloud_agent_run_config_id=run_config_id,
        enabled=True,
        paused_at=None,
        next_run_at=next_run_at,
        last_scheduled_at=None,
        created_at=next_run_at,
        updated_at=next_run_at,
    )


def _repo_row(
    *,
    user_id: uuid.UUID,
    git_repo_name: str,
    now: datetime,
    configured: bool = True,
) -> CloudRepoConfig:
    return CloudRepoConfig(
        owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
        user_id=user_id,
        git_owner="proliferate-ai",
        git_repo_name=git_repo_name,
        configured=configured,
        configured_at=now if configured else None,
        default_branch="main",
        env_vars_ciphertext="",
        env_vars_version=0,
        setup_script="",
        setup_script_version=0,
        files_version=0,
        created_at=now,
        updated_at=now,
    )


def _agent_snapshot(
    config: CloudAgentRunConfig | CloudAgentRunConfigRecord,
) -> dict[str, object]:
    return {
        "config_id": str(config.id),
        "config_name": config.name,
        "agent_kind": config.agent_kind,
        "model_id": config.model_id,
        "control_values": dict(config.control_values_json or {}),
        "owner_scope_at_snapshot": config.owner_scope,
    }


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
            await _create_user(session, user_id=user_id)
            run_config = await _create_run_config(session, user_id=user_id)
            good_repo = _repo_row(user_id=user_id, git_repo_name="good", now=now)
            bad_repo = _repo_row(user_id=user_id, git_repo_name="bad", now=now)
            session.add_all([good_repo, bad_repo])
            await session.flush()
            good_automation = _automation_row(
                user_id=user_id,
                repo_id=good_repo.id,
                run_config_id=run_config.id,
                title="Good",
                prompt="Run good",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            bad_automation = _automation_row(
                user_id=user_id,
                repo_id=bad_repo.id,
                run_config_id=run_config.id,
                title="Bad",
                prompt="Run bad",
                schedule_rrule="bad",
                next_run_at=now,
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
                agent_run_config_snapshot_builder=_agent_snapshot,
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

        assert created.created_runs == 1
        assert created.cloud_run_ids == (runs[0].id,)
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
        assert runs[0].agent_run_config_snapshot_json is not None
        assert runs[0].agent_run_config_snapshot_json["agent_kind"] == "codex"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_due_scheduler_skips_failed_snapshot_and_continues_batch(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            await _create_user(session, user_id=user_id)
            good_run_config = await _create_run_config(
                session,
                user_id=user_id,
                model_id="gpt-5.4",
            )
            bad_run_config = await _create_run_config(
                session,
                user_id=user_id,
                model_id="retired-model",
            )
            good_repo = _repo_row(user_id=user_id, git_repo_name="snapshot-good", now=now)
            bad_repo = _repo_row(user_id=user_id, git_repo_name="snapshot-bad", now=now)
            session.add_all([good_repo, bad_repo])
            await session.flush()
            good_automation = _automation_row(
                user_id=user_id,
                repo_id=good_repo.id,
                run_config_id=good_run_config.id,
                title="Good snapshot",
                prompt="Run good snapshot",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            bad_automation = _automation_row(
                user_id=user_id,
                repo_id=bad_repo.id,
                run_config_id=bad_run_config.id,
                title="Bad snapshot",
                prompt="Run bad snapshot",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            session.add_all([good_automation, bad_automation])
            await session.commit()
            good_id = good_automation.id
            bad_id = bad_automation.id

        def _advance(fields, _now):  # type: ignore[no-untyped-def]
            return AutomationScheduleAdvance(
                scheduled_for=fields.next_run_at,
                next_run_at=now + timedelta(hours=1),
            )

        def _snapshot_or_skip(
            config: CloudAgentRunConfigRecord,
        ) -> dict[str, object] | None:
            if config.model_id == "retired-model":
                return None
            return _agent_snapshot(config)

        async with engine_module.async_session_factory() as session, session.begin():
            created = await create_due_scheduled_runs_batch(
                session,
                now=now,
                limit=10,
                schedule_advance_resolver=_advance,
                agent_run_config_snapshot_builder=_snapshot_or_skip,
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

        assert created.created_runs == 1
        assert created.cloud_run_ids == (runs[0].id,)
        assert good is not None
        assert good.last_scheduled_at == now
        assert good.next_run_at == now + timedelta(hours=1)
        assert bad is not None
        assert bad.last_scheduled_at is None
        assert bad.next_run_at == now + timedelta(hours=1)
        assert [run.automation_id for run in runs] == [good_id]
        assert runs[0].agent_run_config_snapshot_json is not None
        assert runs[0].agent_run_config_snapshot_json["model_id"] == "gpt-5.4"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_due_scheduler_uses_precomputed_agent_run_config_snapshot(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            await _create_user(session, user_id=user_id)
            run_config = await _create_run_config(
                session,
                user_id=user_id,
                agent_kind="cursor",
                model_id="gpt-5.3-codex-spark-preview",
            )
            repo = _repo_row(user_id=user_id, git_repo_name="canonical", now=now)
            session.add(repo)
            await session.flush()
            automation = _automation_row(
                user_id=user_id,
                repo_id=repo.id,
                run_config_id=run_config.id,
                title="Canonical snapshot",
                prompt="Run canonical",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            session.add(automation)
            await session.commit()
            automation_id = automation.id

        def _advance(fields, _now):  # type: ignore[no-untyped-def]
            return AutomationScheduleAdvance(
                scheduled_for=fields.next_run_at,
                next_run_at=now + timedelta(hours=1),
            )

        def _canonical_snapshot(config: CloudAgentRunConfigRecord) -> dict[str, object]:
            snapshot = _agent_snapshot(config)
            snapshot["model_id"] = "gpt-5.3-codex"
            return snapshot

        async with engine_module.async_session_factory() as session, session.begin():
            created = await create_due_scheduled_runs_batch(
                session,
                now=now,
                limit=10,
                schedule_advance_resolver=_advance,
                agent_run_config_snapshot_builder=_canonical_snapshot,
            )

        async with engine_module.async_session_factory() as session:
            run = (
                await session.execute(
                    select(AutomationRun).where(AutomationRun.automation_id == automation_id)
                )
            ).scalar_one()

        assert created.created_runs == 1
        assert created.cloud_run_ids == (run.id,)
        assert run.agent_run_config_snapshot_json is not None
        assert run.agent_run_config_snapshot_json["model_id"] == "gpt-5.3-codex"
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
            await _create_user(session, user_id=user_id)
            run_config = await _create_run_config(session, user_id=user_id)
            repo = _repo_row(user_id=user_id, git_repo_name="duplicate-slot", now=now)
            session.add(repo)
            await session.flush()
            automation = _automation_row(
                user_id=user_id,
                repo_id=repo.id,
                run_config_id=run_config.id,
                title="Duplicate slot",
                prompt="Run once",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            session.add(automation)
            await session.flush()
            duplicate_run = AutomationRun(
                automation_id=automation.id,
                owner_scope=AUTOMATION_OWNER_SCOPE_PERSONAL,
                owner_user_id=user_id,
                organization_id=None,
                created_by_user_id=user_id,
                trigger_kind=AUTOMATION_RUN_TRIGGER_SCHEDULED,
                scheduled_for=now,
                target_mode=AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
                status=AUTOMATION_RUN_STATUS_QUEUED,
                title_snapshot=automation.title,
                prompt_snapshot=automation.prompt,
                git_provider_snapshot="github",
                git_owner_snapshot=repo.git_owner,
                git_repo_name_snapshot=repo.git_repo_name,
                cloud_repo_config_id_snapshot=repo.id,
                cloud_target_id_snapshot=None,
                cloud_target_kind_snapshot=None,
                sandbox_profile_id=None,
                cloud_workspace_exposure_id=None,
                agent_run_config_snapshot_json=_agent_snapshot(run_config),
                cascade_attempt=0,
                last_cascade_command_id=None,
                last_cascade_reason=None,
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
                agent_run_config_snapshot_builder=_agent_snapshot,
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

        assert created.created_runs == 0
        assert created.cloud_run_ids == ()
        assert automation is not None
        assert automation.next_run_at == now + timedelta(hours=1)
        assert automation.last_scheduled_at is None
        assert len(runs) == 1
        assert runs[0].scheduled_for == now
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_due_scheduler_skips_personal_cloud_automation_without_repo_config(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        async with engine_module.async_session_factory() as session:
            await _create_user(session, user_id=user_id)
            run_config = await _create_run_config(session, user_id=user_id)
            repo = _repo_row(
                user_id=user_id,
                git_repo_name="unconfigured",
                now=now,
                configured=False,
            )
            session.add(repo)
            await session.flush()
            automation = _automation_row(
                user_id=user_id,
                repo_id=repo.id,
                run_config_id=run_config.id,
                title="Unconfigured repo",
                prompt="Run once",
                schedule_rrule="RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
                next_run_at=now,
            )
            session.add(automation)
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
                agent_run_config_snapshot_builder=_agent_snapshot,
            )

        async with engine_module.async_session_factory() as session:
            automation = await session.get(Automation, automation_id)
            run = (
                await session.execute(
                    select(AutomationRun).where(AutomationRun.automation_id == automation_id)
                )
            ).scalar_one_or_none()

        assert created.created_runs == 0
        assert created.cloud_run_ids == ()
        assert automation is not None
        assert automation.next_run_at == now
        assert run is None
    finally:
        engine_module.async_session_factory = original_factory
