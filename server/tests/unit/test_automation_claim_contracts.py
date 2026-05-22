from datetime import UTC, datetime, timedelta
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_EXECUTION_TARGET_LOCAL,
    AUTOMATION_EXECUTOR_KIND_CLOUD,
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_STATUS_CLAIMED,
    AUTOMATION_RUN_STATUS_CREATING_SESSION,
    AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
    AUTOMATION_RUN_STATUS_DISPATCHED,
    AUTOMATION_RUN_STATUS_FAILED,
    AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
    AUTOMATION_TARGET_MODE_LOCAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.automations import Automation, AutomationRun
from proliferate.db.models.cloud.agent_run_config import CloudAgentRunConfig
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.server.automations.domain.claim_lifecycle import (
    LocalAutomationRepoIdentity,
)
from proliferate.db.store.automations import create_manual_run_for_user
from tests.unit.automation_claim_store_helpers import (
    claim_cloud_automation_runs,
    claim_local_automation_runs,
    create_cloud_workspace_for_claimed_run,
    heartbeat_run_claim,
    mark_run_creating_session,
    mark_run_creating_workspace,
    mark_run_dispatched,
    mark_run_dispatching,
    mark_run_failed,
)


def _patch_session_factory(test_engine):  # type: ignore[no-untyped-def]
    original_factory = engine_module.async_session_factory
    engine_module.async_session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    return original_factory


async def _create_automation(
    *,
    user_id: uuid.UUID,
    now: datetime,
    execution_target: str,
    git_owner: str = "proliferate-ai",
    git_repo_name: str = "proliferate",
) -> uuid.UUID:
    target_mode = (
        AUTOMATION_TARGET_MODE_LOCAL
        if execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL
        else AUTOMATION_TARGET_MODE_PERSONAL_CLOUD
    )
    async with engine_module.async_session_factory() as session:
        if await session.get(User, user_id) is None:
            session.add(
                User(
                    id=user_id,
                    email=f"automation-claim-{user_id}@example.com",
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
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            configured=execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD,
            configured_at=now if execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD else None,
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
            name=f"{execution_target} automation config",
            agent_kind="codex",
            model_id=(
                "gpt-5.4" if execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD else "auto"
            ),
            control_values_json=(
                {"mode": "code", "effort": "medium"}
                if execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD
                else {}
            ),
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
            title=f"{execution_target} automation",
            prompt="Check the repo",
            schedule_rrule="RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
            schedule_timezone="UTC",
            schedule_summary="Daily at 09:00 in UTC",
            target_mode=target_mode,
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


async def _create_manual_run(
    *,
    user_id: uuid.UUID,
    automation_id: uuid.UUID,
):
    async with engine_module.async_session_factory() as session:
        run = await create_manual_run_for_user(
            session,
            user_id=user_id,
            automation_id=automation_id,
        )
        await session.commit()
        assert run is not None
        return run


@pytest.mark.asyncio
async def test_heartbeat_only_extends_current_claim(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = _patch_session_factory(test_engine)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_automation(
            user_id=user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        )
        run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        first_claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-1",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]
        second_claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-2",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now + timedelta(minutes=6),
            )
        )[0]

        stale_heartbeat = await heartbeat_run_claim(
            run_id=run.id,
            claim_id=first_claim.claim_id,
            claim_ttl=timedelta(hours=1),
            now=now + timedelta(minutes=6, seconds=1),
        )
        current_heartbeat = await heartbeat_run_claim(
            run_id=run.id,
            claim_id=second_claim.claim_id,
            claim_ttl=timedelta(minutes=10),
            now=now + timedelta(minutes=6, seconds=2),
        )

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run.id)
            assert record is not None

        assert stale_heartbeat is None
        assert current_heartbeat is not None
        assert record.claim_id == second_claim.claim_id
        assert record.executor_id == "executor-2"
        assert record.claim_expires_at == now + timedelta(minutes=16, seconds=2)
        assert record.last_heartbeat_at == now + timedelta(minutes=6, seconds=2)
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        AUTOMATION_RUN_STATUS_CLAIMED,
        AUTOMATION_RUN_STATUS_CREATING_WORKSPACE,
        AUTOMATION_RUN_STATUS_PROVISIONING_WORKSPACE,
        AUTOMATION_RUN_STATUS_CREATING_SESSION,
    ],
)
async def test_expired_reclaimable_statuses_can_be_reclaimed(
    test_engine,  # type: ignore[no-untyped-def]
    status: str,
) -> None:
    original_factory = _patch_session_factory(test_engine)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_automation(
            user_id=user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        )
        run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        first_claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-1",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]
        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run.id)
            assert record is not None
            record.status = status
            record.claim_expires_at = now - timedelta(seconds=1)
            await session.commit()

        second_claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-2",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]

        assert second_claim.id == run.id
        assert second_claim.claim_id != first_claim.claim_id
        assert second_claim.status == AUTOMATION_RUN_STATUS_CLAIMED
        assert second_claim.executor_kind == AUTOMATION_EXECUTOR_KIND_CLOUD
        assert second_claim.executor_id == "executor-2"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_final_dispatched_and_failed_states_clear_claim_metadata(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = _patch_session_factory(test_engine)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_automation(
            user_id=user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        )
        dispatched_run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        failed_run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        dispatched_claim, failed_claim = await claim_cloud_automation_runs(
            executor_id="executor-1",
            claim_ttl=timedelta(minutes=5),
            limit=2,
            now=now,
        )

        creating_session = await mark_run_creating_session(
            run_id=dispatched_claim.id,
            claim_id=dispatched_claim.claim_id,
            anyharness_workspace_id="workspace-1",
            now=now + timedelta(seconds=1),
        )
        assert creating_session is not None
        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, dispatched_claim.id)
            assert record is not None
            record.anyharness_session_id = "session-1"
            await session.commit()
        dispatching = await mark_run_dispatching(
            run_id=dispatched_claim.id,
            claim_id=dispatched_claim.claim_id,
            now=now + timedelta(seconds=2),
        )
        dispatched = await mark_run_dispatched(
            run_id=dispatched_claim.id,
            claim_id=dispatched_claim.claim_id,
            anyharness_workspace_id="workspace-1",
            anyharness_session_id="session-1",
            now=now + timedelta(seconds=3),
        )
        failed = await mark_run_failed(
            run_id=failed_claim.id,
            claim_id=failed_claim.claim_id,
            error_code="unexpected_executor_error",
            message="executor failed",
            now=now + timedelta(seconds=4),
        )

        async with engine_module.async_session_factory() as session:
            dispatched_record = await session.get(AutomationRun, dispatched_run.id)
            failed_record = await session.get(AutomationRun, failed_run.id)
            assert dispatched_record is not None
            assert failed_record is not None

        assert dispatching is not None
        assert dispatched is True
        assert failed is True
        assert dispatched_record.status == AUTOMATION_RUN_STATUS_DISPATCHED
        assert dispatched_record.executor_kind is None
        assert dispatched_record.executor_id is None
        assert dispatched_record.claim_id is None
        assert dispatched_record.claim_expires_at is None
        assert dispatched_record.anyharness_workspace_id == "workspace-1"
        assert dispatched_record.anyharness_session_id == "session-1"
        assert failed_record.status == AUTOMATION_RUN_STATUS_FAILED
        assert failed_record.executor_kind is None
        assert failed_record.executor_id is None
        assert failed_record.claim_id is None
        assert failed_record.claim_expires_at is None
        assert failed_record.last_error_code == "unexpected_executor_error"
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_cloud_executor_claims_only_cloud_target_runs_globally(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = _patch_session_factory(test_engine)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    first_user_id = uuid.uuid4()
    second_user_id = uuid.uuid4()

    try:
        first_cloud_id = await _create_automation(
            user_id=first_user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            git_repo_name="cloud-one",
        )
        second_cloud_id = await _create_automation(
            user_id=second_user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
            git_repo_name="cloud-two",
        )
        local_id = await _create_automation(
            user_id=first_user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_LOCAL,
            git_repo_name="local",
        )
        first_cloud_run = await _create_manual_run(
            user_id=first_user_id,
            automation_id=first_cloud_id,
        )
        second_cloud_run = await _create_manual_run(
            user_id=second_user_id,
            automation_id=second_cloud_id,
        )
        local_run = await _create_manual_run(user_id=first_user_id, automation_id=local_id)

        cloud_claims = await claim_cloud_automation_runs(
            executor_id="cloud-executor",
            claim_ttl=timedelta(minutes=5),
            limit=10,
            now=now,
        )
        local_claims = await claim_local_automation_runs(
            user_id=first_user_id,
            executor_id="desktop-executor",
            available_repositories=[
                LocalAutomationRepoIdentity(
                    provider="github",
                    owner="proliferate-ai",
                    name="local",
                )
            ],
            claim_ttl=timedelta(minutes=5),
            limit=10,
            now=now,
        )

        assert {claim.id for claim in cloud_claims} == {first_cloud_run.id, second_cloud_run.id}
        assert all(
            claim.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD for claim in cloud_claims
        )
        assert [claim.id for claim in local_claims] == [local_run.id]
        assert local_claims[0].execution_target == AUTOMATION_EXECUTION_TARGET_LOCAL
    finally:
        engine_module.async_session_factory = original_factory


@pytest.mark.asyncio
async def test_workspace_creation_and_run_attachment_are_gated_by_current_claim(
    test_engine,  # type: ignore[no-untyped-def]
) -> None:
    original_factory = _patch_session_factory(test_engine)
    now = datetime(2026, 4, 20, 12, 0, tzinfo=UTC)
    user_id = uuid.uuid4()

    try:
        automation_id = await _create_automation(
            user_id=user_id,
            now=now,
            execution_target=AUTOMATION_EXECUTION_TARGET_CLOUD,
        )
        run = await _create_manual_run(user_id=user_id, automation_id=automation_id)
        claim = (
            await claim_cloud_automation_runs(
                executor_id="executor-1",
                claim_ttl=timedelta(minutes=5),
                limit=1,
                now=now,
            )
        )[0]
        creating = await mark_run_creating_workspace(
            run_id=claim.id,
            claim_id=claim.claim_id,
            now=now,
        )
        assert creating is not None

        stale_workspace = await create_cloud_workspace_for_claimed_run(
            run_id=run.id,
            claim_id=uuid.uuid4(),
            user_id=user_id,
            display_name="stale",
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            git_branch="automation/stale",
            git_base_branch="main",
            origin_json=None,
            template_version="v1",
            now=now + timedelta(seconds=1),
        )
        workspace = await create_cloud_workspace_for_claimed_run(
            run_id=run.id,
            claim_id=claim.claim_id,
            user_id=user_id,
            display_name="current",
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            git_branch="automation/current",
            git_base_branch="main",
            origin_json=None,
            template_version="v1",
            now=now + timedelta(seconds=2),
        )
        duplicate_workspace = await create_cloud_workspace_for_claimed_run(
            run_id=run.id,
            claim_id=claim.claim_id,
            user_id=user_id,
            display_name="duplicate",
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            git_branch="automation/duplicate",
            git_base_branch="main",
            origin_json=None,
            template_version="v1",
            now=now + timedelta(seconds=3),
        )

        async with engine_module.async_session_factory() as session:
            record = await session.get(AutomationRun, run.id)
            workspace_count = (
                await session.execute(select(func.count()).select_from(CloudWorkspace))
            ).scalar_one()
            assert record is not None

        assert stale_workspace is None
        assert workspace is not None
        assert duplicate_workspace is None
        assert record.cloud_workspace_id == workspace.id
        assert workspace_count == 1
    finally:
        engine_module.async_session_factory = original_factory
