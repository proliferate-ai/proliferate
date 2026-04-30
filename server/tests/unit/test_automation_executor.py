from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.db import engine as engine_module
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud import CloudRepoConfig
from proliferate.db.store.automation_run_claims import (
    AUTOMATION_ERROR_AGENT_NOT_CONFIGURED,
    AUTOMATION_ERROR_DISPATCH_UNCERTAIN,
    claim_cloud_automation_runs,
    heartbeat_run_claim,
    mark_run_creating_workspace,
    sweep_expired_dispatching_runs,
)
from proliferate.db.store.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_RUN_STATUS_DISPATCHING,
    create_manual_run_for_user,
)
from proliferate.server.automations.worker import _parse_args


def test_cloud_executor_cli_rejects_non_positive_values() -> None:
    with pytest.raises(SystemExit):
        _parse_args(["--role", "cloud-executor", "--cloud-concurrency", "0"])


def test_cloud_executor_cli_accepts_stable_executor_id() -> None:
    args = _parse_args(["--role", "cloud-executor", "--cloud-executor-id", "cloud:worker-a"])

    assert args.cloud_executor_id == "cloud:worker-a"


async def _create_cloud_automation(user_id: uuid.UUID, now: datetime) -> uuid.UUID:
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
            model_id="gpt-5.4",
            mode_id="code",
            reasoning_effort="medium",
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


@pytest.mark.asyncio
async def test_manual_run_snapshots_inputs_and_claim_uses_snapshot(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_cloud_automation(user_id, now)
        run = await create_manual_run_for_user(user_id=user_id, automation_id=automation_id)
        assert run is not None

        async with engine_module.async_session_factory() as session:
            automation = await session.get(Automation, automation_id)
            assert automation is not None
            automation.prompt = "Edited prompt"
            automation.agent_kind = "claude"
            await session.commit()

        claims = await claim_cloud_automation_runs(
            executor_id="executor-1",
            claim_ttl=timedelta(minutes=5),
            limit=1,
            now=now,
        )

        assert len(claims) == 1
        claim = claims[0]
        assert claim.prompt == "Original prompt"
        assert claim.agent_kind == "codex"
        assert claim.model_id == "gpt-5.4"
        assert claim.mode_id == "code"
        assert claim.reasoning_effort == "medium"
        assert claim.git_owner == "proliferate-ai"
        assert claim.git_repo_name == "proliferate"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_claim_cloud_run_without_agent_snapshot_fails_at_claim_time(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_cloud_automation(user_id, now)
        run = await create_manual_run_for_user(user_id=user_id, automation_id=automation_id)
        assert run is not None

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run.id)
            assert record is not None
            record.agent_kind_snapshot = None
            await session.commit()

        claims = await claim_cloud_automation_runs(
            executor_id="executor-1",
            claim_ttl=timedelta(minutes=5),
            limit=1,
            now=now,
        )

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run.id)
            assert record is not None

        assert claims == []
        assert record.status == "failed"
        assert record.last_error_code == AUTOMATION_ERROR_AGENT_NOT_CONFIGURED
        assert record.claim_id is None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_stale_claim_cannot_mutate_after_reclaim(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_cloud_automation(user_id, now)
        run = await create_manual_run_for_user(user_id=user_id, automation_id=automation_id)
        assert run is not None

        first = (
            await claim_cloud_automation_runs(
                executor_id="executor-1",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]
        second = (
            await claim_cloud_automation_runs(
                executor_id="executor-2",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now + timedelta(minutes=6),
            )
        )[0]

        assert second.claim_id != first.claim_id
        stale_heartbeat = await heartbeat_run_claim(
            run_id=first.id,
            claim_id=first.claim_id,
            claim_ttl=timedelta(minutes=5),
            now=now + timedelta(minutes=6, seconds=1),
        )
        stale_transition = await mark_run_creating_workspace(
            run_id=first.id,
            claim_id=first.claim_id,
            now=now + timedelta(minutes=6, seconds=1),
        )

        assert stale_heartbeat is None
        assert stale_transition is None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_expired_dispatching_run_is_swept_to_failed(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_cloud_automation(user_id, now)
        run = await create_manual_run_for_user(user_id=user_id, automation_id=automation_id)
        assert run is not None
        claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-1",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, claim.id)
            assert record is not None
            record.status = AUTOMATION_RUN_STATUS_DISPATCHING
            record.claim_expires_at = now - timedelta(seconds=1)
            await session.commit()

        swept = await sweep_expired_dispatching_runs(now=now)

        async with engine_module.async_session_factory() as session:
            record = (
                await session.execute(select(AutomationRun).where(AutomationRun.id == claim.id))
            ).scalar_one()

        assert swept == 1
        assert record.status == "failed"
        assert record.last_error_code == AUTOMATION_ERROR_DISPATCH_UNCERTAIN
        assert record.claim_id is None
        assert record.executor_id is None
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_expired_dispatching_sweep_is_bounded_and_ordered(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_cloud_automation(user_id, now)
        first_run = await create_manual_run_for_user(
            user_id=user_id,
            automation_id=automation_id,
        )
        second_run = await create_manual_run_for_user(
            user_id=user_id,
            automation_id=automation_id,
        )
        assert first_run is not None
        assert second_run is not None
        claims = await claim_cloud_automation_runs(
            executor_id="executor-1",
            claim_ttl=timedelta(minutes=5),
            limit=2,
            now=now,
        )
        assert len(claims) == 2

        claims_by_id = {claim.id: claim for claim in claims}
        first_claim = claims_by_id[first_run.id]
        second_claim = claims_by_id[second_run.id]
        async with engine_module.async_session_factory() as session:
            first_record = await session.get(AutomationRun, first_claim.id)
            second_record = await session.get(AutomationRun, second_claim.id)
            assert first_record is not None
            assert second_record is not None
            first_record.status = AUTOMATION_RUN_STATUS_DISPATCHING
            first_record.claim_expires_at = now - timedelta(minutes=2)
            second_record.status = AUTOMATION_RUN_STATUS_DISPATCHING
            second_record.claim_expires_at = now - timedelta(minutes=1)
            await session.commit()

        swept = await sweep_expired_dispatching_runs(now=now, limit=1)

        async with engine_module.async_session_factory() as session:
            first_record = await session.get(AutomationRun, first_claim.id)
            second_record = await session.get(AutomationRun, second_claim.id)
            assert first_record is not None
            assert second_record is not None

        assert swept == 1
        assert first_record.status == "failed"
        assert first_record.last_error_code == AUTOMATION_ERROR_DISPATCH_UNCERTAIN
        assert second_record.status == AUTOMATION_RUN_STATUS_DISPATCHING
        assert second_record.claim_id == second_claim.claim_id
    finally:
        engine_module.async_session_factory = original_factory
